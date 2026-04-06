import { Hono } from "hono";

export const portfolio = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StrategyPosition {
  strategyAddress: string;
  strategyName: string;
  shares: number;
  currentNav: number;
  entryNav: number;
  pnl: number;
  value: number;
}

interface PredictionPosition {
  marketAddress: string;
  question: string;
  side: "yes" | "no";
  shares: number;
  avgCost: number;
  currentPrice: number;
  pnl: number;
  value: number;
}

interface YieldLayers {
  strategyYield: number;
  predictionWins: number;
  creatorFees: number;
}

interface PortfolioResponse {
  wallet: string;
  totalValue: number;
  yieldLayers: YieldLayers;
  strategies: StrategyPosition[];
  predictions: PredictionPosition[];
}

// ---------------------------------------------------------------------------
// Mock data factory — returns deterministic data keyed by wallet
// ---------------------------------------------------------------------------

function buildMockPortfolio(wallet: string): PortfolioResponse {
  const strategies: StrategyPosition[] = [
    {
      strategyAddress: "StrT1kQ7v9bYfqnGv4oKj8RXwJ4YtRdGJc9AzLkWfPm",
      strategyName: "SOL Momentum Alpha",
      shares: 420.5,
      currentNav: 1.184,
      entryNav: 1.05,
      pnl: 56.35,
      value: 497.87,
    },
    {
      strategyAddress: "StrT2kQ8w0cYgGv5pLkj9SXxK5ZuSeFHkd0BaMmXgQn",
      strategyName: "USDC Stable Yield",
      shares: 5000,
      currentNav: 1.097,
      entryNav: 1.0,
      pnl: 485.0,
      value: 5485.0,
    },
    {
      strategyAddress: "StrT3kQ9x1dZhHv6qMlk0TYyL6AvTfGIle1CbNnYhRo",
      strategyName: "DeFi Blue-Chip Index",
      shares: 1200,
      currentNav: 1.142,
      entryNav: 1.08,
      pnl: 74.4,
      value: 1370.4,
    },
  ];

  const predictions: PredictionPosition[] = [
    {
      marketAddress: "Mkt1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3y",
      question: "Will SOL Momentum Alpha exceed 20% APY by end of Q2 2026?",
      side: "yes",
      shares: 150,
      avgCost: 0.55,
      currentPrice: 0.62,
      pnl: 10.5,
      value: 93.0,
    },
    {
      marketAddress: "Mkt3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5a",
      question: "Will Leveraged SOL 2x outperform spot SOL by >10% this month?",
      side: "no",
      shares: 200,
      avgCost: 0.48,
      currentPrice: 0.56,
      pnl: 16.0,
      value: 112.0,
    },
  ];

  const strategyValue = strategies.reduce((sum, s) => sum + s.value, 0);
  const predictionValue = predictions.reduce((sum, p) => sum + p.value, 0);

  return {
    wallet,
    totalValue: parseFloat((strategyValue + predictionValue).toFixed(2)),
    yieldLayers: {
      strategyYield: 615.75,
      predictionWins: 26.5,
      creatorFees: 48.2,
    },
    strategies,
    predictions,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

portfolio.get("/:wallet", (c) => {
  const { wallet } = c.req.param();

  if (!wallet || wallet.length < 32) {
    return c.json({ error: "Invalid wallet address" }, 400);
  }

  const response = buildMockPortfolio(wallet);
  return c.json(response);
});
