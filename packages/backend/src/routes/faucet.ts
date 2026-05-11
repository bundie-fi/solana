import { Hono } from "hono";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { dbQuery } from "../lib/db.js";

export const faucet = new Hono();

// Faucet hands out the canonical agent seed in one claim — same number
// the wizard uses for `seedAmountBusd` and that warmup.ts re-mints as
// USDC on the surfpool fork. Keeping these three numbers in lockstep so
// "I claimed → I seeded my agent → my agent has matching strategy
// capital" is a single mental model.
const FAUCET_AMOUNT_BUSD = 100;
const FAUCET_AMOUNT_BASE = 100_000_000;

function getEnvOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

faucet.post("/api/faucet/claim", async (c) => {
  let body: { wallet?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  if (!body.wallet) return c.json({ error: "wallet required" }, 400);

  let walletPk: PublicKey;
  try {
    walletPk = new PublicKey(body.wallet);
  } catch {
    return c.json({ error: "Invalid wallet pubkey" }, 400);
  }

  // No cooldown — devnet bUSD is mint-only with no scarcity, and the
  // 24h gate was blocking legitimate flows (bettor wallet needs bUSD,
  // user retries after wiping an agent, etc). The faucet_claims table
  // is still written for audit / analytics, just no longer gates.

  // Mint
  let mintPk: PublicKey;
  let authority: Keypair;
  try {
    mintPk = new PublicKey(getEnvOrThrow("BUSD_MINT"));
    authority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(getEnvOrThrow("BUSD_MINT_AUTHORITY_SECRET")))
    );
  } catch {
    return c.json({ error: "Faucet not configured (BUSD env missing)" }, 503);
  }

  const conn = new Connection(
    process.env.DEVNET_RPC ?? "https://api.devnet.solana.com",
    "confirmed"
  );
  const ata = await getOrCreateAssociatedTokenAccount(
    conn,
    authority,
    mintPk,
    walletPk
  );
  const sig = await mintTo(
    conn,
    authority,
    mintPk,
    ata.address,
    authority,
    FAUCET_AMOUNT_BASE
  );

  await dbQuery(
    `INSERT INTO faucet_claims (wallet, amount, tx_sig)
     VALUES ($1, $2, $3)`,
    [body.wallet, FAUCET_AMOUNT_BASE, sig],
  );

  return c.json({
    txSig: sig,
    amount: FAUCET_AMOUNT_BUSD,
    amountBase: FAUCET_AMOUNT_BASE,
  });
});
