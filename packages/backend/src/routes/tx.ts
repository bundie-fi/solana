import { Hono } from "hono";

export const tx = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TxType =
  | "buy_shares"
  | "redeem_shares"
  | "buy_prediction"
  | "sell_prediction";

interface BuildTxRequest {
  type: TxType;
  wallet: string;
  strategyAddress?: string;
  marketAddress?: string;
  amount?: number;
  outcome?: "yes" | "no";
}

interface BuildTxResponse {
  transaction: string;
  estimatedFee: number;
}

interface SimulateRequest {
  transaction: string;
}

interface SimulateResponse {
  success: boolean;
  logs: string[];
  unitsConsumed: number;
}

interface BroadcastRequest {
  signedTransaction: string;
}

interface BroadcastResponse {
  txId: string;
  slot: number;
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const MOCK_BASE64_TX =
  "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABhv2EhcGFja2VkX3R4X21vY2s=";

function mockSignature(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let sig = "";
  for (let i = 0; i < 88; i++) {
    sig += chars[Math.floor(Math.random() * chars.length)];
  }
  return sig;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

tx.post("/build", async (c) => {
  const body = await c.req.json<BuildTxRequest>();

  if (!body.type || !body.wallet) {
    return c.json({ error: "type and wallet are required" }, 400);
  }

  const validTypes: TxType[] = [
    "buy_shares",
    "redeem_shares",
    "buy_prediction",
    "sell_prediction",
  ];
  if (!validTypes.includes(body.type)) {
    return c.json(
      { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
      400
    );
  }

  const response: BuildTxResponse = {
    transaction: MOCK_BASE64_TX,
    estimatedFee: 5000,
  };

  return c.json(response);
});

tx.post("/simulate", async (c) => {
  const body = await c.req.json<SimulateRequest>();

  if (!body.transaction) {
    return c.json({ error: "transaction is required" }, 400);
  }

  const response: SimulateResponse = {
    success: true,
    logs: [
      "Program 11111111111111111111111111111111 invoke [1]",
      "Program log: Instruction: TransferChecked",
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]",
      "Program log: Instruction: MintTo",
      "Program log: Strategy shares minted successfully",
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4500 of 200000 compute units",
      "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success",
      "Program 11111111111111111111111111111111 consumed 150000 of 200000 compute units",
      "Program 11111111111111111111111111111111 success",
    ],
    unitsConsumed: 150000,
  };

  return c.json(response);
});

tx.post("/broadcast", async (c) => {
  const body = await c.req.json<BroadcastRequest>();

  if (!body.signedTransaction) {
    return c.json({ error: "signedTransaction is required" }, 400);
  }

  const response: BroadcastResponse = {
    txId: `mock_signature_${mockSignature()}`,
    slot: 123456789 + Math.floor(Math.random() * 10000),
  };

  return c.json(response);
});
