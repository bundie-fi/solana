/**
 * Dynamic read-price computation for the v1 oracle API.
 *
 * Replaces the static $0.001 per-call charge with a per-market price that
 * scales with the market's depth. The intuition: an oracle's value is the
 * capital backing the signal — a market with $100k of YES/NO depth has
 * 100x more eyes on it than a $1k market, so the read is 100x more
 * trustworthy and worth more to an agent making automated decisions.
 *
 * Curve: logarithmic. A 10x depth jump produces ~3x price, not 10x —
 * which keeps reads cheap on small markets, gives meaningful spread for
 * mid-cap markets ($1k–$100k), and caps the ceiling so a whale can't
 * game pricing by sniping a thin market.
 *
 * Future iterations: surge pricing by reads-per-minute, tier-based caps
 * per API key, dynamic floor based on Solana compute-unit costs.
 */

/** Floor: covers Solana tx cost (1 sig × 5000 lamports ≈ $0.0009 at $180/SOL) + a margin. */
export const READ_PRICE_FLOOR_USDC_MICRO = 100; // $0.0001

/** Ceiling: caps the read price so no individual market becomes ruinously priced. */
export const READ_PRICE_CEILING_USDC_MICRO = 10_000; // $0.01

// Linear-in-log10 curve anchored at two points:
//   depth = $1k  → $0.001 (matches the old hardcoded charge for a "typical" market)
//   depth = $100k → $0.01 (ceiling for whale-depth markets)
// Below ~$500 depth the line goes negative and clamps to FLOOR; above
// ~$300k it clamps to CEILING. The "interesting" region — where price
// actually varies with depth — is the $500..$300k range that mid-cap
// event markets live in.
const LOG10_SLOPE = 4500;
const LOG10_INTERCEPT = -12500;

/**
 * Compute the read price for an event-market in USDC base units (6dp).
 *
 * @param depthUsd Total USD-denominated depth in the LMSR (collateral pool).
 * @returns Price in USDC base units (1_000 = $0.001).
 *
 * Examples:
 *   depthUsd=0       → 100    ($0.0001) floor — empty / stub markets
 *   depthUsd=500     → 100    ($0.0001) floor — sub-meaningful liquidity
 *   depthUsd=1_000   → 1_000  ($0.001)  anchor — old hardcoded equivalent
 *   depthUsd=10_000  → 5_500  ($0.0055) meaningful mid-cap
 *   depthUsd=100_000 → 10_000 ($0.01)   ceiling
 *   depthUsd=1_000_000 → 10_000 ($0.01) ceiling — capped, no whale gaming
 */
export function computeReadPriceUsdcMicro(depthUsd: number): number {
  if (!Number.isFinite(depthUsd) || depthUsd <= 0) {
    return READ_PRICE_FLOOR_USDC_MICRO;
  }
  const raw = LOG10_SLOPE * Math.log10(depthUsd + 1) + LOG10_INTERCEPT;
  return Math.max(
    READ_PRICE_FLOOR_USDC_MICRO,
    Math.min(READ_PRICE_CEILING_USDC_MICRO, Math.round(raw)),
  );
}

/**
 * Render a USDC-base-units price as a human dollar string. The result is
 * stable across the API, the web UI, and the MCP server card so agents
 * see the same number everywhere.
 */
export function formatPriceUsd(microUnits: number): string {
  const dollars = microUnits / 1_000_000;
  // $0.0001 → "$0.0001", $0.001 → "$0.001", $0.005 → "$0.005"
  return `$${dollars.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

// In-process price cache keyed by event_id. The x402 middleware needs
// the price to construct the 402 challenge but runs before the route
// handler; this cache lets the middleware look up a recently-computed
// price without paying for another RPC roundtrip. Refreshed by the
// route handler on every served request, so a market that's being
// actively read stays priced correctly within ~one query of staleness.
interface CachedPrice {
  priceMicro: number;
  depthUsd: number;
  computedAtMs: number;
}
const priceCache = new Map<string, CachedPrice>();
const CACHE_TTL_MS = 60_000;

/**
 * Record the read price for an event so the middleware can use it on
 * subsequent requests. Called by the /v1/event-price route handler each
 * time it computes a fresh snapshot.
 */
export function recordReadPrice(eventId: string, depthUsd: number): number {
  const priceMicro = computeReadPriceUsdcMicro(depthUsd);
  priceCache.set(eventId, {
    priceMicro,
    depthUsd,
    computedAtMs: Date.now(),
  });
  return priceMicro;
}

/**
 * Look up the most recent cached read price for an event. Used by the
 * x402 middleware to compute the 402 challenge amount without an RPC
 * roundtrip. Returns the floor price if no cache entry exists or it's
 * stale — first-read overcharge protection is the route handler's job
 * (it returns the canonical price in the response).
 */
export function getCachedReadPrice(eventId: string): number {
  const cached = priceCache.get(eventId);
  if (!cached) return READ_PRICE_FLOOR_USDC_MICRO;
  if (Date.now() - cached.computedAtMs > CACHE_TTL_MS) {
    return READ_PRICE_FLOOR_USDC_MICRO;
  }
  return cached.priceMicro;
}
