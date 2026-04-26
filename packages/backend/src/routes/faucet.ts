import { Hono } from "hono";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { createClient } from "@supabase/supabase-js";

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

  // Cooldown check via Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return c.json({ error: "Faucet not configured (Supabase env missing)" }, 503);
  }
  const supa = createClient(supabaseUrl, supabaseKey);
  const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const { data: prior } = await supa
    .from("faucet_claims")
    .select("created_at")
    .eq("wallet", body.wallet)
    .gte("created_at", cutoff)
    .limit(1);
  if (prior && prior.length > 0) {
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

  await supa.from("faucet_claims").insert({
    wallet: body.wallet,
    amount: FAUCET_AMOUNT_BASE,
    tx_sig: sig,
  });

  return c.json({
    txSig: sig,
    amount: FAUCET_AMOUNT_BUSD,
    amountBase: FAUCET_AMOUNT_BASE,
  });
});
