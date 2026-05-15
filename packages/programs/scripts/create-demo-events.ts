/**
 * create-demo-events.ts — bootstrap the v1 demo by calling `create_event`
 * for every event in `scripts/resolvers/sources.json` that has
 * `demo_eligible: true`.
 *
 * Usage:
 *   export ANCHOR_WALLET=~/.config/solana/id.json
 *   export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
 *   export BUNDIE_RESOLVER_PUBKEY=<base58 resolver pubkey>
 *   pnpm tsx packages/programs/scripts/create-demo-events.ts
 *
 * Prerequisites:
 *   1. `anchor build && anchor deploy --provider.cluster devnet` has run
 *      and the program ID matches `lib.rs:declare_id!`.
 *   2. The wallet has devnet SOL (for rent) AND devnet USDC (for the
 *      initial subsidy of each market). DEVNET_USDC is hardcoded below.
 *   3. The resolver pubkey is the entity that will sign `resolve_event`
 *      for these markets. For v1 demo it's typically the same wallet.
 *
 * ──────────────────────────────────────────────────────────────────────
 * MARKET_ID_PREFIX collision-avoidance contract
 * ──────────────────────────────────────────────────────────────────────
 * Each market PDA is derived from:
 *     ["event_market", sha256(event_id), market_id_le_u64]
 * where `market_id = MARKET_ID_PREFIX + i` for the i-th demo_eligible event.
 *
 * The same `event_id` from sources.json is always paired with the same
 * `MARKET_ID_PREFIX + i` slot, so re-running with a prefix that has been
 * used before will hit "account already exists" on the first overlapping
 * slot. To prevent partial / inconsistent demo state, the script probes
 * every planned market PDA on devnet BEFORE submitting any tx. If any
 * PDA is already initialized, it aborts and prints the smallest safe
 * MARKET_ID_PREFIX value to use for the next run.
 *
 * Devnet prefix history (keep this current):
 *   - 100..199 : initial bring-up runs (Apr-May 2026)
 *   - 200..299 : reserved for ad-hoc debug runs
 *   - 300..    : feat/rate-prediction-markets-v2 demo set (current)
 *
 * Mainnet: not yet deployed. Before going to mainnet, replace this
 * deploy-script-only check with an on-chain MarketIdCounter PDA so
 * collision is structurally impossible.
 * ──────────────────────────────────────────────────────────────────────
 */
import {
  AnchorProvider,
  BN,
  Program,
  Wallet,
  type Idl,
} from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import idlJson from "../target/idl/prediction_market.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const MARKET_ID_PREFIX = Number(process.env.MARKET_ID_PREFIX ?? "100");
const INITIAL_SUBSIDY_USDC = Number(process.env.INITIAL_SUBSIDY_USDC ?? "100");
const FEE_BPS = Number(process.env.FEE_BPS ?? "100"); // 1%
const COMPARATOR_MAP = { lt: 0, lte: 1, gt: 2, gte: 3, eq: 4 } as const;

const MARKET_KIND = {
  EVENT_THRESHOLD: 7,
  PROTOCOL_TVL_DROP: 8,
  PUBLIC_STATUS_POLL: 9,
} as const;

const RESOLVER_CLASS_ID: Record<string, number> = {
  pyth_threshold_duration: 1,
  onchain_tvl_rolling_window: 2,
  statuspage_v2_incident_duration: 3,
  aws_health_dashboard_incident: 4,
};

interface RegistryEvent {
  event_id: string;
  description: string;
  market_kind_proposed: keyof typeof KIND_FROM_PROPOSED;
  resolver_class: string;
  resolver_config: Record<string, unknown>;
  demo_eligible?: boolean;
}

const KIND_FROM_PROPOSED = {
  EventThreshold: MARKET_KIND.EVENT_THRESHOLD,
  ProtocolTvlDrop: MARKET_KIND.PROTOCOL_TVL_DROP,
  PublicStatusPoll: MARKET_KIND.PUBLIC_STATUS_POLL,
} as const;

interface ResolverRegistry {
  networks: {
    devnet: { pyth_feeds: Record<string, string> };
  };
  events: RegistryEvent[];
}

function loadRegistry(): ResolverRegistry {
  const path = join(__dirname, "resolvers", "sources.json");
  return JSON.parse(readFileSync(path, "utf-8")) as ResolverRegistry;
}

function eventIdHash(eventId: string): Buffer {
  return createHash("sha256").update(eventId).digest();
}

function configHash(config: Record<string, unknown>): Buffer {
  return createHash("sha256").update(JSON.stringify(config)).digest();
}

function deriveMarketPda(
  programId: PublicKey,
  eventIdHashBuf: Buffer,
  marketId: number,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("event_market"),
      eventIdHashBuf,
      new BN(marketId).toArrayLike(Buffer, "le", 8),
    ],
    programId,
  );
  return pda;
}

/**
 * Probe every market PDA the run would initialize. If ANY are already
 * live on-chain, abort and tell the operator the smallest safe prefix
 * to use on the next run. Runs BEFORE any tx submission so a half-used
 * prefix can never leave the demo set in a torn state.
 */
async function assertPrefixIsClean(
  connection: Connection,
  programId: PublicKey,
  prefix: number,
  events: RegistryEvent[],
): Promise<void> {
  const plannedPdas = events.map((event, i) => ({
    eventId: event.event_id,
    marketId: prefix + i,
    pda: deriveMarketPda(programId, eventIdHash(event.event_id), prefix + i),
  }));

  const infos = await connection.getMultipleAccountsInfo(
    plannedPdas.map((p) => p.pda),
  );
  const collisions = plannedPdas.filter((_, i) => infos[i] !== null);
  if (collisions.length === 0) {
    console.log(
      `Prefix ${prefix} is clean (${plannedPdas.length} slots probed).`,
    );
    console.log("");
    return;
  }

  // Find the smallest safe next prefix by scanning forward. Bound the
  // search to keep this cheap on devnet RPC.
  let safePrefix = prefix + events.length;
  const maxScan = 50; // covers ~50 re-deploys; bump if you ever hit this
  for (let attempt = 0; attempt < maxScan; attempt++) {
    const probePdas = events.map((event, i) =>
      deriveMarketPda(
        programId,
        eventIdHash(event.event_id),
        safePrefix + i,
      ),
    );
    const probeInfos = await connection.getMultipleAccountsInfo(probePdas);
    if (probeInfos.every((info) => info === null)) break;
    safePrefix += events.length;
  }

  const collisionSummary = collisions
    .slice(0, 5)
    .map((c) => `    market_id=${c.marketId} (event=${c.eventId})`)
    .join("\n");
  const more =
    collisions.length > 5 ? `\n    …and ${collisions.length - 5} more` : "";
  console.error(
    `\n✗ MARKET_ID_PREFIX collision: prefix ${prefix} already used through ${prefix}_${String(
      Math.max(...collisions.map((c) => c.marketId - prefix)),
    ).padStart(3, "0")}.\n` +
      `  ${collisions.length} of ${plannedPdas.length} planned market PDAs already exist on-chain:\n` +
      `${collisionSummary}${more}\n\n` +
      `  → Bump MARKET_ID_PREFIX to ${safePrefix} and re-run:\n` +
      `      MARKET_ID_PREFIX=${safePrefix} pnpm tsx packages/programs/scripts/create-demo-events.ts\n`,
  );
  process.exit(1);
}

function resolveFeedKey(
  registry: ResolverRegistry,
  feedNetworkKey: string,
): string {
  const segments = feedNetworkKey.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursor: any = registry.networks.devnet;
  for (const seg of segments) {
    cursor = cursor?.[seg];
  }
  if (typeof cursor !== "string") {
    throw new Error(`feed_network_key '${feedNetworkKey}' not found in devnet`);
  }
  return cursor;
}

/**
 * Encode the per-kind 64-byte payload from a resolver_config entry. The
 * layout MUST match `MARKET_KIND_*` payload docs in
 * programs/prediction-market/src/state/market.rs.
 */
function encodePayload(
  registry: ResolverRegistry,
  event: RegistryEvent,
): Buffer {
  const payload = Buffer.alloc(64);
  const cfg = event.resolver_config as Record<string, unknown>;
  const kind = KIND_FROM_PROPOSED[event.market_kind_proposed];

  if (kind === MARKET_KIND.EVENT_THRESHOLD) {
    const thresholdRaw = Math.round(Number(cfg.threshold_price) * 1e8);
    const comparator = COMPARATOR_MAP[cfg.comparator as keyof typeof COMPARATOR_MAP];
    const minDuration = Number(cfg.min_duration_seconds);
    const windowEnd = Math.floor(Date.now() / 1000) + Number(cfg.window_seconds);
    const feedAddr = resolveFeedKey(registry, String(cfg.feed_network_key));
    const feedPubkey = new PublicKey(feedAddr);

    payload.writeBigUInt64LE(BigInt(thresholdRaw), 0);
    payload.writeBigUInt64LE(BigInt(comparator), 8);
    payload.writeBigUInt64LE(BigInt(minDuration), 16);
    payload.writeBigUInt64LE(BigInt(windowEnd), 24);
    feedPubkey.toBuffer().copy(payload, 32);
  } else if (kind === MARKET_KIND.PROTOCOL_TVL_DROP) {
    const dropThreshold = BigInt(Math.round(Number(cfg.drop_threshold_usd) * 1e6)); // → micro-dollars
    const rollingWindow = Number(cfg.rolling_window_seconds);
    const windowEnd = Math.floor(Date.now() / 1000) + Number(cfg.outcome_window_seconds);
    payload.writeBigUInt64LE(dropThreshold, 0);
    payload.writeBigUInt64LE(BigInt(rollingWindow), 8);
    payload.writeBigUInt64LE(BigInt(windowEnd), 16);
    // payload[32..64] = tvl_source_pubkey — until the actual TVL account
    // is wired (e.g. Kamino main lending market), use a non-default
    // placeholder pubkey so on-chain validation passes. The off-chain
    // resolver reads the real source from resolver_config; on-chain only
    // checks that this field is != Pubkey::default(). Using a 0x01-filled
    // 32-byte pubkey makes the placeholder visually distinct from real
    // addresses while remaining valid.
    const tvlPlaceholder = Buffer.alloc(32, 1);
    tvlPlaceholder.copy(payload, 32);
  } else if (kind === MARKET_KIND.PUBLIC_STATUS_POLL) {
    // sources.json uses `min_downtime_seconds` for Statuspage entries and
    // `min_duration_seconds` for AWS Health entries — accept either.
    const minDuration = Number(cfg.min_duration_seconds ?? cfg.min_downtime_seconds);
    if (!Number.isFinite(minDuration) || minDuration <= 0) {
      throw new Error(
        `event ${event.event_id}: missing min_duration_seconds / min_downtime_seconds in resolver_config`,
      );
    }
    const rollingWindow = Number(cfg.rolling_window_seconds ?? 0);
    const windowEnd = Math.floor(Date.now() / 1000) + Number(cfg.outcome_window_seconds);
    const resolverClassId = RESOLVER_CLASS_ID[event.resolver_class];
    if (!resolverClassId) {
      throw new Error(`Unknown resolver_class id for: ${event.resolver_class}`);
    }
    payload.writeBigUInt64LE(BigInt(minDuration), 0);
    payload.writeBigUInt64LE(BigInt(rollingWindow), 8);
    payload.writeBigUInt64LE(BigInt(windowEnd), 16);
    payload.writeBigUInt64LE(BigInt(resolverClassId), 24);
    configHash(cfg).copy(payload, 32);
  }

  return payload;
}

async function main() {
  const registry = loadRegistry();
  const demoEvents = registry.events.filter((e) => e.demo_eligible);
  if (demoEvents.length === 0) {
    console.error("No demo_eligible events in sources.json");
    process.exit(1);
  }

  const rpcUrl =
    process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";
  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) {
    console.error("ANCHOR_WALLET env var is required");
    process.exit(1);
  }
  const secret = JSON.parse(readFileSync(walletPath, "utf-8"));
  const creator = Keypair.fromSecretKey(new Uint8Array(secret));
  const wallet = new Wallet(creator);
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new Program(idlJson as any as Idl, provider);

  const resolverPubkeyStr = process.env.BUNDIE_RESOLVER_PUBKEY ?? creator.publicKey.toBase58();
  const resolver = new PublicKey(resolverPubkeyStr);

  console.log(`Creator:   ${creator.publicKey.toBase58()}`);
  console.log(`Resolver:  ${resolver.toBase58()}`);
  console.log(`RPC:       ${rpcUrl}`);
  console.log(`Markets:   ${demoEvents.length} demo events`);
  console.log("");

  // Ensure the creator's USDC ATA exists. Without it, every create_event
  // call below fails with "subsidy_source not found" because the ix
  // expects the creator to already hold devnet USDC. We create the ATA
  // on the fly if absent; the user still needs to FAUCET the USDC (see
  // https://spl-token-faucet.com/?token-name=USDC-Dev) — the script
  // can't print devnet USDC for them.
  const creatorUsdcAta = await getAssociatedTokenAddress(
    DEVNET_USDC,
    creator.publicKey,
  );
  const ataInfo = await connection.getAccountInfo(creatorUsdcAta);
  if (!ataInfo) {
    console.log(`Creating creator's USDC ATA (${creatorUsdcAta.toBase58()})…`);
    const ataIx = createAssociatedTokenAccountInstruction(
      creator.publicKey, // payer
      creatorUsdcAta, // ata
      creator.publicKey, // owner
      DEVNET_USDC, // mint
    );
    const tx = new Transaction().add(ataIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [creator]);
    console.log(`  ✓ ATA created: ${sig}`);
    console.log(
      `  → Fund this ATA with devnet USDC at https://spl-token-faucet.com/?token-name=USDC-Dev`,
    );
    console.log(
      `  → Re-run this script once the ATA holds at least ${
        INITIAL_SUBSIDY_USDC * demoEvents.length
      } USDC.`,
    );
    process.exit(0);
  }
  console.log(`USDC ATA:  ${creatorUsdcAta.toBase58()} (exists)`);
  console.log("");

  // Collision pre-check: ensure no planned market PDA already exists.
  // Aborts with a clear remediation message if the current prefix is dirty.
  await assertPrefixIsClean(
    connection,
    program.programId,
    MARKET_ID_PREFIX,
    demoEvents,
  );

  for (let i = 0; i < demoEvents.length; i++) {
    const event = demoEvents[i];
    const marketId = MARKET_ID_PREFIX + i;
    const eventIdHashBuf = eventIdHash(event.event_id);
    const configHashBuf = configHash(event.resolver_config);
    const kind = KIND_FROM_PROPOSED[event.market_kind_proposed];
    const payload = encodePayload(registry, event);

    const marketPda = deriveMarketPda(program.programId, eventIdHashBuf, marketId);

    const [resolverAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("resolver_auth"), marketPda.toBuffer()],
      program.programId,
    );
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketPda.toBuffer()],
      program.programId,
    );
    const [yesMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("yes_mint"), marketPda.toBuffer()],
      program.programId,
    );
    const [noMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("no_mint"), marketPda.toBuffer()],
      program.programId,
    );

    // Subsidy ATA — assume already exists; the script doesn't auto-fund.
    const [subsidyAta] = PublicKey.findProgramAddressSync(
      [creator.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), DEVNET_USDC.toBuffer()],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    );

    const initialSubsidy = new BN(INITIAL_SUBSIDY_USDC * 1e6);
    const currentSlot = await connection.getSlot();
    const resolutionSlot = new BN(currentSlot + 2 * 24 * 60 * 60 * 2.5); // ~2 days

    console.log(`[${i + 1}/${demoEvents.length}] ${event.event_id}`);
    console.log(`  market: ${marketPda.toBase58()}`);
    console.log(`  kind:   ${kind}`);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sig = await (program.methods as any)
        .createEvent(
          event.description.slice(0, 128),
          new BN(marketId),
          Array.from(eventIdHashBuf),
          kind,
          Array.from(payload),
          resolutionSlot,
          initialSubsidy,
          FEE_BPS,
          resolver,
          Array.from(configHashBuf),
        )
        .accounts({
          creator: creator.publicKey,
          market: marketPda,
          resolverAuthority: resolverAuthorityPda,
          collateralMint: DEVNET_USDC,
          vault: vaultPda,
          yesMint: yesMintPda,
          noMint: noMintPda,
          subsidySource: subsidyAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      console.log(`  ✓ ${sig}`);
    } catch (err) {
      console.error(`  ✗ ${(err as Error).message}`);
      if (process.env.BUNDIE_STOP_ON_ERROR === "true") {
        process.exit(1);
      }
    }
    console.log("");
  }

  console.log(`Done. ${demoEvents.length} markets attempted.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
