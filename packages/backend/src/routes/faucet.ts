import { Hono } from "hono";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { dbQuery } from "../lib/db.js";

export const faucet = new Hono();

const FAUCET_AMOUNT_BUSD = 50;
const FAUCET_AMOUNT_BASE = 50_000_000;
const COOLDOWN_HOURS = 24;

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

  // Cooldown check via Postgres (bundie-db on Railway).
  const cutoff = new Date(
    Date.now() - COOLDOWN_HOURS * 3600 * 1000,
  ).toISOString();
  const priorResult = await dbQuery<{ created_at: string }>(
    `SELECT created_at
       FROM faucet_claims
       WHERE wallet = $1
         AND created_at >= $2
       LIMIT 1`,
    [body.wallet, cutoff],
  );
  if (!priorResult) {
    return c.json({ error: "Faucet not configured (DATABASE_URL missing)" }, 503);
  }
  if (priorResult.rows.length > 0) {
    return c.json(
      { error: `Cooldown: claim again after ${COOLDOWN_HOURS}h since last claim` },
      429
    );
  }

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
