/**
 * rate-surfaces.ts — TS mirrors of every on-chain rate reader.
 *
 * Each function takes an explicit `Connection` so the same code runs against
 * the MAINNET_RPC_URL (for real rate observation) or devnet (fallback).
 * Functions are fail-quiet: they return 0 on missing/malformed data so the
 * LLM brain treats that as "unknown" and can decide accordingly.
 *
 * Byte offsets mirror the Rust nav_readers. Any changes here must be
 * validated with the corresponding probe:* scripts.
 *
 * Selector table (matches on-chain rate_readers/mod.rs):
 *   1 — Kamino USDC supply utilization (bps)
 *   2 — Marinade mSOL price premium over 1.0 SOL (bps above par)
 *   3 — MarginFi USDC bank utilization (bps)
 *   4 — SPL Stake Pool SOL exchange rate premium (bps above par) — covers Jito / BlazeStake
 *   5 — Drift SOL-PERP funding rate (bps, positive = longs pay shorts)
 */
import { Connection, PublicKey } from "@solana/web3.js";

// ─────────────────────────────────────────────────────────────────────────
// Kamino USDC reserve — selector 1
// ─────────────────────────────────────────────────────────────────────────

export const KAMINO_USDC_RESERVE_DEVNET = new PublicKey(
  "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy",
);
export const KAMINO_USDC_RESERVE_MAINNET = new PublicKey(
  "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
);

const RESERVE_OFFSET_LIQUIDITY_AVAILABLE = 224;
const RESERVE_OFFSET_LIQUIDITY_BORROWED_SF = 232;
const RESERVE_MIN_LEN = 1384;
const SF_SCALE_BITS = 60n;

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
// Marinade mSOL price — selector 2
// ─────────────────────────────────────────────────────────────────────────

export const MARINADE_STATE_PDA = new PublicKey(
  "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC",
);

const STATE_OFFSET_MSOL_PRICE = 512;
const STATE_MIN_LEN = STATE_OFFSET_MSOL_PRICE + 8;
const MSOL_PRICE_SCALE_BITS = 32n;

export async function readMarinadeMsolAboveBps(conn: Connection): Promise<number> {
  try {
    const info = await conn.getAccountInfo(MARINADE_STATE_PDA, "confirmed");
    if (!info || info.data.length < STATE_MIN_LEN) return 0;
    const raw = info.data.readBigUInt64LE(STATE_OFFSET_MSOL_PRICE);
    const one = 1n << MSOL_PRICE_SCALE_BITS;
    if (raw <= one) return 0;
    const bps = ((raw - one) * 10000n) / one;
    // Cap at 100% premium as a sanity bound. mSOL has been compounding
    // since 2021 and currently sits ~3800bps (~38%) above par — verified
    // against api2.marinade.finance/metrics_json. A 5000bps cap would
    // bind today; keep room for the next decade of yield accrual.
    return Number(bps > 10000n ? 10000n : bps);
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MarginFi USDC bank utilization — selector 3
//
// Bank layout (mrgnlabs/marginfi-v2, programs/marginfi/src/state/marginfi_group.rs):
//   [0..8]   Anchor discriminator
//   [8..40]  mint: Pubkey
//   [40]     mint_decimals: u8
//   [41..43] _pad_0: [u8; 2]
//   [43..51] flags: u64
//   [51..83] group: Pubkey
//   ...
//   The `total_asset_shares` and `total_liability_shares` (WrappedI80F48 = i128)
//   are deep inside the struct after BankConfig. Exact offsets need probe
//   verification — we use the asset_share_value/liability_share_value approach
//   from the outer Bank fields instead.
//
//   total_liability_shares: ~offset 600 (probe:marginfi to verify)
//   total_asset_shares:     ~offset 616 (probe:marginfi to verify)
//
// MAINNET USDC bank: 2s37akK2eyBbp8DZgCm7RtsaEz8eqqZyhu81pttYiEy3
// (main-pool; verify with `solana account 2s37ak...` on mainnet)
// ─────────────────────────────────────────────────────────────────────────

export const MARGINFI_USDC_BANK_MAINNET = new PublicKey(
  "2s37akK2eyBbp8DZgCm7RtsaEz8eqqZyhu81pttYiEy3",
);

const MARGINFI_BANK_TOTAL_LIABILITY_SHARES_OFFSET = 600;
const MARGINFI_BANK_TOTAL_ASSET_SHARES_OFFSET = 616;
const MARGINFI_BANK_MIN_LEN = MARGINFI_BANK_TOTAL_ASSET_SHARES_OFFSET + 16;

export async function readMarginfiUsdcUtilizationBps(
  conn: Connection,
  bank: PublicKey = MARGINFI_USDC_BANK_MAINNET,
): Promise<number> {
  try {
    const info = await conn.getAccountInfo(bank, "confirmed");
    if (!info || info.data.length < MARGINFI_BANK_MIN_LEN) return 0;
    // WrappedI80F48 is stored as two u64s (lo + hi). We treat as u128 for ratio.
    const liabLo = info.data.readBigUInt64LE(MARGINFI_BANK_TOTAL_LIABILITY_SHARES_OFFSET);
    const liabHi = info.data.readBigUInt64LE(MARGINFI_BANK_TOTAL_LIABILITY_SHARES_OFFSET + 8);
    const assetLo = info.data.readBigUInt64LE(MARGINFI_BANK_TOTAL_ASSET_SHARES_OFFSET);
    const assetHi = info.data.readBigUInt64LE(MARGINFI_BANK_TOTAL_ASSET_SHARES_OFFSET + 8);
    const liab = liabLo | (liabHi << 64n);
    const asset = assetLo | (assetHi << 64n);
    if (asset === 0n) return 0;
    const bps = (liab * 10000n) / asset;
    return Number(bps > 10000n ? 10000n : bps);
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SPL Stake Pool exchange rate — selector 4 (covers Jito / BlazeStake)
//
// StakePool layout (solana-labs/solana-program-library stake-pool/state.rs):
//   [0]       account_type: u8
//   [1..33]   manager: Pubkey
//   [33..65]  staker: Pubkey
//   [65..97]  stake_deposit_authority: Pubkey
//   [97]      stake_withdraw_bump_seed: u8
//   [98..130] validator_list: Pubkey
//   [130..162] reserve_stake: Pubkey
//   [162..194] pool_mint: Pubkey
//   [194..226] manager_fee_account: Pubkey
//   [226..258] token_program_id: Pubkey
//   [258..266] total_lamports: u64 LE   ★
//   [266..274] pool_token_supply: u64 LE ★
//
// Mainnet pool addresses — VERIFIED via getAccountInfo against
// api.mainnet-beta.solana.com (both return data with owner =
// SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy):
//   BlazeStake: stk9ApL5HeVAwPLr3TLhDXdZS8ptVu7zp6ov8HFDuMi
//               source: stake-docs.solblaze.org/developers/addresses
//   Jito:       Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb
//               source: igneous-labs/S test-utils/src/consts.rs
// (Earlier values stk9ApL5...HpwHA / Jito4APy...Poqu were copy-paste
//  errors that didn't exist on mainnet — splStakePoolAboveBps had
//  been silently returning 0 for the entire daemon's lifetime.)
//
// SOL/pool-token premium is CUMULATIVE since pool launch (compounding
// rewards), not annualised — a 4-year-old pool will sit ~3000–4000bps
// above par, not 200–800bps. The brain reads this premium relative to
// other LSTs to decide which to stake into.
// ─────────────────────────────────────────────────────────────────────────

export const BLAZE_STAKE_POOL_MAINNET = new PublicKey(
  "stk9ApL5HeVAwPLr3TLhDXdZS8ptVu7zp6ov8HFDuMi",
);

export const JITO_STAKE_POOL_MAINNET = new PublicKey(
  "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb",
);

const SPL_STAKE_POOL_TOTAL_LAMPORTS_OFFSET = 258;
const SPL_STAKE_POOL_TOKEN_SUPPLY_OFFSET = 266;
const SPL_STAKE_POOL_MIN_LEN = SPL_STAKE_POOL_TOKEN_SUPPLY_OFFSET + 8;

/**
 * Read the exchange rate of an SPL stake pool (lamports per pool token)
 * and return how many bps above 1.0 SOL per token the pool is.
 * The premium is CUMULATIVE — a healthy pool that's been running for
 * years will sit several thousand bps above par.
 */
export async function readSplStakePoolAboveBps(
  conn: Connection,
  pool: PublicKey = BLAZE_STAKE_POOL_MAINNET,
): Promise<number> {
  try {
    const info = await conn.getAccountInfo(pool, "confirmed");
    if (!info) {
      // Surface the empty-account case — usually means the RPC is rate-
      // limited or the wrong pool address is configured. Without this
      // log, the reader silently returns 0 and looks like the pool is
      // pinned to par (it isn't).
      console.warn(
        `[rate-surfaces] SPL stake pool ${pool.toBase58().slice(0, 12)}… returned no account info — RPC issue or wrong address?`,
      );
      return 0;
    }
    if (info.data.length < SPL_STAKE_POOL_MIN_LEN) {
      console.warn(
        `[rate-surfaces] SPL stake pool ${pool.toBase58().slice(0, 12)}… data too short (${info.data.length}b < ${SPL_STAKE_POOL_MIN_LEN}b)`,
      );
      return 0;
    }
    const totalLamports = info.data.readBigUInt64LE(SPL_STAKE_POOL_TOTAL_LAMPORTS_OFFSET);
    const tokenSupply = info.data.readBigUInt64LE(SPL_STAKE_POOL_TOKEN_SUPPLY_OFFSET);
    if (tokenSupply === 0n) return 0;
    // lamports_per_token expressed in 9-decimal units (1 SOL = 1e9 lamports)
    const lamperToken = (totalLamports * 1_000_000_000n) / tokenSupply;
    const one = 1_000_000_000n; // 1 SOL in lamports
    if (lamperToken <= one) return 0;
    const bps = ((lamperToken - one) * 10000n) / one;
    // Cap at 100% premium. Cumulative yield since pool launch — a
    // multi-year-old pool can sit several thousand bps above par.
    return Number(bps > 10000n ? 10000n : bps);
  } catch (err) {
    console.warn(
      `[rate-surfaces] SPL stake pool read failed: ${(err as Error).message}`,
    );
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Jupiter Perps SOL-PERP borrow rate — selector 5
//
// Replaces the old Zeta selector. Jupiter Perpetuals runs the active
// SOL perp venue against the JLP pool's per-asset Custody accounts.
//
// Reads the SOL Custody (`7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz`)
// and computes the current borrow rate from the on-chain jump-rate
// curve. Both `fundingRateState.hourlyFundingDbps` and
// `borrowsFundingRateState.hourlyFundingDbps` have been zeroed since
// Jupiter migrated to dynamic curve-driven rates — verified by direct
// mainnet getAccountInfo on 2026-05-08 (lastUpdate matched the call
// timestamp, both hourly fields = 0).
//
// Borsh-packed offsets in the Custody account, derived from the
// julianfssen/jupiter-perps-anchor-idl-parsing IDL:
//   8-byte anchor discriminator, then
//   pool / mint / tokenAccount: 3 × Pubkey = 96  → ends at  104
//   decimals u8                         = 1     → ends at  105
//   isStable bool                       = 1     → ends at  106
//   oracle (OracleParams)               = 45    → ends at  151
//     oracleAccount Pubkey 32, oracleType u8 1, buffer u64 8, maxPriceAgeSec u32 4
//   pricing (PricingParams) 6 × u64     = 48    → ends at  199
//   permissions 7 × bool                = 7     → ends at  206
//   targetRatioBps u64                  = 8     → ends at  214
//   assets (Assets) 6 × u64             = 48    → ends at  262
//     ★ assets.owned  at offset 214 + 8  = 222 (u64)
//     ★ assets.locked at offset 214 + 16 = 230 (u64)
//   fundingRateState (legacy, zeroed)   = 32    → ends at  294
//   bump u8 + tokenAccountBump u8       = 2     → ends at  296
//   increase/decrease/maxPosition 3×u64 = 24    → ends at  320
//   dovesOracle Pubkey                  = 32    → ends at  352
//   jumpRateState 4 × u64               = 32    → ends at  384
//     ★ minRateBps              at 352 (u64, annualised bps)
//     ★ maxRateBps              at 360 (u64)
//     ★ targetRateBps           at 368 (u64)
//     ★ targetUtilizationRate   at 376 (u64, 9-decimal scale; 0.8 = 800_000_000)
// ─────────────────────────────────────────────────────────────────────────

export const JUPITER_PERPS_PROGRAM_ID = new PublicKey(
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu",
);

export const JUP_PERPS_SOL_CUSTODY_MAINNET = new PublicKey(
  "7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz",
);

const CUSTODY_OFFSET_ASSETS_OWNED = 222;
const CUSTODY_OFFSET_ASSETS_LOCKED = 230;
const CUSTODY_OFFSET_JUMP_MIN_RATE_BPS = 352;
const CUSTODY_OFFSET_JUMP_MAX_RATE_BPS = 360;
const CUSTODY_OFFSET_JUMP_TARGET_RATE_BPS = 368;
const CUSTODY_OFFSET_JUMP_TARGET_UTIL = 376;
/** Min length we need to safely read all jumpRateState fields. */
const CUSTODY_MIN_LEN = CUSTODY_OFFSET_JUMP_TARGET_UTIL + 8;
/** targetUtilizationRate is stored in a 9-decimal fraction (1.0 = 1e9). */
const JUMP_UTIL_SCALE = 1_000_000_000n;

/**
 * Read SOL-PERP annualised borrow rate (bps) from Jupiter's jump-rate
 * curve on the SOL Custody account. Computed live from current pool
 * utilization and the on-chain curve parameters — varies meaningfully
 * across ticks, so the brain's input-hash dedup can stop pinning the
 * agent to noop.
 *
 * Returns 0 (the safe "no signal" sentinel matching the other readers)
 * on any RPC / parse failure.
 */
export async function readJupSolPerpFundingBps(conn: Connection): Promise<number> {
  try {
    const info = await conn.getAccountInfo(JUP_PERPS_SOL_CUSTODY_MAINNET, "confirmed");
    if (!info) {
      console.warn(
        `[rate-surfaces] Jupiter Perps SOL custody returned no account info — RPC issue?`,
      );
      return 0;
    }
    if (info.data.length < CUSTODY_MIN_LEN) {
      console.warn(
        `[rate-surfaces] Jupiter Perps SOL custody data too short (${info.data.length}b < ${CUSTODY_MIN_LEN}b)`,
      );
      return 0;
    }
    const owned = info.data.readBigUInt64LE(CUSTODY_OFFSET_ASSETS_OWNED);
    const locked = info.data.readBigUInt64LE(CUSTODY_OFFSET_ASSETS_LOCKED);
    const minRate = info.data.readBigUInt64LE(CUSTODY_OFFSET_JUMP_MIN_RATE_BPS);
    const maxRate = info.data.readBigUInt64LE(CUSTODY_OFFSET_JUMP_MAX_RATE_BPS);
    const targetRate = info.data.readBigUInt64LE(CUSTODY_OFFSET_JUMP_TARGET_RATE_BPS);
    const targetUtil = info.data.readBigUInt64LE(CUSTODY_OFFSET_JUMP_TARGET_UTIL);

    // Empty pool → no meaningful rate. Returning min handles the cold-start
    // case the same way Jupiter's own UI does.
    if (owned === 0n) return Number(minRate);

    // utilization in the same 9-decimal scale as targetUtilizationRate, so
    // the comparisons stay in pure bigint.
    const utilScaled = (locked * JUMP_UTIL_SCALE) / owned;

    let rate: bigint;
    if (utilScaled <= targetUtil) {
      // Linear ramp from minRate → targetRate as utilization goes 0 → target.
      // rate = min + (util / target) * (target - min)
      if (targetUtil === 0n) {
        rate = targetRate;
      } else {
        rate = minRate + ((targetRate - minRate) * utilScaled) / targetUtil;
      }
    } else {
      // Steeper ramp from targetRate → maxRate as utilization goes
      // target → 100%. rate = target + ((util - target) / (1 - target)) * (max - target)
      const num = (maxRate - targetRate) * (utilScaled - targetUtil);
      const denom = JUMP_UTIL_SCALE - targetUtil;
      rate = denom === 0n ? maxRate : targetRate + num / denom;
    }
    if (rate > maxRate) rate = maxRate;
    return Number(rate);
  } catch (err) {
    console.warn(
      `[rate-surfaces] Jupiter Perps SOL custody read failed: ${(err as Error).message}`,
    );
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level: compose all rate surfaces with a chain hint
// ─────────────────────────────────────────────────────────────────────────

export interface RateSurfaces {
  /** Kamino USDC pool utilization (0-10000 bps). Selector 1. */
  kaminoUsdcUtilizationBps: number;
  /** Marinade mSOL price premium over 1.0 SOL (bps above par). Selector 2. */
  marinadeMsolAboveBps: number;
  /** MarginFi (retired). Always 0; kept on the type for backwards compat
   *  with existing brain prompts that reference it. */
  marginfiUsdcUtilizationBps: number;
  /** SPL Stake Pool (Jito/BlazeStake) exchange rate premium (bps above 1.0 SOL). Selector 4. */
  splStakePoolAboveBps: number;
  /** Jupiter Perps SOL-PERP funding rate (bps annualised). Selector 5. */
  jupSolPerpFundingBps: number;
  /** The chain these reads ran against ("mainnet" | "devnet"). */
  chain: string;
  /** Kamino reserve address used. */
  kaminoReserve: string;
}

/**
 * Read all rate surfaces from a single connection. Pass "mainnet" to use
 * mainnet reserve/state addresses (observation via MAINNET_RPC_URL);
 * anything else uses devnet test addresses.
 *
 * All reads are parallel and fail-quiet. The full surface is always returned
 * even if individual protocols are unreachable.
 */
export async function readAllRateSurfaces(
  conn: Connection,
  chain: "mainnet" | "devnet",
): Promise<RateSurfaces> {
  const reserve =
    chain === "mainnet"
      ? KAMINO_USDC_RESERVE_MAINNET
      : KAMINO_USDC_RESERVE_DEVNET;

  const [
    kaminoUsdcUtilizationBps,
    marinadeMsolAboveBps,
    splStakePoolAboveBps,
    jupSolPerpFundingBps,
  ] = await Promise.all([
    readKaminoUsdcUtilizationBps(conn, reserve),
    readMarinadeMsolAboveBps(conn),
    // SPL stake pool and Jupiter Perps only meaningful on mainnet.
    chain === "mainnet" ? readSplStakePoolAboveBps(conn) : Promise.resolve(0),
    chain === "mainnet" ? readJupSolPerpFundingBps(conn) : Promise.resolve(0),
  ]);
  const marginfiUsdcUtilizationBps = 0;  // retired protocol

  return {
    kaminoUsdcUtilizationBps,
    marinadeMsolAboveBps,
    marginfiUsdcUtilizationBps,
    splStakePoolAboveBps,
    jupSolPerpFundingBps,
    chain,
    kaminoReserve: reserve.toBase58(),
  };
}
