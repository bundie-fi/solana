/**
 * Resolver-runner bridge to the on-chain EventPrice account.
 *
 * On every runner tick (per active event), this module:
 *   1. Reads the current Market snapshot
 *   2. Computes priceQ9 / confidenceQ9 / depthUsd
 *   3. Skips the on-chain write unless either:
 *        a) |priceQ9 - lastWrittenPriceQ9| >= EPSILON_Q9 (price moved enough), OR
 *        b) (now - lastWriteAtMs) >= HEARTBEAT_MS (feed needs a freshness tick)
 *   4. Submits `update_event_price` on the prediction-market program
 *
 * The combination of epsilon-gate + heartbeat means a market that hasn't
 * traded all day still produces a periodic on-chain price write (so consumers
 * never see a feed that's hours stale), while a market chopping in a 0.5pp
 * band doesn't burn SOL on every tick.
 *
 * Feature-flagged behind BUNDIE_EVENT_PRICE_ONCHAIN. With the flag off,
 * `maybeTickOnchainEventPrice()` is a no-op — safe to ship before the
 * prediction-market program upgrade lands on devnet.
 */

import anchor, { type Program } from "@coral-xyz/anchor";
// `@coral-xyz/anchor` is CJS; named-importing BN under ESM throws
// "Named export 'BN' not found" at runtime. Pull it off the default export.
const { BN } = anchor;
import {
  type Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { readMarketSnapshot, eventIdHash } from "./onchain.js";
import { getMarketStats } from "./indexer.js";
import { yesPrice, confidenceScore } from "./lmsr.js";

// Defaults. Env-overridable so the user can tune the gate without a redeploy.
const ENABLED = process.env.BUNDIE_EVENT_PRICE_ONCHAIN === "true";
const EPSILON_Q9 = Number(
  process.env.BUNDIE_EVENT_PRICE_EPSILON_Q9 ?? "5000000",
); // 0.005 = 50 bps
const HEARTBEAT_MS = Number(
  process.env.BUNDIE_EVENT_PRICE_HEARTBEAT_MS ?? "300000",
); // 5 min

const EVENT_PRICE_SEED = Buffer.from("event_price");

interface LastWrite {
  priceQ9: number;
  writtenAtMs: number;
}
const lastWriteByEvent = new Map<string, LastWrite>();

// Events whose on-chain ResolverAuthority pins a different config_hash
// than what we currently load from sources.json. Once detected we stop
// ticking the on-chain feed for these — the ix will keep failing until
// the market is re-created with the new config. One log line per
// process lifetime instead of per-tick noise.
const skippedForConfigDrift = new Set<string>();

/**
 * Derive the EventPrice PDA from the program ID + event id hash. Matches
 * the on-chain seed: `[b"event_price", event_id_hash]`.
 */
export function deriveEventPricePda(
  programId: PublicKey,
  eventIdHashBuf: Buffer,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [EVENT_PRICE_SEED, eventIdHashBuf],
    programId,
  );
  return pda;
}

export function isOnchainEventPriceEnabled(): boolean {
  return ENABLED;
}

interface TickInput {
  program: Program;
  resolverKp: Keypair;
  eventId: string;
  marketPda: PublicKey;
  resolverAuthorityPda: PublicKey;
  configHash: Buffer;
}

interface TickResult {
  status: "skipped_disabled" | "skipped_gated" | "wrote";
  reason?: string;
  signature?: string;
  priceQ9?: number;
}

/**
 * Run one on-chain event-price tick. Returns whether the call was skipped
 * (flag off, gate held) or written (with the tx signature).
 *
 * Caller owns error handling — this fn rethrows on RPC failure so the
 * runner's per-event try/catch can log + continue without the rest of the
 * tick blocking on a flaky RPC for one event.
 */
export async function maybeTickOnchainEventPrice(
  input: TickInput,
): Promise<TickResult> {
  if (!ENABLED) return { status: "skipped_disabled" };

  if (skippedForConfigDrift.has(input.eventId)) {
    return { status: "skipped_gated", reason: "config_hash_drift" };
  }

  const snapshot = await readMarketSnapshot(input.eventId);
  if (!snapshot) {
    return { status: "skipped_gated", reason: "no_market_snapshot" };
  }

  // Convert LMSR price to Q9 (0..1_000_000_000) — matches on-chain account
  // layout's `price: u64` / `exponent: -9`. Clamp because the math can edge
  // a fraction outside [0,1] at extreme states; the on-chain check is
  // stricter and would reject a value out of range.
  const priceFloat = yesPrice(
    snapshot.yesShares,
    snapshot.noShares,
    snapshot.liquidityParam,
  );
  const priceQ9 = Math.max(
    0,
    Math.min(1_000_000_000, Math.round(priceFloat * 1_000_000_000)),
  );

  // Confidence in the same Q9 frame. Reuse the existing heuristic so the
  // on-chain feed's confidence matches what the REST endpoint surfaces.
  const stats = await getMarketStats(snapshot.marketAddress).catch(() => null);
  const confidenceFloat = stats
    ? confidenceScore(
        snapshot.totalVolumeUsd,
        stats.tradeCount24h,
        stats.uniqueTraders24h,
      )
    : 0;
  const confidenceQ9 = Math.max(
    0,
    Math.min(1_000_000_000, Math.round(confidenceFloat * 1_000_000_000)),
  );

  // Depth in USDC base units (6 dp). The snapshot already exposes USD; the
  // on-chain account stores raw base units to avoid float drift.
  const depthUsdU64 = Math.max(
    0,
    Math.round(snapshot.totalVolumeUsd * 1_000_000),
  );

  // Gate check: skip unless price moved beyond epsilon OR heartbeat elapsed.
  const now = Date.now();
  const prev = lastWriteByEvent.get(input.eventId);
  if (prev) {
    const movedEnough = Math.abs(priceQ9 - prev.priceQ9) >= EPSILON_Q9;
    const heartbeatElapsed = now - prev.writtenAtMs >= HEARTBEAT_MS;
    if (!movedEnough && !heartbeatElapsed) {
      return {
        status: "skipped_gated",
        reason: `epsilon_held(delta=${Math.abs(priceQ9 - prev.priceQ9)})`,
        priceQ9,
      };
    }
  }

  const eventIdHashBuf = eventIdHash(input.eventId);
  const eventPricePda = deriveEventPricePda(
    input.program.programId,
    eventIdHashBuf,
  );

  let sig: string;
  try {
    // The `update_event_price` ix uses the `as any` escape hatch since
    // anchor's type-level codegen for new methods only refreshes after
    // an IDL rebuild + redeploy. Mirrors the existing `resolveEvent`
    // shape in the runner.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sig = await (input.program.methods as any)
      .updateEventPrice(
        Array.from(eventIdHashBuf),
        Array.from(input.configHash),
        new BN(priceQ9.toString()),
        new BN(confidenceQ9.toString()),
        new BN(depthUsdU64.toString()),
      )
      .accounts({
        resolver: input.resolverKp.publicKey,
        market: input.marketPda,
        resolverAuthority: input.resolverAuthorityPda,
        eventPrice: eventPricePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch (err) {
    // ResolverMismatch (6025) on update_event_price means EITHER the
    // signer pubkey OR the config_hash doesn't match the on-chain
    // ResolverAuthority. When it's hash drift (sources.json edited
    // post-create_event), there's no way to recover without recreating
    // the market. Latch it so we don't burn RPC on every tick.
    const msg = (err as Error).message ?? "";
    if (msg.includes("ResolverMismatch") || msg.includes("6025")) {
      skippedForConfigDrift.add(input.eventId);
      console.warn(
        `[event-price-onchain] ${input.eventId}: config_hash drift detected — sources.json differs from on-chain ResolverAuthority pin. ` +
          `Stopping on-chain ticks for this event. Re-create the market to refresh the pin.`,
      );
      return { status: "skipped_gated", reason: "config_hash_drift" };
    }
    throw err;
  }

  lastWriteByEvent.set(input.eventId, { priceQ9, writtenAtMs: now });
  return { status: "wrote", signature: sig, priceQ9 };
}
