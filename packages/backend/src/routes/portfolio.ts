import { Hono } from "hono";

export const portfolio = new Hono();

interface StrategyPosition {
  strategyMint: string;
  shares: number;
  currentNav: number;
  entryNav: number;
  pnl: number;
}

interface PredictionPosition {
  marketAddress: string;
  side: "yes" | "no";
  shares: number;
  avgCost: number;
  currentPrice: number;
}

interface YieldBreakdown {
  /** Yield from underlying DeFi protocols (Kamino, Beethoven) */
  protocolYield: number;
  /** Yield from strategy manager's alpha */
  strategyAlpha: number;
  /** Yield/loss from prediction market positions */
  predictionPnl: number;
}

interface PortfolioResponse {
  wallet: string;
  strategyPositions: StrategyPosition[];
  predictionPositions: PredictionPosition[];
  yieldBreakdown: YieldBreakdown;
  totalValue: number;
}

// TODO: Fetch all strategy token accounts owned by this wallet
// TODO: Fetch all prediction market positions for this wallet
// TODO: Calculate three-layer yield breakdown:
//   1. Protocol yield (Kamino/Beethoven base APY)
//   2. Strategy alpha (manager's outperformance vs benchmark)
//   3. Prediction P&L (gains/losses from market positions)
// TODO: Resolve wallet via SNS .sol name if provided instead of pubkey
portfolio.get("/:wallet", (c) => {
  const { wallet } = c.req.param();

  const response: PortfolioResponse = {
    wallet,
    strategyPositions: [],
    predictionPositions: [],
    yieldBreakdown: {
      protocolYield: 0,
      strategyAlpha: 0,
      predictionPnl: 0,
    },
    totalValue: 0,
  };

  return c.json(response);
});
