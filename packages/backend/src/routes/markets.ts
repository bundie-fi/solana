import { Hono } from "hono";
import { PublicKey } from "@solana/web3.js";
import { buildPredictBuy } from "../lib/builders.js";
import { connection, DEVNET_USDC } from "../lib/solana.js";

export const markets = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PredictionMarket {
  address: string;
  strategy: string;
  strategyName: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  totalVolume: number;
  status: "open" | "resolved" | "expired";
  timeRemaining: string;
}

interface MarketDetail extends PredictionMarket {
  lsLmsr: {
    b: number;
    qYes: number;
    qNo: number;
    costFunction: number;
  };
  resolutionCriteria: string;
  expiryTimestamp: number;
  createdAt: number;
}

interface ResolveResponse {
  outcome: "yes" | "no";
  navAtResolution: number;
  threshold: number;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_MARKETS: MarketDetail[] = [
  {
    address: "Mkt1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3y",
    strategy: "StrT1kQ7v9bYfqnGv4oKj8RXwJ4YtRdGJc9AzLkWfPm",
    strategyName: "SOL Momentum Alpha",
    question: "Will SOL Momentum Alpha exceed 20% APY by end of Q2 2026?",
    yesPrice: 0.62,
    noPrice: 0.38,
    totalVolume: 184_500,
    status: "open",
    timeRemaining: "18d 4h",
    lsLmsr: { b: 100, qYes: 620, qNo: 380, costFunction: 714.2 },
    resolutionCriteria: "Strategy NAV-based APY >= 20% at expiry block",
    expiryTimestamp: 1751328000,
    createdAt: 1748736000,
  },
  {
    address: "Mkt2bC3dE4fG5hI6jK7lM8nO9pQ0rS1tU2vW3xY4z",
    strategy: "StrT2kQ8w0cYgGv5pLkj9SXxK5ZuSeFHkd0BaMmXgQn",
    strategyName: "USDC Stable Yield",
    question: "Will USDC Stable Yield maintain >8% APY for 30 consecutive days?",
    yesPrice: 0.81,
    noPrice: 0.19,
    totalVolume: 312_000,
    status: "open",
    timeRemaining: "6d 12h",
    lsLmsr: { b: 150, qYes: 1215, qNo: 285, costFunction: 1023.7 },
    resolutionCriteria: "Rolling 30d APY stays above 8% at each daily checkpoint",
    expiryTimestamp: 1749312000,
    createdAt: 1746720000,
  },
  {
    address: "Mkt3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5a",
    strategy: "StrT4kR0y2eAiIv7rNml1UZzM7BwUgHJmf2DcOoZiSp",
    strategyName: "Leveraged SOL 2x",
    question: "Will Leveraged SOL 2x outperform spot SOL by >10% this month?",
    yesPrice: 0.44,
    noPrice: 0.56,
    totalVolume: 97_800,
    status: "open",
    timeRemaining: "22d 8h",
    lsLmsr: { b: 80, qYes: 352, qNo: 448, costFunction: 582.1 },
    resolutionCriteria: "Strategy return minus SOL spot return > 10% at expiry",
    expiryTimestamp: 1751932800,
    createdAt: 1749340800,
  },
  {
    address: "Mkt4dE5fG6hI7jK8lM9nO0pQ1rS2tU3vW4xY5zA6b",
    strategy: "StrT3kQ9x1dZhHv6qMlk0TYyL6AvTfGIle1CbNnYhRo",
    strategyName: "DeFi Blue-Chip Index",
    question: "Will DeFi Blue-Chip Index TVL exceed $10M before July 2026?",
    yesPrice: 0.35,
    noPrice: 0.65,
    totalVolume: 56_200,
    status: "open",
    timeRemaining: "54d 16h",
    lsLmsr: { b: 60, qYes: 210, qNo: 390, costFunction: 421.8 },
    resolutionCriteria: "On-chain TVL read from strategy vault >= 10,000,000 USDC",
    expiryTimestamp: 1754524800,
    createdAt: 1749340800,
  },
];

// ---------------------------------------------------------------------------
// Read routes
// ---------------------------------------------------------------------------

markets.get("/", (c) => {
  // Return the summary shape (without LS-LMSR internals)
  const summaries: PredictionMarket[] = MOCK_MARKETS.map(
    ({ lsLmsr, resolutionCriteria, expiryTimestamp, createdAt, ...rest }) => rest
  );
  return c.json({ markets: summaries });
});

markets.get("/:id", (c) => {
  const { id } = c.req.param();
  const market = MOCK_MARKETS.find((m) => m.address === id);

  if (!market) {
    return c.json({ error: "Market not found", id }, 404);
  }

  return c.json({ market });
});

// ---------------------------------------------------------------------------
// Write routes — return UNSIGNED transactions for the client to sign + send.
//
// Mirrors the `Prepared` shape from @bundie/sol-cli/src/prepare.ts. The
// prediction-market program is Anchor 1.0; we hand-encode the 8-byte
// sha256("global:buy_shares") discriminator + Borsh args (outcome:u8 +
// amount:u64) so we don't need to thread a wallet through an AnchorProvider
// just to build an instruction.
// ---------------------------------------------------------------------------

interface PredictBuyBody {
  /** Buyer wallet — signs + pays fee. */
  wallet: string;
  /** "yes" or "no". */
  outcome: "yes" | "no";
  /** Whole-USDC amount to buy (× 1e6 base units on-chain). */
  amount: number;
  /** Strategy address the market predicts on. Required for the program's
   *  buyer ≠ strategy.authority self-exclusion check. The client gets this
   *  from `GET /api/markets/:id` (`market.strategy`). Falls back to the mock
   *  strategy address if the client omits it AND the market id is in our
   *  mock catalog. */
  strategy?: string;
  /** Collateral mint (defaults to devnet USDC). */
  collateral_mint?: string;
}

markets.post("/:id/buy", async (c) => {
  const { id } = c.req.param();

  let marketKey: PublicKey;
  try {
    marketKey = new PublicKey(id);
  } catch {
    return c.json({ error: `Invalid market address: ${id}` }, 400);
  }

  let body: PredictBuyBody;
  try {
    body = await c.req.json<PredictBuyBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.wallet) return c.json({ error: "`wallet` is required" }, 400);
  if (!body.outcome || !["yes", "no"].includes(body.outcome)) {
    return c.json({ error: "`outcome` must be 'yes' or 'no'" }, 400);
  }
  if (!body.amount || body.amount <= 0) {
    return c.json({ error: "`amount` must be a positive number" }, 400);
  }

  let payer: PublicKey;
  try {
    payer = new PublicKey(body.wallet);
  } catch {
    return c.json({ error: `Invalid wallet pubkey: ${body.wallet}` }, 400);
  }

  // Resolve strategy: explicit body field wins; else look up in mock catalog;
  // else 400. (Once we hydrate markets from chain we'll fetchMarket() here.)
  const fallback = MOCK_MARKETS.find((m) => m.address === id);
  const strategy = body.strategy ?? fallback?.strategy;
  if (!strategy) {
    return c.json(
      { error: "`strategy` is required (read from `GET /api/markets/:id`)" },
      400
    );
  }

  const collateralMint = body.collateral_mint ?? DEVNET_USDC.toBase58();

  try {
    const prepared = await buildPredictBuy(connection, payer, {
      market: marketKey.toBase58(),
      strategy,
      collateralMint,
      side: body.outcome,
      amount: body.amount,
    });
    return c.json(prepared);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      { error: "Failed to build prediction buy_shares tx", detail: message },
      500
    );
  }
});

markets.post("/:id/resolve", async (c) => {
  const { id } = c.req.param();
  const market = MOCK_MARKETS.find((m) => m.address === id);

  if (!market) {
    return c.json({ error: "Market not found", id }, 404);
  }

  // Mock resolution based on current yes price being the "probability"
  const resolvedYes = market.yesPrice > 0.5;
  const response: ResolveResponse = {
    outcome: resolvedYes ? "yes" : "no",
    navAtResolution: resolvedYes ? 1.22 : 0.95,
    threshold: 1.0,
  };

  return c.json(response);
});
