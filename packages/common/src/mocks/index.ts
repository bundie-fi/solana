import type { StrategyDisplay } from '../types/strategy'
import type { MarketDisplay } from '../types/market'
import type { Portfolio } from '../types/portfolio'

// ---------------------------------------------------------------------------
// Mock Strategies
// ---------------------------------------------------------------------------

export const mockStrategies: StrategyDisplay[] = [
  {
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    authority: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    wallet: '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T',
    name: 'USDC Compounder',
    feeBps: 1000,
    totalDeposits: 45_000_000_000n, // 45,000 USDC (6 decimals)
    currentNav: 45_200_000_000n,
    totalShares: 44_800_000_000n,
    sharePrice: 1.0089,
    createdAt: 1709251200, // 2024-03-01
    apy: 12.4,
    tvl: 45_200,
    investorCount: 23,
    creatorName: 'yudhi.sol',
    performance: {
      day: 0.034,
      week: 0.24,
      month: 1.03,
      all: 12.4,
    },
  },
  {
    address: '3zC7bBhSLRig9BTbHjhV1EP6dpPFSgkvVm2PGQiqFvHW',
    authority: 'AgA1phKjMRiX5cpLxP2FUzHsRqMqqFzpTQ2GhwdKgnEP',
    mint: 'FRaXagvJgQ7KhA9MHoXYTph3KnBNegNEpuHuSzcCzuir',
    wallet: '6YwbhVDL8QkSJfGH1t3MxURpJL7z8NVdp6VHJxj3rTKh',
    name: 'Funding Rate Arb',
    feeBps: 2000,
    totalDeposits: 12_000_000_000n,
    currentNav: 12_450_000_000n,
    totalShares: 11_800_000_000n,
    sharePrice: 1.0551,
    createdAt: 1711929600, // 2024-04-01
    apy: 22.1,
    tvl: 12_450,
    investorCount: 8,
    creatorName: 'agent-alpha.sol',
    performance: {
      day: 0.12,
      week: 0.53,
      month: 1.84,
      all: 22.1,
    },
  },
  {
    address: 'Bg6Z1UxhRwEaFqYrim7GEgmjRpLg1LHXu7Jv8Hg9F5jA',
    authority: 'ALiC3Nba6wiu5AUQKZ6JLiApR9mFKRim43xDQPNhKyfe',
    mint: 'So11111111111111111111111111111111111111112',
    wallet: '8bPZc1RNfjHp3Y4p7N6CPdUMfVRAzTZcH3nFg2GvJYMD',
    name: 'SOL Staking Plus',
    feeBps: 500,
    totalDeposits: 120_000_000_000_000n, // 120,000 SOL (9 decimals)
    currentNav: 120_400_000_000_000n,
    totalShares: 119_800_000_000_000n,
    sharePrice: 1.005,
    createdAt: 1706745600, // 2024-02-01
    apy: 8.7,
    tvl: 120_400,
    investorCount: 54,
    creatorName: 'alice.sol',
    performance: {
      day: 0.024,
      week: 0.17,
      month: 0.72,
      all: 8.7,
    },
  },
  {
    address: 'DnEu4J8QwXGMassKhy2giiirmNtwE4GZrmghGPfSeghr',
    authority: 'BoBk9VGqzPQhDuP7giH1krwUjHR3LBbKev5NzaHz2bAD',
    mint: 'DNuT1BwGMFVRazmDjVXMNPWZj4FTk5pWrinvm8L7VxHf',
    wallet: '2cZv1JDVm1RbknMXiQfhTRCbfrTePBFrqJ1WqDknYUEz',
    name: 'Delta Neutral USDC',
    feeBps: 1500,
    totalDeposits: 67_000_000_000n,
    currentNav: 67_800_000_000n,
    totalShares: 66_500_000_000n,
    sharePrice: 1.0195,
    createdAt: 1712620800, // 2024-04-09
    apy: 15.3,
    tvl: 67_800,
    investorCount: 17,
    creatorName: 'bob.sol',
    performance: {
      day: 0.042,
      week: 0.29,
      month: 1.27,
      all: 15.3,
    },
  },
  {
    address: 'JLPcV4hBpUfx3fG1MHLjz5ATLZ1XnRDCEvx58m9K2Pxt',
    authority: 'CRoL5Tg3NcJdH8sxp4BjEdEUqNMPXGnQ3ZNMpVgfWxTz',
    mint: 'JLPvpK1tg3K4QNXqmLxPFEBGNu8FjWZTBECJftw7UdTx',
    wallet: '5Vq2jZkiTEnGVR1XqNZGeLPfiM8UVVgjk3FRKcFqNrad',
    name: 'JLP Compounder',
    feeBps: 1000,
    totalDeposits: 34_000_000_000n,
    currentNav: 34_500_000_000n,
    totalShares: 33_700_000_000n,
    sharePrice: 1.0237,
    createdAt: 1713484800, // 2024-04-19
    apy: 18.9,
    tvl: 34_500,
    investorCount: 12,
    creatorName: 'carol.sol',
    performance: {
      day: 0.052,
      week: 0.36,
      month: 1.57,
      all: 18.9,
    },
  },
]

// ---------------------------------------------------------------------------
// Mock Markets
// ---------------------------------------------------------------------------

export const mockMarkets: MarketDisplay[] = [
  {
    address: 'MKTy1AHPRZuVBNQ27WcJgFm7WWHV8GUjXYFXXY4HSWb',
    strategy: mockStrategies[0].address,
    authority: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    question: 'Will USDC Compounder exceed 15% APY by Apr 30?',
    thresholdBps: 1500,
    resolutionSlot: 312_000_000,
    yesShares: 3_800_000_000n,
    noShares: 6_200_000_000n,
    liquidityParam: 1_000_000_000n,
    totalVolume: 14_500_000_000n,
    status: 'active',
    createdAt: 1711929600,
    yesPrice: 0.38,
    noPrice: 0.62,
    strategyName: 'USDC Compounder',
    timeRemaining: '25 days',
  },
  {
    address: 'MKTp5RNdG7xHLsjWu1JvEqFd4nGpV7BhztYCc8jq9Tn',
    strategy: mockStrategies[1].address,
    authority: 'AgA1phKjMRiX5cpLxP2FUzHsRqMqqFzpTQ2GhwdKgnEP',
    question: 'Will Funding Rate Arb exceed 20% APY by May 11?',
    thresholdBps: 2000,
    resolutionSlot: 315_000_000,
    yesShares: 4_300_000_000n,
    noShares: 5_700_000_000n,
    liquidityParam: 1_000_000_000n,
    totalVolume: 9_200_000_000n,
    status: 'active',
    createdAt: 1712534400,
    yesPrice: 0.43,
    noPrice: 0.57,
    strategyName: 'Funding Rate Arb',
    timeRemaining: '36 days',
  },
  {
    address: 'MKTr8KvVQsNB7dFmZxcPtWxJn6kk4f3bqS1Hj5GnZcU',
    strategy: mockStrategies[2].address,
    authority: 'ALiC3Nba6wiu5AUQKZ6JLiApR9mFKRim43xDQPNhKyfe',
    question: 'Will SOL Staking Plus outperform Delta Neutral this week?',
    thresholdBps: 0,
    resolutionSlot: 310_500_000,
    yesShares: 5_500_000_000n,
    noShares: 4_500_000_000n,
    liquidityParam: 1_000_000_000n,
    totalVolume: 6_800_000_000n,
    status: 'active',
    createdAt: 1712188800,
    yesPrice: 0.55,
    noPrice: 0.45,
    strategyName: 'SOL Staking Plus',
    timeRemaining: '4 days',
  },
  {
    address: 'MKTwJ4rLzM2fG6Txi9pQKcVbHy7qzDm5en3FRvNBK9d',
    strategy: mockStrategies[0].address,
    authority: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    question: 'Did USDC Compounder exceed 10% APY in March?',
    thresholdBps: 1000,
    resolutionSlot: 308_000_000,
    yesShares: 7_200_000_000n,
    noShares: 2_800_000_000n,
    liquidityParam: 1_000_000_000n,
    totalVolume: 22_300_000_000n,
    status: 'resolved',
    outcome: 'yes',
    createdAt: 1709251200,
    resolvedAt: 1711929600,
    yesPrice: 1.0,
    noPrice: 0.0,
    strategyName: 'USDC Compounder',
  },
]

// ---------------------------------------------------------------------------
// Mock Portfolio
// ---------------------------------------------------------------------------

export const mockPortfolio: Portfolio = {
  wallet: '5YNmS1R9nNSCDzb5a7mMJ1dwK9uHeAAF4CerXi9QLSHR',
  totalValue: 2_847.2,
  yieldLayers: {
    strategyYield: 14.2,
    predictionWins: 33.0,
    creatorFees: 0,
  },
  strategies: [
    {
      strategy: mockStrategies[0].address,
      name: 'USDC Compounder',
      shares: 2_000_000_000n,
      value: 2_017.8,
      pnl: 17.8,
      entryPrice: 1.0,
    },
    {
      strategy: mockStrategies[2].address,
      name: 'SOL Staking Plus',
      shares: 500_000_000_000n, // 500 SOL worth of shares (9 decimals)
      value: 502.5,
      pnl: 2.5,
      entryPrice: 1.0,
    },
  ],
  predictions: [
    {
      market: mockMarkets[1].address,
      question: 'Will Funding Rate Arb exceed 20% APY by May 11?',
      side: 'yes',
      shares: 500_000_000n,
      costBasis: 215.0,
      currentValue: 215.0,
    },
    {
      market: mockMarkets[3].address,
      question: 'Did USDC Compounder exceed 10% APY in March?',
      side: 'yes',
      shares: 300_000_000n,
      costBasis: 78.9,
      currentValue: 111.9,
      settledAt: 1711929600,
      payout: 111.9,
    },
  ],
}
