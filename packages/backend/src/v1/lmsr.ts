/**
 * LMSR pricing helpers for binary YES/NO event markets.
 *
 * Mirrors the on-chain LS-LMSR semantics in
 * `packages/programs/programs/prediction-market/src/math/lmsr.rs`. For the
 * v1 read path we only need the marginal YES price (instantaneous next-
 * share price) and the implied probability — both are the same number
 * under standard LMSR semantics.
 *
 * Numerical stability: we use the log-sum-exp trick so that the
 * exponentials stay bounded when qYes/b or qNo/b is large.
 */

/**
 * Compute the YES share price for a binary LS-LMSR market.
 *
 * @param qYes   YES shares outstanding (u64 → number; for amounts beyond
 *               2^53 use BigInt, but in practice b * ln(2) keeps us well
 *               below that range for v1).
 * @param qNo    NO shares outstanding.
 * @param b      LMSR liquidity parameter (the same `liquidity_param`
 *               recorded on `Market`).
 * @returns      YES share price in [0, 1]. 0.5 when the market has no
 *               trades yet (qYes == qNo == 0).
 */
export function yesPrice(qYes: number, qNo: number, b: number): number {
  if (b <= 0) return 0.5;
  if (qYes === 0 && qNo === 0) return 0.5;
  const a = qYes / b;
  const c = qNo / b;
  // log-sum-exp normalisation
  const max = Math.max(a, c);
  const eA = Math.exp(a - max);
  const eC = Math.exp(c - max);
  const denom = eA + eC;
  if (denom <= 0) return 0.5;
  return eA / denom;
}

/**
 * Compute a confidence score in [0, 1] for a market price based on its
 * depth (collateral pool size), trade count, and unique trader count.
 *
 * Heuristic: a market with $0 depth or 0 trades returns confidence=0.
 * A market with $10k+ depth, 50+ trades, and 10+ unique traders returns
 * ~1.0. Three independent factors averaged so any one being thin pulls
 * the score down.
 */
export function confidenceScore(
  depthUsd: number,
  tradeCount24h: number,
  uniqueTraders24h: number,
): number {
  if (depthUsd <= 0 || tradeCount24h <= 0) return 0;
  const depthFactor = Math.min(1, Math.log10(depthUsd + 1) / Math.log10(10001));
  const tradeFactor = Math.min(1, tradeCount24h / 50);
  const traderFactor = Math.min(1, uniqueTraders24h / 10);
  return (depthFactor + tradeFactor + traderFactor) / 3;
}

/** Convert USDC u64 raw to a USD-display number with 6 decimal precision. */
export function usdcRawToUsd(raw: number | bigint): number {
  const n = typeof raw === "bigint" ? Number(raw) : raw;
  return n / 1_000_000;
}
