/** Three yield layer breakdown */
export interface YieldLayers {
  /** Yield from holding strategy shares */
  strategyYield: number
  /** Winnings from correct predictions */
  predictionWins: number
  /** Fees earned from creating strategies */
  creatorFees: number
}

/** User's strategy position */
export interface StrategyPosition {
  /** Strategy address */
  strategy: string
  /** Strategy name */
  name: string
  /** Shares held */
  shares: bigint
  /** Current value in USD */
  value: number
  /** Unrealized P&L */
  pnl: number
  /** Entry price */
  entryPrice: number
}

/** User's prediction position */
export interface PredictionPosition {
  /** Market address */
  market: string
  /** Question text */
  question: string
  /** Outcome bought (yes/no) */
  side: 'yes' | 'no'
  /** Shares held */
  shares: bigint
  /** Cost basis */
  costBasis: number
  /** Current value */
  currentValue: number
  /** Settlement date (if resolved) */
  settledAt?: number
  /** Payout (if resolved and won) */
  payout?: number
}

/** Complete portfolio for a wallet */
export interface Portfolio {
  /** Wallet address */
  wallet: string
  /** Total portfolio value */
  totalValue: number
  /** Three yield layer breakdown */
  yieldLayers: YieldLayers
  /** Strategy positions */
  strategies: StrategyPosition[]
  /** Prediction positions */
  predictions: PredictionPosition[]
}
