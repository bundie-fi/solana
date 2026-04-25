/**
 * On-chain market reader — thin wrapper around `@coral-xyz/anchor` that
 * exposes `MarketView` objects (plain JS shapes, no BN/BigInt leakage) to
 * the Next.js server components and any client components that need them.
 *
 * Why a `MarketView` instead of the raw Anchor decoded type:
 *   - RSC boundary: BN / bigint objects aren't serialisable across the
 *     server→client split. We convert to `number` up front (the numbers
 *     involved — bps, slots, USDC base units — all comfortably fit in
 *     Number's safe-integer range for the foreseeable future).
 *   - Kind-specific fields: we pre-parse the 64-byte `payload` for kind=5
 *     (RateBarrier) and kind=6 (AgentVsBenchmark) so page components stay
 *     simple. Byte offsets mirror
 *     `packages/programs/programs/prediction-market/src/state/market.rs`.
 *
 * Read-only provider: AnchorProvider requires *some* Wallet, but we never
 * sign here — a throwaway Keypair is sufficient and the provider is used
 * only for its `connection`.
 */
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import type { Wallet as AnchorWallet } from "@coral-xyz/anchor/dist/cjs/provider";
import { predictionMarketIdl } from "@bundie/common";
import type { PredictionMarket } from "@bundie/common";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

// ─── Payload offsets (mirrored from state/market.rs) ─────────────────────
//
// RateBarrier (kind=5):
//   [0..8]   threshold_bps
//   [8..16]  window_start_slot
//   [16..24] window_end_slot
//   [24..32] rate_reader_selector
//
// AgentVsBenchmark (kind=6) — v2 layout post-547afea:
//   [0..8]   spread_bps
//   [8..16]  window_start_slot
//   [16..24] window_end_slot
//   [24..32] benchmark_reader_selector
//   [32..64] target_agent (Pubkey, 32 bytes) — the vault under measurement.
//            Displaces the old `initial_agent_nav` slot; the on-chain program
//            asserts `creator != target_agent` via `InsiderMarketForbidden`.

function readU64LE(payload: number[] | Uint8Array, offset: number): number {
  // BigInt-safe read; cast to Number at the end. Our payload values
  // (bps, slot counts, nav) are well within safe-integer bounds.
  const bytes =
    payload instanceof Uint8Array
      ? payload
      : Uint8Array.from(payload);
  if (offset + 8 > bytes.length) return 0;
  let v = 0n;
  for (let i = 7; i >= 0; i--) {
    v = (v << 8n) | BigInt(bytes[offset + i]);
  }
  // Safe-integer clamp — if we ever overflow, surface as Number.MAX_SAFE_INTEGER
  // so UI shows a large-but-bounded number rather than NaN.
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(v);
}

// ─── Public view type ────────────────────────────────────────────────────

export interface MarketView {
  /** Market PDA in base58. */
  address: string;
  /** Agent vault pubkey that signed create_market_v2. Base58. */
  createdBy: string;
  /** Question text, trimmed by the program to 128 bytes. */
  question: string;
  /** Market kind (0..6). */
  kind: number;
  /** Parsed rate reader selector for kind=5/6, else null. */
  rateReaderSelector: number | null;
  /** Kind=5 threshold in bps; null for other kinds. */
  thresholdBps: number | null;
  /** Kind=6 spread in bps; null for other kinds. */
  spreadBps: number | null;
  /** Kind=5/6 window start slot; null otherwise. */
  windowStartSlot: number | null;
  /** Kind=5/6 window end slot; null otherwise. */
  windowEndSlot: number | null;
  /** Slot at which market can be resolved (from Market.resolution_slot). */
  resolutionSlot: number;
  /** Unix timestamp of creation. */
  createdAt: number;
  /** Total volume traded, in base units (USDC = 6dp). */
  totalVolume: number;
  /** Fee in bps. */
  feeBps: number;
  /** Lifecycle status. */
  status: "active" | "resolved";
  /** Winner after resolution; null while active. */
  outcome: "yes" | "no" | null;
  /** NAV per share at market creation (strategy A). */
  initialNavPerShare: number;
  /**
   * For kind=6 markets, the agent vault under measurement (parsed from
   * payload bytes 32..64). Null for other kinds. The on-chain program
   * rejects kind=6 markets where `created_by == target_agent`, so UI can
   * safely render creator and target as distinct entities.
   */
  targetAgent: string | null;
  /** YES shares outstanding (raw on-chain value). */
  yesShares: number;
  /** NO shares outstanding (raw on-chain value). */
  noShares: number;
  /** Collateral mint (e.g. USDC). Used for buy_shares ix building. */
  collateralMint: string;
  /** Strategy PDA associated with the market (needed for buy_shares). */
  strategy: string;
  /** Market vault token account (holds collateral). */
  vault: string;
}

// ─── Anchor plumbing ─────────────────────────────────────────────────────

let cachedProgram: Program<PredictionMarket> | null = null;
let cachedConnectionRef: Connection | null = null;

/**
 * Read-only wallet: satisfies Anchor's Wallet interface without pulling in
 * NodeWallet (which requires `fs` and breaks Next.js builds). The signer
 * methods throw — we never sign, this is a read-only client.
 */
function makeReadOnlyWallet(): AnchorWallet {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      _tx: T,
    ): Promise<T> {
      throw new Error("read-only wallet: signing disabled");
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      _txs: T[],
    ): Promise<T[]> {
      throw new Error("read-only wallet: signing disabled");
    },
    payer: kp,
  };
}

/**
 * Build (or return a cached) Program<PredictionMarket> bound to `connection`.
 * The provider wallet is a throwaway Keypair — never used to sign.
 */
function getProgram(connection: Connection): Program<PredictionMarket> {
  if (cachedProgram && cachedConnectionRef === connection) {
    return cachedProgram;
  }
  const provider = new AnchorProvider(connection, makeReadOnlyWallet(), {
    commitment: "confirmed",
  });
  cachedProgram = new Program<PredictionMarket>(
    predictionMarketIdl as unknown as PredictionMarket,
    provider,
  );
  cachedConnectionRef = connection;
  return cachedProgram;
}

// ─── Conversion ──────────────────────────────────────────────────────────

type MarketAccountRaw = Awaited<
  ReturnType<Program<PredictionMarket>["account"]["market"]["fetch"]>
>;

function toNumber(v: BN | number | bigint | undefined | null): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") {
    return v > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(v);
  }
  // BN
  try {
    return v.toNumber();
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function readPubkey(
  payload: number[] | Uint8Array,
  offset: number,
): string | null {
  const bytes =
    payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  if (offset + 32 > bytes.length) return null;
  const slice = bytes.slice(offset, offset + 32);
  // All-zeros means "unset" for kind=6 payloads that predate the target_agent
  // field; treat as null so callers can render a graceful placeholder.
  let anyNonZero = false;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] !== 0) {
      anyNonZero = true;
      break;
    }
  }
  if (!anyNonZero) return null;
  try {
    return new PublicKey(slice).toBase58();
  } catch {
    return null;
  }
}

function toMarketView(
  address: PublicKey,
  raw: MarketAccountRaw,
): MarketView {
  const kind = Number(raw.kind ?? 0);
  const payloadBytes: number[] = Array.from(
    (raw.payload as unknown as number[] | Uint8Array) ?? [],
  );

  let rateReaderSelector: number | null = null;
  let thresholdBps: number | null = null;
  let spreadBps: number | null = null;
  let windowStartSlot: number | null = null;
  let windowEndSlot: number | null = null;
  let targetAgent: string | null = null;

  if (kind === 5) {
    thresholdBps = readU64LE(payloadBytes, 0);
    windowStartSlot = readU64LE(payloadBytes, 8);
    windowEndSlot = readU64LE(payloadBytes, 16);
    rateReaderSelector = readU64LE(payloadBytes, 24);
  } else if (kind === 6) {
    spreadBps = readU64LE(payloadBytes, 0);
    windowStartSlot = readU64LE(payloadBytes, 8);
    windowEndSlot = readU64LE(payloadBytes, 16);
    rateReaderSelector = readU64LE(payloadBytes, 24);
    // target_agent lives in bytes 32..64 per the 547afea anchor upgrade.
    // Older markets written before that upgrade will have zeroes here, in
    // which case `readPubkey` returns null and callers fall back to the
    // creator's identity (best-effort display).
    targetAgent = readPubkey(payloadBytes, 32);
  }

  const status: "active" | "resolved" =
    (raw.status as { active?: unknown; resolved?: unknown })?.resolved !==
    undefined
      ? "resolved"
      : "active";

  let outcome: "yes" | "no" | null = null;
  const rawOutcome = raw.outcome as
    | { yes?: unknown; no?: unknown }
    | null
    | undefined;
  if (rawOutcome) {
    if (rawOutcome.yes !== undefined) outcome = "yes";
    else if (rawOutcome.no !== undefined) outcome = "no";
  }

  return {
    address: address.toBase58(),
    createdBy: (raw.createdBy as PublicKey).toBase58(),
    question: String(raw.question ?? ""),
    kind,
    rateReaderSelector,
    thresholdBps,
    spreadBps,
    windowStartSlot,
    windowEndSlot,
    resolutionSlot: toNumber(raw.resolutionSlot as BN),
    createdAt: toNumber(raw.createdAt as BN),
    totalVolume: toNumber(raw.totalVolume as BN),
    feeBps: Number(raw.feeBps ?? 0),
    status,
    outcome,
    initialNavPerShare: toNumber(raw.initialNavPerShare as BN),
    targetAgent,
    yesShares: toNumber(raw.yesShares as BN),
    noShares: toNumber(raw.noShares as BN),
    collateralMint: (raw.collateralMint as PublicKey).toBase58(),
    strategy: (raw.strategy as PublicKey).toBase58(),
    vault: (raw.vault as PublicKey).toBase58(),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────

// Only show markets created from this point forward. Filters out all
// pre-existing chaos-sim test markets so the UI starts with a clean slate.
// Unix seconds: 2026-04-25 02:00 UTC
const MARKET_FRESH_START_TS = 1745553600;

// Hero agent vaults — only markets from these signers are shown.
const HERO_VAULTS = new Set([
  "5ZnHtnSBvy4L9fGzGYaecVZ3WonWK3rLCqb4uaEgGXcm", // alice.bundie
  "EBYDXh5RjbRX7eBobenPC59tvS4TCQzCUKYgx6auU8jb", // bob.bundie
  "8zNazDgyrTX1CTaPk4G6hZ8r47SbVajh1vcFrqNAzBFg", // charlie.bundie
]);

export async function fetchAllMarkets(
  connection: Connection,
): Promise<MarketView[]> {
  const program = getProgram(connection);
  try {
    const accounts = await program.account.market.all();
    return accounts
      .map((a) => toMarketView(a.publicKey, a.account))
      .filter(
        (m) =>
          HERO_VAULTS.has(m.createdBy) &&
          m.createdAt >= MARKET_FRESH_START_TS,
      )
      // newest first
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    // Swallow RPC errors so the page renders an empty state rather than a 500.
    console.error("[markets] fetchAllMarkets failed:", err);
    return [];
  }
}

export async function fetchMarketByAddress(
  connection: Connection,
  pk: PublicKey | string,
): Promise<MarketView | null> {
  const program = getProgram(connection);
  let key: PublicKey;
  try {
    key = typeof pk === "string" ? new PublicKey(pk) : pk;
  } catch {
    return null;
  }
  try {
    const raw = await program.account.market.fetch(key);
    return toMarketView(key, raw);
  } catch (err) {
    console.error(`[markets] fetchMarketByAddress(${key.toBase58()}) failed:`, err);
    return null;
  }
}

/**
 * Derive the YES, NO, and vault token account PDAs for a market.
 * Mirrors the seeds in `packages/programs/programs/prediction-market/src/state/market.rs`
 * and in the IDL's `buy_shares` accounts block.
 */
export function deriveMarketPdas(
  programId: PublicKey,
  market: PublicKey,
): { yesMint: PublicKey; noMint: PublicKey; vault: PublicKey } {
  const [yesMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), market.toBuffer()],
    programId,
  );
  const [noMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), market.toBuffer()],
    programId,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    programId,
  );
  return { yesMint, noMint, vault };
}

export async function fetchMarketsByCreator(
  connection: Connection,
  createdBy: string,
): Promise<MarketView[]> {
  // We filter client-side over the full list: (a) the result set is tiny
  // on devnet, (b) memcmp offsets move whenever the Market struct layout
  // changes and this codepath doesn't hot-loop. If devnet grows to
  // thousands of markets, swap this for a `memcmp` filter on the
  // `createdBy` offset (computed from Market struct layout in
  // state/market.rs).
  const all = await fetchAllMarkets(connection);
  return all.filter((m) => m.createdBy === createdBy);
}
