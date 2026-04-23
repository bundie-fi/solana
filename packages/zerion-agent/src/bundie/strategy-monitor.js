/**
 * Bundie x Zerion — Strategy monitor.
 *
 * Reads a Bundie strategy's Strategy + NavOracle accounts (devnet) and
 * computes:
 *   - current composition (mint -> usd %) of the strategy wallet PDA
 *   - drift vs target composition
 *   - rebalance proposals (which mint to swap into which, for what notional)
 *
 * Field offsets mirror packages/programs/programs/strategy-token/src/state/{strategy,nav_oracle}.rs
 *   STRATEGY_DISCRIMINATOR = [0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11]
 *   NAV_ORACLE_DISCRIMINATOR = [0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05]
 *
 * Strategy layout (offsets after the 8-byte discriminator):
 *   8   authority    : Pubkey   (32)
 *   40  mint         : Pubkey   (32)
 *   72  wallet       : Pubkey   (32)
 *   104 deposit_mint : Pubkey   (32)
 *   136 protocol     : Pubkey   (32)
 *   168 reserve      : Pubkey   (32)
 *   200 name         : [u8; 32] (32)
 *   232 strategy_type: u8       (1)
 *   233 status       : u8       (1)
 *   234 fee_bps      : u16 LE   (2)
 *   236 total_deposits: u64 LE  (8)
 *   244 current_nav  : u64 LE   (8)
 *   252 total_shares : u64 LE   (8)
 *   ...
 *
 * NavOracle layout (offsets after the 8-byte discriminator):
 *   8   strategy            : Pubkey (32)
 *   40  nav_per_share       : u64 LE (8)
 *   48  twap_value          : u64 LE (8)
 *   56  snapshot_count      : u64 LE (8)
 *   64  last_snapshot_slot  : u64 LE (8)
 *   72  min_snapshot_interval: u64 LE (8)
 *   80  twap_window         : u64 LE (8)
 *   88  bump                : u8     (1)
 */

import { Connection, PublicKey } from "@solana/web3.js";

export const STRATEGY_DISCRIMINATOR = Buffer.from([0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11]);
export const NAV_ORACLE_DISCRIMINATOR = Buffer.from([0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05]);
export const NAV_ORACLE_LEN = 89;

// ---- Decoders -------------------------------------------------------------

export function decodeStrategy(data) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length < 252 + 8) throw new Error("Strategy account too small");
  const disc = data.subarray(0, 8);
  if (!disc.equals(STRATEGY_DISCRIMINATOR)) {
    throw new Error("Strategy account discriminator mismatch");
  }
  const authority = new PublicKey(data.subarray(8, 40)).toBase58();
  const mint = new PublicKey(data.subarray(40, 72)).toBase58();
  const wallet = new PublicKey(data.subarray(72, 104)).toBase58();
  const depositMint = new PublicKey(data.subarray(104, 136)).toBase58();
  const protocol = new PublicKey(data.subarray(136, 168)).toBase58();
  const reserve = new PublicKey(data.subarray(168, 200)).toBase58();
  const nameRaw = data.subarray(200, 232);
  const name = nameRaw.toString("utf8").replace(/\0+$/g, "").trim();
  const strategyType = data.readUInt8(232);
  const status = data.readUInt8(233);
  const feeBps = data.readUInt16LE(234);
  const totalDeposits = data.readBigUInt64LE(236);
  const currentNav = data.readBigUInt64LE(244);
  const totalShares = data.readBigUInt64LE(252);
  return {
    authority,
    mint,
    wallet,
    depositMint,
    protocol,
    reserve,
    name,
    strategyType,
    status,
    feeBps,
    totalDeposits,
    currentNav,
    totalShares,
  };
}

export function decodeNavOracle(data) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length < NAV_ORACLE_LEN) throw new Error(`NavOracle account too small: ${data.length} < ${NAV_ORACLE_LEN}`);
  const disc = data.subarray(0, 8);
  if (!disc.equals(NAV_ORACLE_DISCRIMINATOR)) {
    throw new Error("NavOracle discriminator mismatch");
  }
  const strategy = new PublicKey(data.subarray(8, 40)).toBase58();
  const navPerShare = data.readBigUInt64LE(40);
  const twapValue = data.readBigUInt64LE(48);
  const snapshotCount = data.readBigUInt64LE(56);
  const lastSnapshotSlot = data.readBigUInt64LE(64);
  const minSnapshotInterval = data.readBigUInt64LE(72);
  const twapWindow = data.readBigUInt64LE(80);
  const bump = data.readUInt8(88);
  return {
    strategy,
    navPerShare,
    twapValue,
    snapshotCount,
    lastSnapshotSlot,
    minSnapshotInterval,
    twapWindow,
    bump,
  };
}

// ---- On-chain reader ------------------------------------------------------

/**
 * Pure-RPC reader. The connection is injected so tests can pass a mock.
 * @param {{ getAccountInfo(pk: PublicKey): Promise<{ data: Buffer } | null> }} connection
 * @param {string|PublicKey} strategyPk
 * @param {string|PublicKey} navOraclePk
 */
export async function loadStrategyState(connection, strategyPk, navOraclePk) {
  const stratPk = strategyPk instanceof PublicKey ? strategyPk : new PublicKey(strategyPk);
  const navPk = navOraclePk instanceof PublicKey ? navOraclePk : new PublicKey(navOraclePk);
  const [stratAcct, navAcct] = await Promise.all([
    connection.getAccountInfo(stratPk),
    connection.getAccountInfo(navPk),
  ]);
  if (!stratAcct) throw new Error(`Strategy account not found: ${stratPk.toBase58()}`);
  if (!navAcct) throw new Error(`NavOracle account not found: ${navPk.toBase58()}`);
  return {
    strategy: decodeStrategy(stratAcct.data),
    navOracle: decodeNavOracle(navAcct.data),
  };
}

export function makeRpcConnection(endpoint) {
  return new Connection(endpoint, "confirmed");
}

// ---- Composition + drift logic --------------------------------------------

/**
 * Given a balances map (mint -> { amount, decimals, usdPrice }) and a target
 * weights map (mint -> percent 0-100), compute current weights and per-mint
 * drift in absolute percentage points.
 *
 * @returns {{ totalUsd: number, current: Record<string,number>, target: Record<string,number>, drift: Record<string,number> }}
 */
export function computeComposition(balances, target) {
  const sumTarget = Object.values(target).reduce((s, v) => s + Number(v), 0);
  if (Math.abs(sumTarget - 100) > 0.01) {
    throw new Error(`Target composition must sum to 100; got ${sumTarget}`);
  }
  const usdPerMint = {};
  let totalUsd = 0;
  for (const [mint, info] of Object.entries(balances || {})) {
    const amt = Number(info.amount);
    const dec = Number(info.decimals ?? 0);
    const px = Number(info.usdPrice ?? 0);
    if (!Number.isFinite(amt) || !Number.isFinite(dec) || !Number.isFinite(px)) {
      throw new Error(`Invalid balance entry for ${mint}`);
    }
    const usd = (amt / 10 ** dec) * px;
    usdPerMint[mint] = usd;
    totalUsd += usd;
  }
  const current = {};
  const drift = {};
  for (const mint of Object.keys(target)) {
    const usd = usdPerMint[mint] || 0;
    const pct = totalUsd > 0 ? (usd / totalUsd) * 100 : 0;
    current[mint] = pct;
    drift[mint] = pct - Number(target[mint]); // positive => over-weight
  }
  return { totalUsd, current, target: { ...target }, drift };
}

/**
 * Generate rebalance proposals. The biggest over-weight mint is reduced and
 * the biggest under-weight mint is increased, in a single proposal whose
 * notional equals the smaller of the two USD imbalances. Anything below the
 * trigger threshold is skipped.
 *
 * @param {ReturnType<typeof computeComposition>} composition
 * @param {object} opts
 * @param {number} opts.driftThresholdPct - emit proposals only if absolute drift > this
 * @param {Record<string, { symbol?: string, decimals?: number, usdPrice?: number }>} opts.mintMeta
 * @returns {Array<{ fromMint: string, toMint: string, fromSymbol?: string, toSymbol?: string, notionalUsd: number, driftFrom: number, driftTo: number }>}
 */
export function proposeRebalance(composition, { driftThresholdPct, mintMeta = {} }) {
  const proposals = [];
  if (!Number.isFinite(driftThresholdPct) || driftThresholdPct < 0) {
    throw new Error("driftThresholdPct must be a non-negative number");
  }
  const { totalUsd, drift } = composition;
  if (totalUsd <= 0) return proposals;

  const entries = Object.entries(drift);
  const over = entries.filter(([, d]) => d > driftThresholdPct).sort((a, b) => b[1] - a[1]);
  const under = entries.filter(([, d]) => d < -driftThresholdPct).sort((a, b) => a[1] - b[1]);
  if (over.length === 0 || under.length === 0) return proposals;

  const [fromMint, fromDrift] = over[0];
  const [toMint, toDrift] = under[0];
  // Convert percentage-point drift to USD.
  const fromUsd = (fromDrift / 100) * totalUsd; // positive
  const toUsd = (-toDrift / 100) * totalUsd;    // positive
  const notionalUsd = Math.min(fromUsd, toUsd);
  if (notionalUsd <= 0) return proposals;

  proposals.push({
    fromMint,
    toMint,
    fromSymbol: mintMeta[fromMint]?.symbol,
    toSymbol: mintMeta[toMint]?.symbol,
    notionalUsd,
    driftFrom: fromDrift,
    driftTo: toDrift,
  });
  return proposals;
}
