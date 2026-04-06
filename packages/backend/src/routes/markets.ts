import { Hono } from "hono";

export const markets = new Hono();

// TODO: Fetch all prediction market accounts from the Prediction Market Program
// TODO: Include current YES/NO prices computed via LS-LMSR pricing function
// TODO: Filter by status (open, resolved, expired)
markets.get("/", (c) => {
  return c.json({ markets: [] });
});

// TODO: Fetch single market by PDA address
// TODO: Return full detail: LS-LMSR state (b, q_yes, q_no), current prices,
//       resolution criteria, linked strategy, total volume, expiry timestamp
// TODO: Compute cost function C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))
markets.get("/:id", (c) => {
  const { id } = c.req.param();
  return c.json({ market: null, id });
});

// TODO: Calculate cost delta via LS-LMSR for buying YES or NO shares
// TODO: Build unsigned transaction for the prediction market buy instruction
// TODO: Return the tx along with price impact and expected shares
markets.post("/:id/buy", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  // TODO: Validate body (side: "yes" | "no", amount, wallet)
  return c.json({ message: "Not implemented", id, body }, 501);
});

// TODO: Trigger resolution by reading linked strategy's on-chain NAV
// TODO: Compare NAV against market's resolution threshold
// TODO: Build unsigned resolve instruction (oracle-free, uses on-chain data)
markets.post("/:id/resolve", async (c) => {
  const { id } = c.req.param();
  return c.json({ message: "Not implemented", id }, 501);
});
