/** On-chain strategy account data */
export interface Strategy {
  /** Strategy PDA address */
  address: string
  /** Creator/authority pubkey */
  authority: string
  /** Strategy token mint address */
  mint: string
  /** Portfolio wallet PDA */
  wallet: string
  /** Strategy name */
  name: string
  /** Performance fee in basis points (e.g., 1000 = 10%) */
  feeBps: number
  /** Total deposits in base units */
  totalDeposits: bigint
  /** Current NAV (net asset value) */
  currentNav: bigint
  /** Total shares outstanding */
  totalShares: bigint
  /** Share price (currentNav / totalShares) */
  sharePrice: number
  /** Creation timestamp */
  createdAt: number
}

/** Strategy with computed display fields */
export interface StrategyDisplay extends Strategy {
  /** Annualized yield percentage */
  apy: number
  /** Total value locked (USD) */
  tvl: number
  /** Number of investors */
  investorCount: number
  /** Creator's .sol name (if resolved) */
  creatorName?: string
  /** Performance over timeframes */
  performance: {
    day: number
    week: number
    month: number
    all: number
  }
}

/** Strategy creation parameters */
export interface CreateStrategyParams {
  name: string
  protocol: 'kamino' | 'marginfi' | 'jupiter-lend'
  deposit: number
  feeBps: number
}
