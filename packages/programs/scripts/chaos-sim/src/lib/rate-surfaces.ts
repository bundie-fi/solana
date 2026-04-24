/**
 * rate-surfaces.ts — TS ports of the Rust nav_readers (Kamino + Marinade)
 * adapted so every function takes an explicit `Connection`. This is what
 * lets the same code run against surfpool (mainnet-fork state) or devnet.
 *
 * Byte offsets mirror:
 *   - packages/beethoven/crates/deposit/kamino/src/lib.rs  (Reserve layout)
 *   - packages/beethoven/crates/deposit/marinade/src/lib.rs (State layout)
 *
 * Do NOT refactor offsets without running probe:kamino / probe:marinade.
 */
import { Connection, PublicKey } from "@solana/web3.js";

// ─────────────────────────────────────────────────────────────────────────
// Reserve / State fixtures
// ─────────────────────────────────────────────────────────────────────────

/** Devnet test reserve (verified live). */
export const KAMINO_USDC_RESERVE_DEVNET = new PublicKey(
  "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy",
);
/** Mainnet Main-Market USDC reserve (used when reading surfpool fork). */
export const KAMINO_USDC_RESERVE_MAINNET = new PublicKey(
  "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
);

/** Marinade State PDA (same on mainnet + devnet — Marinade is a single
 *  program with one global State account). */
export const MARINADE_STATE_PDA = new PublicKey(
  "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC",
);

// Offsets — MUST match nav_readers and probe scripts.
const RESERVE_OFFSET_LIQUIDITY_AVAILABLE = 224;
const RESERVE_OFFSET_LIQUIDITY_BORROWED_SF = 232;
const RESERVE_MIN_LEN = 1384;
const SF_SCALE_BITS = 60n;

const STATE_OFFSET_MSOL_PRICE = 512;
const STATE_MIN_LEN = STATE_OFFSET_MSOL_PRICE + 8;
const MSOL_PRICE_SCALE_BITS = 32n;

// ─────────────────────────────────────────────────────────────────────────
// Kamino — reserve utilization (0..10000 bps)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read utilization (borrowed / (borrowed + available)) expressed in bps.
 * This is the same selector-1 value the prediction-market program reads
 * via its Rust rate-reader; we ship a TS mirror so agents can observe the
 * number off-chain before building a market.
 *
 * Returns 0 on:
 *   - account-not-found (surfpool hasn't JIT-fetched yet)
 *   - short data
 *   - zero total (empty reserve)
 */
export async function readKaminoUsdcUtilizationBps(
  conn: Connection,
  reserve: PublicKey,
): Promise<number> {
  try {
    const info = await conn.getAccountInfo(reserve, "confirmed");
    if (!info || info.data.length < RESERVE_MIN_LEN) return 0;
    const available = info.data.readBigUInt64LE(RESERVE_OFFSET_LIQUIDITY_AVAILABLE);
    const bs0 = info.data.readBigUInt64LE(RESERVE_OFFSET_LIQUIDITY_BORROWED_SF);
    const bs1 = info.data.readBigUInt64LE(RESERVE_OFFSET_LIQUIDITY_BORROWED_SF + 8);
    const borrowedSf = bs0 | (bs1 << 64n);
    const borrowed = borrowedSf >> SF_SCALE_BITS;
    const total = available + borrowed;
    if (total === 0n) return 0;
    const bps = (borrowed * 10000n) / total;
    return Number(bps > 10000n ? 10000n : bps);
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Marinade — mSOL/SOL ratio (bps above 1.0)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read Marinade msol_price (Q32.32 fixed-point) and return the ratio above
 * 1.0 expressed in bps. 0 means "at peg or unreadable", 150 means "mSOL
 * trades at 1.015 SOL/mSOL (+1.5%)".
 *
 * Returns 0 on any read failure (fail-quiet — the prompt can treat 0 as
 * "unknown" and act accordingly).
 */
export async function readMarinadeMsolAboveBps(conn: Connection): Promise<number> {
  try {
    const info = await conn.getAccountInfo(MARINADE_STATE_PDA, "confirmed");
    if (!info || info.data.length < STATE_MIN_LEN) return 0;
    const raw = info.data.readBigUInt64LE(STATE_OFFSET_MSOL_PRICE);
    const one = 1n << MSOL_PRICE_SCALE_BITS;
    if (raw <= one) return 0;
    // (raw - one) / one * 10000 in bigint math
    const bps = ((raw - one) * 10000n) / one;
    // Clamp — mSOL has historically stayed under 2.0 SOL/mSOL. We cap at
    // 5000bps (+50%) to avoid surfacing nonsense numbers from a layout-drift
    // regression; the probe script is the canonical layout guard.
    return Number(bps > 5000n ? 5000n : bps);
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level — compose both surfaces with a chain hint
// ─────────────────────────────────────────────────────────────────────────

export interface RateSurfaces {
  kaminoUsdcUtilizationBps: number;
  marinadeMsolAboveBps: number;
  /** "surfpool" or "devnet" — the chain this read actually ran against. */
  chain: string;
  /** The reserve we read (different between mainnet-fork and devnet). */
  kaminoReserve: string;
}

/**
 * Read both rate surfaces from the given connection. Pass "surfpool" as
 * chain to use the mainnet-fork reserve; anything else uses the devnet
 * test reserve.
 */
export async function readAllRateSurfaces(
  conn: Connection,
  chain: "surfpool" | "devnet",
): Promise<RateSurfaces> {
  const reserve =
    chain === "surfpool"
      ? KAMINO_USDC_RESERVE_MAINNET
      : KAMINO_USDC_RESERVE_DEVNET;
  const [kaminoUsdcUtilizationBps, marinadeMsolAboveBps] = await Promise.all([
    readKaminoUsdcUtilizationBps(conn, reserve),
    readMarinadeMsolAboveBps(conn),
  ]);
  return {
    kaminoUsdcUtilizationBps,
    marinadeMsolAboveBps,
    chain,
    kaminoReserve: reserve.toBase58(),
  };
}
