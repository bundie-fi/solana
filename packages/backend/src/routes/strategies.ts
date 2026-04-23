import { Hono } from "hono";
import { PublicKey } from "@solana/web3.js";
import {
  buildBuyStrategyShares,
  buildCreateStrategy,
} from "../lib/builders.js";
import { connection, DEVNET_USDC, walletPDA } from "../lib/solana.js";

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
// Read routes
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

// ---------------------------------------------------------------------------
// Write routes — return UNSIGNED transactions for the client to sign + send.
//
// Design notes:
// - The backend never holds keys. All POST builders return a base64-encoded
//   `Transaction` with `feePayer` + `recentBlockhash` set, optionally
//   partial-signed by ephemeral signers (e.g. the share-mint keypair).
// - Response shape mirrors `PreparedTx` from @bundie/sol-cli/src/prepare.ts
//   so the same client-side code can consume txs from CLI, MCP, or backend.
// - Strategy-token is a pinocchio program (single-byte instruction
//   discriminator 0–7); see packages/programs/programs/strategy-token/src/lib.rs
//   for the byte map. We hand-encode discriminator + args, never the IDL.
// ---------------------------------------------------------------------------

interface CreateStrategyBody {
  /** Wallet that will be the strategy creator + tx fee payer. */
  wallet: string;
  /** Strategy name (max 32 UTF-8 bytes; longer names are truncated on-chain). */
  name: string;
  /** Protocol target — "kamino" | "marginfi" | "jupiter" or a raw program ID. */
  protocol: string;
  /** Creator fee in basis points (0–10_000). */
  fee_bps?: number;
  /** Whole-USDC seed deposit suggested by the client (informational; the
   *  buy_shares tx is built separately via `POST /:id/buy`). */
  deposit_amount?: number;
  /** Min deposit in whole USDC. Default 1. */
  min_deposit?: number;
  /** "yield" (0, default — routes through Beethoven) or "agent" (1). */
  strategy_type?: "yield" | "agent";
  /** Optional override for the deposit mint (defaults to devnet USDC). */
  usdc_mint?: string;
}

strategies.post("/", async (c) => {
  let body: CreateStrategyBody;
  try {
    body = await c.req.json<CreateStrategyBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.wallet) return c.json({ error: "`wallet` is required" }, 400);
  if (!body.name) return c.json({ error: "`name` is required" }, 400);
  if (!body.protocol) return c.json({ error: "`protocol` is required" }, 400);

  let payer: PublicKey;
  try {
    payer = new PublicKey(body.wallet);
  } catch {
    return c.json({ error: `Invalid wallet pubkey: ${body.wallet}` }, 400);
  }

  const feeBps = body.fee_bps ?? 100;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    return c.json({ error: "`fee_bps` must be an integer in [0, 10000]" }, 400);
  }

  const minDeposit = body.min_deposit ?? 1;
  if (typeof minDeposit !== "number" || minDeposit < 0) {
    return c.json({ error: "`min_deposit` must be a non-negative number" }, 400);
  }

  try {
    const prepared = await buildCreateStrategy(connection, payer, {
      name: body.name,
      protocol: body.protocol,
      feeBps,
      minDeposit,
      strategyType: body.strategy_type,
      usdcMint: body.usdc_mint,
    });
    return c.json(prepared);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Failed to build create_strategy tx", detail: message }, 500);
  }
});

interface BuyStrategySharesBody {
  /** Buyer wallet (signs + pays fee). */
  wallet: string;
  /** Whole-USDC amount to deposit (× 1e6 base units on-chain). */
  amount: number;
  /** Strategy share mint address (read from the on-chain Strategy account). */
  share_mint: string;
  /** Strategy wallet PDA address (read from the on-chain Strategy account).
   *  Optional — if omitted we re-derive it from the strategy id (PDA: ["wallet", strategy]). */
  wallet_pda?: string;
  /** Deposit mint (defaults to devnet USDC). */
  deposit_mint?: string;
}

strategies.post("/:id/buy", async (c) => {
  const { id } = c.req.param();

  let strategyKey: PublicKey;
  try {
    strategyKey = new PublicKey(id);
  } catch {
    return c.json({ error: `Invalid strategy address: ${id}` }, 400);
  }

  let body: BuyStrategySharesBody;
  try {
    body = await c.req.json<BuyStrategySharesBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.wallet) return c.json({ error: "`wallet` is required" }, 400);
  if (!body.amount || body.amount <= 0) {
    return c.json({ error: "`amount` must be a positive number" }, 400);
  }
  if (!body.share_mint) {
    return c.json(
      {
        error:
          "`share_mint` is required (read it from the Strategy account, e.g. via `GET /api/strategies/:id`)",
      },
      400
    );
  }

  let payer: PublicKey;
  try {
    payer = new PublicKey(body.wallet);
  } catch {
    return c.json({ error: `Invalid wallet pubkey: ${body.wallet}` }, 400);
  }

  // wallet PDA: derivable from strategy alone — fall back if the client didn't pass it.
  const walletPdaStr = body.wallet_pda ?? walletPDA(strategyKey)[0].toBase58();
  const depositMint = body.deposit_mint ?? DEVNET_USDC.toBase58();

  try {
    const prepared = await buildBuyStrategyShares(connection, payer, {
      strategy: strategyKey.toBase58(),
      shareMint: body.share_mint,
      walletPda: walletPdaStr,
      depositMint,
      amount: body.amount,
    });
    return c.json(prepared);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Failed to build buy_shares tx", detail: message }, 500);
  }
});
