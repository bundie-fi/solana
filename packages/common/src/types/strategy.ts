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

/** A single point in a strategy's NAV history, derived from on-chain
 *  update_nav transactions. */
export interface NavHistoryPoint {
  /** Solana slot the snapshot was written at */
  slot: number
  /** NAV per share, 1e9-scaled (matches the on-chain encoding) */
  navPerShare: number
  /** Unix seconds (block time) — may be 0 if RPC didn't return blockTime */
  timestamp: number
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
  /** Optional NAV history derived off-chain via getSignaturesForAddress on the
   *  NavOracle PDA. Empty/undefined when the strategy has fewer than 2 update_nav
   *  txs — Sparkline empty-state should render nothing in that case. */
  navHistory?: NavHistoryPoint[]
  /** Most recent slot the NAV oracle was updated at (mirrors NavOracle.last_snapshot_slot). */
  lastSnapshotSlot?: number
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
