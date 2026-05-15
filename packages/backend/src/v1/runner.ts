/**
 * v1 resolver runner — long-lived daemon that polls each registered
 * resolver on its configured interval and submits `resolve_event` for
 * markets whose trigger condition has been met.
 *
 * Wiring:
 *   - Reads `scripts/resolvers/sources.json` via the registry loader.
 *   - For each demo-eligible event, instantiates the resolver class.
 *   - On every tick (default 60s), polls every resolver in parallel.
 *   - On YES/NO signal, builds + submits a `resolve_event` ix signed by
 *     the BUNDIE_RESOLVER_KEY env keypair (must match the pubkey passed
 *     to `create_event` at market-creation time).
 *
 * Started via `pnpm tsx packages/backend/src/v1/runner.ts`. Not mounted
 * inside the main Hono process so a crashed runner doesn't take the API
 * down (and vice-versa). Logs to stdout; no persistent state.
 */

import "dotenv/config";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import idlJson from "../idl/prediction_market.json" with { type: "json" };
import { loadRegistry, listDemoEvents } from "./registry.js";
import { findMarketForEvent } from "./onchain.js";
import { PythThresholdDurationResolver } from "./resolvers/pyth-threshold-duration.js";
import { StatuspageIncidentResolver } from "./resolvers/statuspage-incident.js";
import { AwsHealthIncidentResolver } from "./resolvers/aws-health-incident.js";
import { OnchainTvlRollingWindowResolver } from "./resolvers/onchain-tvl-rolling-window.js";
import { incrementTrackRecord } from "./track-record.js";
import {
  maybeTickOnchainEventPrice,
  isOnchainEventPriceEnabled,
  deriveEventPricePda,
} from "./event-price-onchain.js";
import { eventIdHash } from "./onchain.js";
import { SystemProgram } from "@solana/web3.js";
import type { Resolver } from "./types.js";

/**
 * sha256(JSON.stringify(config)) — same algorithm as the deploy script's
 * `configHash` helper. Used to verify that the resolver_config loaded
 * from sources.json on this process matches what was pinned on-chain
 * at market-creation time. A mismatch means someone edited sources.json
 * after deploy — REFUSE to sign.
 */
function configHash(config: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(config)).digest();
}

async function verifyOnchainConfigHash(
  program: Program,
  marketPda: PublicKey,
  loadedConfig: unknown,
): Promise<boolean> {
  const [resolverAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("resolver_auth"), marketPda.toBuffer()],
    program.programId,
  );
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = (await (program.account as any).resolverAuthority.fetch(
      resolverAuthorityPda,
    )) as { configHash: number[] };
    const onchain = Buffer.from(account.configHash);
    const local = configHash(loadedConfig);
    return onchain.equals(local);
  } catch (err) {
    console.warn(
      `[runner] config_hash verify failed (treating as mismatch): ${(err as Error).message}`,
    );
    return false;
  }
}

const TICK_INTERVAL_MS = Number(process.env.BUNDIE_RUNNER_TICK_MS ?? "60000");
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

function loadResolverKeypair(): Keypair {
  const raw = process.env.BUNDIE_RESOLVER_KEY;
  if (!raw) {
    throw new Error(
      "BUNDIE_RESOLVER_KEY env var required — either a path to a Solana keypair JSON file, or the keypair JSON content inline (64-byte array literal).",
    );
  }
  // Two accepted formats:
  //   1. File path (e.g. ~/.config/solana/id.json) — used locally
  //   2. Inline JSON array (the file contents pasted into the env) — used on
  //      Railway / Vercel / any host where dropping a keypair file isn't
  //      practical. Detect inline by checking for a leading "[".
  const trimmed = raw.trim();
  const isInline = trimmed.startsWith("[");
  const secret = JSON.parse(isInline ? trimmed : readFileSync(trimmed, "utf-8"));
  if (!Array.isArray(secret) || secret.length !== 64) {
    throw new Error(
      `BUNDIE_RESOLVER_KEY must be a 64-byte JSON array; got ${
        Array.isArray(secret) ? `array of ${secret.length}` : typeof secret
      }`,
    );
  }
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

/** Build the Anchor program with a signing wallet (resolver keypair). */
function buildProgram(resolverKp: Keypair): Program {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(resolverKp);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Program(idlJson as any as Idl, provider);
}

/**
 * Map resolver_class string from sources.json to a constructed resolver
 * instance. v1 ships one implementation (Pyth threshold). The others
 * land in subsequent commits; for now they log a warning and are skipped.
 */
function buildResolvers(
  connection: Connection,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Map<string, Resolver<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = new Map<string, Resolver<any>>();
  map.set(
    "pyth_threshold_duration",
    new PythThresholdDurationResolver(connection),
  );
  map.set(
    "statuspage_v2_incident_duration",
    new StatuspageIncidentResolver(),
  );
  map.set("aws_health_dashboard_incident", new AwsHealthIncidentResolver());
  map.set(
    "onchain_tvl_rolling_window",
    new OnchainTvlRollingWindowResolver(connection),
  );
  return map;
}

async function submitResolveEvent(
  program: Program,
  resolverKp: Keypair,
  marketAddress: PublicKey,
  eventId: string,
  outcome: "yes" | "no",
): Promise<string> {
  const [resolverAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("resolver_auth"), marketAddress.toBuffer()],
    program.programId,
  );
  const outcomeObj = outcome === "yes" ? { yes: {} } : { no: {} };

  // Post-EventPrice-upgrade path: the on-chain `resolve_event` now also
  // takes the event_id_hash + the event-price PDA so the feed can be
  // frozen at the terminal outcome in the same tx. Pre-upgrade we use the
  // narrower signature. Both call sites share the `.rpc()` shape.
  if (isOnchainEventPriceEnabled()) {
    const eventIdHashBuf = eventIdHash(eventId);
    const eventPricePda = deriveEventPricePda(
      program.programId,
      eventIdHashBuf,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (program.methods as any)
      .resolveEvent(outcomeObj, Array.from(eventIdHashBuf))
      .accounts({
        resolver: resolverKp.publicKey,
        market: marketAddress,
        resolverAuthority: resolverAuthorityPda,
        eventPrice: eventPricePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sig = await (program.methods as any)
    .resolveEvent(outcomeObj)
    .accounts({
      resolver: resolverKp.publicKey,
      market: marketAddress,
      resolverAuthority: resolverAuthorityPda,
    })
    .rpc();
  return sig;
}

async function tick(
  program: Program,
  resolverKp: Keypair,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvers: Map<string, Resolver<any>>,
): Promise<void> {
  loadRegistry(); // warm cache
  const events = listDemoEvents();
  const now = new Date();

  await Promise.all(
    events.map(async (event) => {
      const resolver = resolvers.get(event.resolver_class);
      if (!resolver) {
        console.warn(
          `[runner] no resolver for class '${event.resolver_class}' — skipping ${event.event_id}`,
        );
        return;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await resolver.poll(event.event_id, event.resolver_config as any, now);

        // ---- On-chain EventPrice tick (gated by BUNDIE_EVENT_PRICE_ONCHAIN) ----
        // Runs regardless of whether the resolver fired this tick — we want
        // the feed to be ticked even on quiet markets. Failures here MUST NOT
        // block the settlement path, so we wrap in our own try/catch and only
        // log. The epsilon+heartbeat gate inside the helper means we don't
        // burn SOL when price is flat.
        if (isOnchainEventPriceEnabled()) {
          try {
            const marketPdaForTick = await findMarketForEvent(event.event_id);
            if (marketPdaForTick) {
              const [resolverAuthPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("resolver_auth"), marketPdaForTick.toBuffer()],
                program.programId,
              );
              const tickResult = await maybeTickOnchainEventPrice({
                program,
                resolverKp,
                eventId: event.event_id,
                marketPda: marketPdaForTick,
                resolverAuthorityPda: resolverAuthPda,
                configHash: configHash(event.resolver_config),
              });
              if (tickResult.status === "wrote") {
                console.log(
                  `[runner] event_price tick ${event.event_id} priceQ9=${tickResult.priceQ9} sig=${tickResult.signature}`,
                );
              }
            }
          } catch (err) {
            console.warn(
              `[runner] event_price tick failed for ${event.event_id}: ${(err as Error).message}`,
            );
          }
        }

        if (!result) return; // trigger not met yet — wait for next tick

        const marketPda = await findMarketForEvent(event.event_id);
        if (!marketPda) {
          console.warn(
            `[runner] ${event.event_id} resolved to '${result}' but no on-chain market — skip`,
          );
          return;
        }

        // Safety check: refuse to sign if the loaded resolver_config
        // doesn't match what was pinned on-chain at market-creation
        // time. Drift = potentially-wrong resolution = potentially-lost
        // user money. Better to skip and alert than to settle bad data.
        const hashOk = await verifyOnchainConfigHash(
          program,
          marketPda,
          event.resolver_config,
        );
        if (!hashOk) {
          console.error(
            `[runner] REFUSING to resolve ${event.event_id}: on-chain config_hash != local. Redeploy needed or sources.json drifted.`,
          );
          return;
        }

        console.log(
          `[runner] resolving ${event.event_id} (${marketPda.toBase58()}) → ${result.toUpperCase()}`,
        );
        const sig = await submitResolveEvent(
          program,
          resolverKp,
          marketPda,
          event.event_id,
          result,
        );
        console.log(`[runner] resolved: ${sig}`);
        // Bump the resolver's total-resolutions counter. disputed/lost stay
        // at zero until an override mechanism exists on-chain.
        await incrementTrackRecord(event.resolver_class, "total");
      } catch (err) {
        console.error(
          `[runner] ${event.event_id} failed: ${(err as Error).message}`,
        );
      }
    }),
  );
}

async function main() {
  const resolverKp = loadResolverKeypair();
  const program = buildProgram(resolverKp);
  const connection = new Connection(RPC_URL, "confirmed");
  const resolvers = buildResolvers(connection);

  console.log(`[runner] starting`);
  console.log(`[runner] resolver pubkey: ${resolverKp.publicKey.toBase58()}`);
  console.log(`[runner] rpc: ${RPC_URL}`);
  console.log(`[runner] tick interval: ${TICK_INTERVAL_MS}ms`);
  console.log(
    `[runner] onchain event_price: ${isOnchainEventPriceEnabled() ? "ENABLED" : "disabled"} (set BUNDIE_EVENT_PRICE_ONCHAIN=true to flip)`,
  );
  console.log("");

  // Initial tick immediately, then schedule recurring.
  await tick(program, resolverKp, resolvers);
  setInterval(() => {
    tick(program, resolverKp, resolvers).catch((err) => {
      console.error(`[runner] tick failed: ${(err as Error).message}`);
    });
  }, TICK_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[runner] fatal:", err);
  process.exit(1);
});
