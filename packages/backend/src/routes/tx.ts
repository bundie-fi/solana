import { Hono } from "hono";

export const tx = new Hono();

type TxAction =
  | "strategy_buy"
  | "strategy_redeem"
  | "prediction_buy"
  | "prediction_sell";

interface BuildTxRequest {
  action: TxAction;
  wallet: string;
  params: Record<string, unknown>;
}

interface BuildTxResponse {
  /** Base64-encoded serialized transaction */
  transaction: string;
  /** Estimated SOL fee */
  estimatedFee: number;
  /** Recent blockhash used */
  blockhash: string;
}

// TODO: Build unsigned transaction based on action type:
//   - strategy_buy: CPI into Strategy Token Program (mint shares)
//   - strategy_redeem: CPI into Strategy Token Program (burn shares, withdraw)
//   - prediction_buy: CPI into Prediction Market Program (buy YES/NO)
//   - prediction_sell: CPI into Prediction Market Program (sell shares)
// TODO: Attach recent blockhash, set fee payer to wallet
// TODO: Return serialized unsigned tx for client-side signing
tx.post("/build", async (c) => {
  const body = await c.req.json<BuildTxRequest>();
  // TODO: Validate action, wallet pubkey, and action-specific params

  const response: BuildTxResponse = {
    transaction: "",
    estimatedFee: 0,
    blockhash: "",
  };

  return c.json(response, 501);
});

// TODO: Deserialize the transaction and run simulateTransaction via RPC
// TODO: Return simulation logs, compute units consumed, and any errors
// TODO: Check for common failures (insufficient balance, slippage exceeded)
tx.post("/simulate", async (c) => {
  const body = await c.req.json<{ transaction: string }>();

  return c.json(
    {
      success: false,
      logs: [],
      computeUnits: 0,
      error: "Not implemented",
    },
    501
  );
});

// TODO: Accept a signed (base64) transaction from the client
// TODO: Broadcast via sendRawTransaction with preflight checks
// TODO: Confirm transaction using confirmTransaction with "confirmed" commitment
// TODO: Return the transaction signature
tx.post("/broadcast", async (c) => {
  const body = await c.req.json<{ signedTransaction: string }>();

  return c.json(
    {
      success: false,
      signature: "",
      error: "Not implemented",
    },
    501
  );
});
