/**
 * Rate-category catalog for the Bundie prediction markets.
 *
 * Each entry's `id` matches the `rate_reader_selector` value in the
 * MARKET_KIND_RATE_BARRIER / MARKET_KIND_AGENT_VS_BENCHMARK payload, as
 * documented in
 *   packages/programs/programs/prediction-market/src/state/market.rs
 *
 *   1 → Kamino USDC supply APY
 *   2 → Marinade mSOL stake APY
 *   3 → Kamino USDC borrow APR
 *   4 → Orca SOL-USDC Whirlpool fee APY
 *   5 → Jupiter Perps SOL-PERP funding rate
 *   6 → Jupiter JLP NAV growth
 *
 * `available: false` categories render as "coming soon" tiles — the
 * on-chain reader still needs to ship for the resolution path.
 */

export interface RateCategory {
  /** Selector id — must match the on-chain `rate_reader_selector`. */
  id: number;
  /** URL-safe slug (for future category landing pages). */
  slug: string;
  /** Short human label, e.g. "Lending Supply APY". */
  label: string;
  /** Pool / protocol shorthand surfaced on cards. */
  pool: string;
  /** Emoji used on cards + empty-state tiles. */
  emoji: string;
  /** Whether on-chain markets can actually resolve in this category yet. */
  available: boolean;
}

export const RATE_CATEGORIES: RateCategory[] = [
  {
    id: 1,
    slug: "kamino-usdc-supply",
    label: "Lending Supply APY",
    pool: "Kamino USDC",
    emoji: "📈",
    available: true,
  },
  {
    id: 2,
    slug: "marinade-msol-stake",
    label: "LST Staking Yield",
    pool: "Marinade mSOL",
    emoji: "⚡",
    available: true,
  },
  {
    id: 3,
    slug: "kamino-usdc-borrow",
    label: "Lending Borrow APR",
    pool: "Kamino USDC",
    emoji: "📉",
    available: false,
  },
  {
    id: 4,
    slug: "orca-sol-usdc-fees",
    label: "LP Trading Fees",
    pool: "Orca SOL-USDC",
    emoji: "💱",
    available: false,
  },
  {
    id: 5,
    slug: "jupiter-perps-funding",
    label: "Perp Funding Rate",
    pool: "Jupiter SOL-PERP",
    emoji: "🔄",
    available: false,
  },
  {
    id: 6,
    slug: "jupiter-jlp-nav",
    label: "Yield-Bearing Stable",
    pool: "Jupiter JLP",
    emoji: "💰",
    available: false,
  },
];

/** Lookup by on-chain selector id. Returns undefined for unknown ids. */
export function rateCategoryById(id: number | null): RateCategory | undefined {
  if (id == null) return undefined;
  return RATE_CATEGORIES.find((c) => c.id === id);
}
