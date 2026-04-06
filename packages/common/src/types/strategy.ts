/** Strategy lifecycle status */
export type StrategyStatus = 'active' | 'paused' | 'closed'

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
  /** Protocol address the strategy routes to (e.g. Kamino) */
  protocol: string
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
  /** Count of unique share holders */
  totalInvestors: number
  /** High water mark for performance fee calculation */
  highWaterMark: bigint
  /** Minimum deposit amount in base units */
  minDeposit: bigint
  /** Share price (currentNav / totalShares) */
  sharePrice: number
  /** Strategy status */
  status: StrategyStatus
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
  /** Protocol program address */
  protocolAddress: string
  deposit: number
  feeBps: number
  /** Minimum deposit amount in base units */
  minDeposit: number
}
