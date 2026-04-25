/**
 * Rate-category catalog for the Bundie prediction markets.
 *
 * Each entry's `id` matches the `rate_reader_selector` value in the
 * on-chain prediction market payload, as documented in
 *   packages/programs/programs/prediction-market/src/rate_readers/mod.rs
 *
 *   1 → Kamino USDC supply utilization
 *   2 → Marinade mSOL stake rate
 *   3 → MarginFi USDC utilization
 *   4 → SPL Stake Pool exchange rate (Jito / BlazeStake)
 *   5 → Zeta SOL-PERP funding rate (live-reads pending probe verification)
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
    slug: "marginfi-usdc",
    label: "Lending Supply APY",
    pool: "MarginFi USDC",
    emoji: "🏦",
    available: true,
  },
  {
    id: 4,
    slug: "spl-stake-pool",
    label: "LST Staking Yield",
    pool: "Jito / BlazeStake",
    emoji: "🔥",
    available: true,
  },
  {
    id: 5,
    slug: "zeta-sol-perp",
    label: "Perp Funding Rate",
    pool: "Zeta SOL-PERP",
    emoji: "🔄",
    available: false,
  },
];

/** Lookup by on-chain selector id. Returns undefined for unknown ids. */
export function rateCategoryById(id: number | null): RateCategory | undefined {
  if (id == null) return undefined;
  return RATE_CATEGORIES.find((c) => c.id === id);
}
