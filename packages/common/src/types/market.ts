/** Prediction market outcome */
export type Outcome = 'yes' | 'no'

/** Market status */
export type MarketStatus = 'active' | 'resolved'

/** Market type: Absolute ("will exceed X%") vs Relative ("A vs B") */
export type MarketType = 'absolute' | 'relative'

/** On-chain prediction market account data */
export interface Market {
  /** Market PDA address */
  address: string
  /** Strategy this market predicts on */
  strategy: string
  /** Second strategy for Relative market type (undefined for Absolute) */
  strategyB?: string
  /** Market creator */
  authority: string
  /** Who provided initial liquidity subsidy */
  subsidyProvider: string
  /** Question text */
  question: string
  /** Market type */
  marketType: MarketType
  /** Sequential market ID (used in PDA derivation) */
  marketId: number
  /** APY threshold in basis points */
  thresholdBps: number
  /** Slot at which market resolves */
  resolutionSlot: number
  /** YES shares outstanding */
  yesShares: bigint
  /** NO shares outstanding */
  noShares: bigint
  /** Total cost basis paid for YES shares */
  totalYesCost: bigint
  /** Total cost basis paid for NO shares */
  totalNoCost: bigint
  /** LS-LMSR liquidity parameter */
  liquidityParam: bigint
  /** Total volume traded */
  totalVolume: bigint
  /** BundieVault NAV (lamports) snapshotted at create_market_v2 for vault A. Zero for kinds that do not flow through BundieVault. */
  initialNavA: bigint
  /** BundieVault NAV (lamports) snapshotted at create_market_v2 for vault B. Zero for kinds that do not flow through BundieVault (or for single-vault kinds). */
  initialNavB: bigint
  /** Market fee in basis points (e.g., 100 = 1%) */
  feeBps: number
  /** Collateral mint (e.g. USDC) */
  collateralMint?: string
  /** Vault token account address */
  vault?: string
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

/** Market creation parameters */
export interface CreateMarketParams {
  strategy: string
  strategyB?: string
  question: string
  marketId: number
  marketType: MarketType
  thresholdBps: number
  resolutionSlot: number
  initialSubsidy: number
  feeBps: number
}

/** Buy shares parameters */
export interface BuySharesParams {
  market: string
  outcome: Outcome
  amount: number
}

/** On-chain BundieVault account data (PDA derived from `["bundie_vault", authority]`) */
export interface BundieVault {
  /** Vault authority (Bundie agent vault pubkey) */
  authority: string
  /** Wallet that funded / owns the agent — authorized to call `close_vault` */
  ownerWallet: string
  /** SPL mint of the treasury asset (e.g. bUSD) */
  treasuryMint: string
  /** ATA owned by the vault PDA that holds the treasury balance */
  treasuryAta: string
  /** Most recent committed NAV in lamports */
  navLamports: bigint
  /** Monotonic epoch — incremented on each commit_nav */
  navEpoch: bigint
  /** Slot at which the latest NAV was committed */
  navSlot: bigint
  /** Off-chain commit digest (e.g., signed-payload hash) */
  commitDigest: Uint8Array
  /** PDA bump */
  bump: number
}
