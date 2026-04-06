/** Prediction market outcome */
export type Outcome = 'yes' | 'no'

/** Market status */
export type MarketStatus = 'active' | 'resolved'

/** On-chain prediction market account data */
export interface Market {
  /** Market PDA address */
  address: string
  /** Strategy this market predicts on */
  strategy: string
  /** Market creator */
  authority: string
  /** Question text */
  question: string
  /** APY threshold in basis points */
  thresholdBps: number
  /** Slot at which market resolves */
  resolutionSlot: number
  /** YES shares outstanding */
  yesShares: bigint
  /** NO shares outstanding */
  noShares: bigint
  /** LS-LMSR liquidity parameter */
  liquidityParam: bigint
  /** Total volume traded */
  totalVolume: bigint
  /** Market status */
  status: MarketStatus
  /** Winning outcome (if resolved) */
  outcome?: Outcome
  /** Creation timestamp */
  createdAt: number
  /** Resolution timestamp */
  resolvedAt?: number
}

/** Market with computed display fields */
export interface MarketDisplay extends Market {
  /** YES price (0-1, implied probability) */
  yesPrice: number
  /** NO price (0-1) */
  noPrice: number
  /** Strategy name for display */
  strategyName: string
  /** Time remaining to resolution */
  timeRemaining?: string
}

/** Buy shares parameters */
export interface BuySharesParams {
  market: string
  outcome: Outcome
  amount: number
}
