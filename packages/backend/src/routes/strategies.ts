import { Hono } from "hono";

export const strategies = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StrategyPerformance {
  day: number;
  week: number;
  month: number;
  all: number;
}

interface Strategy {
  address: string;
  name: string;
  authority: string;
  apy: number;
  tvl: number;
  sharePrice: number;
  investorCount: number;
  creatorName: string;
  asset: string;
  performance: StrategyPerformance;
  status: "active" | "paused" | "closed";
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_STRATEGIES: Strategy[] = [
  {
    address: "StrT1kQ7v9bYfqnGv4oKj8RXwJ4YtRdGJc9AzLkWfPm",
    name: "SOL Momentum Alpha",
    authority: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    apy: 18.4,
    tvl: 2_450_000,
    sharePrice: 1.184,
    investorCount: 342,
    creatorName: "luca3.sol",
    asset: "sol",
    performance: { day: 0.52, week: 2.1, month: 8.4, all: 18.4 },
    status: "active",
  },
  {
    address: "StrT2kQ8w0cYgGv5pLkj9SXxK5ZuSeFHkd0BaMmXgQn",
    name: "USDC Stable Yield",
    authority: "7RkVxDm3JkFz9HvNqYfLpGh1xBZp8ynKMbJdLvL0zCtB",
    apy: 9.7,
    tvl: 8_120_000,
    sharePrice: 1.097,
    investorCount: 1_204,
    creatorName: "mert.sol",
    asset: "usdc",
    performance: { day: 0.03, week: 0.19, month: 0.81, all: 9.7 },
    status: "active",
  },
  {
    address: "StrT3kQ9x1dZhHv6qMlk0TYyL6AvTfGIle1CbNnYhRo",
    name: "DeFi Blue-Chip Index",
    authority: "4TkVyEn4KkFz0IvPqXmYpGh2yDZq9znLNcKeLwM1aDuC",
    apy: 14.2,
    tvl: 5_340_000,
    sharePrice: 1.142,
    investorCount: 876,
    creatorName: "toly.sol",
    asset: "usdc",
    performance: { day: -0.31, week: 1.4, month: 5.2, all: 14.2 },
    status: "active",
  },
  {
    address: "StrT4kR0y2eAiIv7rNml1UZzM7BwUgHJmf2DcOoZiSp",
    name: "Leveraged SOL 2x",
    authority: "2UlWzFo5LlGz1JwQrYnYqIj3zCZr0amMOdKfMxN2bEvD",
    apy: 31.5,
    tvl: 1_180_000,
    sharePrice: 1.315,
    investorCount: 215,
    creatorName: "armani.sol",
    asset: "sol",
    performance: { day: 1.83, week: 5.6, month: 12.1, all: 31.5 },
    status: "active",
  },
  {
    address: "StrT5kS1z3fBjJv8sOmm2VAaN8CxVhIKng3EdPpAjTq",
    name: "Kamino LP Optimizer",
    authority: "6VmXzGp6MmHa2KwSrZnZrJj4zDZs1bmNPeLeOxO3cFvE",
    apy: 12.8,
    tvl: 3_760_000,
    sharePrice: 1.128,
    investorCount: 603,
    creatorName: "chad.sol",
    asset: "usdc",
    performance: { day: 0.12, week: 0.94, month: 3.6, all: 12.8 },
    status: "paused",
  },
];

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

strategies.get("/", (c) => {
  const timeframe = c.req.query("timeframe"); // 24h | 7d | 30d | all
  const asset = c.req.query("asset"); // all | usdc | sol

  let filtered = MOCK_STRATEGIES;

  // Filter by asset
  if (asset && asset !== "all") {
    filtered = filtered.filter((s) => s.asset === asset);
  }

  // Attach the requested timeframe performance as a top-level convenience field
  const withTimeframe = filtered.map((s) => {
    let perfValue: number;
    switch (timeframe) {
      case "24h":
        perfValue = s.performance.day;
        break;
      case "7d":
        perfValue = s.performance.week;
        break;
      case "30d":
        perfValue = s.performance.month;
        break;
      default:
        perfValue = s.performance.all;
    }
    return { ...s, selectedPerformance: perfValue };
  });

  return c.json({ strategies: withTimeframe });
});

strategies.get("/:id", (c) => {
  const { id } = c.req.param();
  const strategy = MOCK_STRATEGIES.find((s) => s.address === id);

  if (!strategy) {
    return c.json({ error: "Strategy not found", id }, 404);
  }

  return c.json({ strategy });
});

// Build tx stub — keep 501 until tx builder is wired up
strategies.post("/", async (c) => {
  const body = await c.req.json();
  return c.json({ message: "Not implemented", body }, 501);
});
