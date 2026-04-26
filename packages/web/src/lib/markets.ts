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
 *   - Kind-specific fields: we pre-parse the 64-byte `payload` for the
 *     active kinds 1/2/3 BundieVault payloads so page components stay
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
// Post-vault-nav-resolution (Phase B+) markets only support these kinds:
//   kind=1 NavTarget   — payload[0..8]  = target_nav  (u64, lamports / 1e6 = bUSD)
//                        payload[8..16] = window_end_slot (optional)
//   kind=2 Relative    — head-to-head; agent A = `strategy`, agent B = `strategyB`.
//                        Payload is unused for the headline numbers; baselines
//                        come from `initialNavA` / `initialNavB`.
//   kind=3 Drawdown    — payload[0..8]  = drawdown_bps (u64)
//                        payload[8..16] = window_end_slot (optional)
//
// The legacy rate-reader selector (formerly at payload[24..32]) has been
// removed — Phase B+ resolves directly against `BundieVault.nav_lamports`.

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
  /** Market kind. Phase B+ supports 1 (NavTarget), 2 (Relative), 3 (Drawdown). */
  kind: number;
  /** Kind=1 target NAV in lamports (raw u64 from payload[0..8]); null otherwise. */
  targetNavLamports: number | null;
  /** Kind=3 drawdown in bps (raw u64 from payload[0..8]); null otherwise. */
  drawdownBps: number | null;
  /** Optional window end slot parsed from payload[8..16] for kinds 1 and 3. */
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
   * BundieVault NAV (lamports) snapshotted at create_market_v2 for vault A.
   * Used as the resolution baseline for kinds 1/2/3. Zero for any market
   * that did not flow through BundieVault.
   */
  initialNavA: bigint;
  /**
   * BundieVault NAV (lamports) for vault B. Populated only for kind=2
   * head-to-head markets; zero otherwise.
   */
  initialNavB: bigint;
  /**
   * For kind=2 (head-to-head) markets, the second agent vault — i.e., the
   * `strategyB` field on the Market account. Null for other kinds.
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

function toMarketView(
  address: PublicKey,
  raw: MarketAccountRaw,
): MarketView {
  const kind = Number(raw.kind ?? 0);
  const payloadBytes: number[] = Array.from(
    (raw.payload as unknown as number[] | Uint8Array) ?? [],
  );

  let targetNavLamports: number | null = null;
  let drawdownBps: number | null = null;
  let windowEndSlot: number | null = null;
  let targetAgent: string | null = null;

  if (kind === 1) {
    // NavTarget: payload[0..8] = target_nav (lamports), [8..16] = window_end_slot
    targetNavLamports = readU64LE(payloadBytes, 0);
    const wend = readU64LE(payloadBytes, 8);
    windowEndSlot = wend > 0 ? wend : null;
  } else if (kind === 3) {
    // Drawdown: payload[0..8] = drawdown_bps, [8..16] = window_end_slot
    drawdownBps = readU64LE(payloadBytes, 0);
    const wend = readU64LE(payloadBytes, 8);
    windowEndSlot = wend > 0 ? wend : null;
  } else if (kind === 2) {
    // Head-to-head: agent B comes from Market.strategyB (option<pubkey>),
    // not from the payload.
    const sb = raw.strategyB as PublicKey | null | undefined;
    if (sb) {
      try {
        targetAgent = sb.toBase58();
      } catch {
        targetAgent = null;
      }
    }
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
    targetNavLamports,
    drawdownBps,
    windowEndSlot,
    resolutionSlot: toNumber(raw.resolutionSlot as BN),
    createdAt: toNumber(raw.createdAt as BN),
    totalVolume: toNumber(raw.totalVolume as BN),
    feeBps: Number(raw.feeBps ?? 0),
    status,
    outcome,
    initialNavPerShare: toNumber(raw.initialNavPerShare as BN),
    initialNavA: toBigInt(raw.initialNavA as BN | bigint | number | undefined),
    initialNavB: toBigInt(raw.initialNavB as BN | bigint | number | undefined),
    targetAgent,
    yesShares: toNumber(raw.yesShares as BN),
    noShares: toNumber(raw.noShares as BN),
    collateralMint: (raw.collateralMint as PublicKey).toBase58(),
    strategy: (raw.strategy as PublicKey).toBase58(),
    vault: (raw.vault as PublicKey).toBase58(),
  };
}

function toBigInt(v: BN | number | bigint | undefined | null): bigint {
  if (v == null) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.max(0, Math.floor(v)));
  // BN — use toString to avoid precision loss for >53-bit values.
  try {
    return BigInt(v.toString());
  } catch {
    return 0n;
  }
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

// ─── BundieVault reader ──────────────────────────────────────────────────

/**
 * Server-safe BundieVault snapshot. Mirrors the on-chain account layout
 * from `state/bundie_vault.rs` but converts u64 values to bigint so the
 * RSC boundary doesn't choke on BN. The `commitDigest` is omitted — the
 * UI doesn't surface it and skipping it keeps the type plain-serialisable.
 */
export interface BundieVaultView {
  authority: string;
  navLamports: bigint;
  navEpoch: bigint;
  navSlot: bigint;
}

/** Derive the BundieVault PDA: `["bundie_vault", authority]`. */
export function deriveBundieVaultPda(
  programId: PublicKey,
  authority: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bundie_vault"), authority.toBuffer()],
    programId,
  );
  return pda;
}

/**
 * Fetch the BundieVault for the given authority. Returns null when the
 * account doesn't exist yet (e.g. an agent that hasn't committed any NAV)
 * — callers should render an em-dash placeholder.
 */
export async function fetchBundieVault(
  connection: Connection,
  programId: PublicKey,
  authority: PublicKey | string,
): Promise<BundieVaultView | null> {
  let auth: PublicKey;
  try {
    auth =
      typeof authority === "string" ? new PublicKey(authority) : authority;
  } catch {
    return null;
  }
  const program = getProgram(connection);
  const pda = deriveBundieVaultPda(programId, auth);
  try {
    const raw = await program.account.bundieVault.fetch(pda);
    return {
      authority: (raw.authority as PublicKey).toBase58(),
      navLamports: toBigInt(
        raw.navLamports as BN | bigint | number | undefined,
      ),
      navEpoch: toBigInt(raw.navEpoch as BN | bigint | number | undefined),
      navSlot: toBigInt(raw.navSlot as BN | bigint | number | undefined),
    };
  } catch {
    // Anchor throws when the account doesn't exist; treat as "no NAV yet".
    return null;
  }
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
