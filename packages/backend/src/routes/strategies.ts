import { Hono } from "hono";

export const strategies = new Hono();

// TODO: Fetch all strategy token accounts from the Strategy Token Program
// TODO: Enrich with off-chain metadata from Supabase (name, description, manager)
// TODO: Include live NAV from Beethoven/Kamino CPI data
strategies.get("/", (c) => {
  return c.json({ strategies: [] });
});

// TODO: Fetch single strategy by mint/PDA address
// TODO: Return full detail: NAV history, holdings breakdown, share price, AUM
// TODO: Include prediction market data if a market exists for this strategy
strategies.get("/:id", (c) => {
  const { id } = c.req.param();
  // TODO: Validate id as a valid Solana public key
  return c.json({ strategy: null, id });
});

// TODO: Build and return unsigned tx to create a new strategy token
// TODO: Validate manager wallet, initial deposit, fee parameters
// TODO: Register strategy metadata in Supabase after on-chain confirmation
strategies.post("/", async (c) => {
  const body = await c.req.json();
  // TODO: Validate request body (name, symbol, depositMint, fees, etc.)
  return c.json({ message: "Not implemented", body }, 501);
});
