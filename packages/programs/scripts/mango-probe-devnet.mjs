#!/usr/bin/env node
/**
 * mango-probe-devnet.mjs — find a usable Mango v4 Group on devnet.
 *
 * Devnet has 42 Group accounts and 29 PerpMarkets but no SDK constant
 * pointing at "the" devnet group. This script enumerates Groups, filters
 * for one whose USDC bank matches our deploy wallet's USDC mint, and
 * reports the PerpMarkets so we can pick a target for the test script.
 *
 * Read-only — no transactions sent.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  MangoClient,
  MANGO_V4_ID,
} from "@blockworks-foundation/mango-v4";

const RPC_URL      = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");
const USDC_MINT    = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const CLUSTER      = "devnet";

// All 42 Group accounts on devnet (from getProgramAccounts memcmp filter on Group disc).
// Listed once here so we don't do another getProgramAccounts on every run.
const KNOWN_GROUPS_DEVNET = [
  "CKU8J1mgtdcJJhBvXrH6xRx1MmcrRWDv8WQdNxPKW3gk",
  "6jjXUTWFCpkBd7HqX5TsKrdmmNQwHvNHC8pi9VbE7kr1",
  "DWYUHSpTJtD5HH8nfLDXkCmcP7hv2DMAug7zLDM5vqK1",
  "GfCN7Qkfw18MVRU441w5nRmRdHttf5AWfufmjVwLV2aQ",
  "9FwDZ6fjqdL6XwiCSotCcG21iPA2LZFjdCnbmQkg5y57",
  "YbtF4DcZFSGrFJnGQV7KZHRmjv6VwVZTBPaZT5EtvAA",
  "5vB8QoPUYU1YssCUhRWkwXEwkUVKzeUb2GKqiGiZnwQ9",
  "7A2THcLxs2Ym9YxPFteTDj7JwGAnYcWxTkHrH4g5dTcS",
];

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const kpBytes = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")));
  const wallet = new Wallet(Keypair.fromSecretKey(kpBytes));
  const provider = new AnchorProvider(conn, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  const programId = new PublicKey(MANGO_V4_ID[CLUSTER]);
  const client = MangoClient.connect(provider, CLUSTER, programId, {
    idsSource: "get-program-accounts",
  });

  // Re-enumerate: 42 was the count earlier; we only seeded the first 8 here.
  // For a quick pass, fetch all program accounts again and filter by Group disc.
  const allGroupPks = await fetchAllGroupPks(conn, programId);
  console.log(`Enumerated ${allGroupPks.length} Group accounts on ${CLUSTER}\n`);

  const MAX = parseInt(process.env.MAX_GROUPS || "8", 10);
  const candidates = [];
  for (const pkStr of allGroupPks.slice(0, MAX)) {
    const t0 = Date.now();
    try {
      const group = await client.getGroup(new PublicKey(pkStr));
      const banks = Array.from(group.banksMapByMint.values()).flat();
      const usdcBank = banks.find((b) => b.mint.equals(USDC_MINT));
      const perps = Array.from(group.perpMarketsMapByName.values());
      const ms = Date.now() - t0;
      console.log(
        `  ${pkStr}  perps=${perps.length}  banks=${banks.length}  usdcBank=${usdcBank ? "yes" : "no"}  (${ms}ms)`,
      );
      if (perps.length === 0) continue;
      candidates.push({ pk: pkStr, group, usdcBank, perps });
    } catch (e) {
      console.log(`  ${pkStr}  ERR ${e?.message ?? e}`);
    }
  }

  console.log(`${candidates.length} groups have ≥1 PerpMarket\n`);
  const withUsdc = candidates.filter((c) => c.usdcBank);
  console.log(`${withUsdc.length} of those also accept our USDC mint ${USDC_MINT.toBase58()}\n`);

  const ranked = (withUsdc.length ? withUsdc : candidates).slice(0, 5);
  for (const c of ranked) {
    console.log(`── Group ${c.pk}`);
    console.log(`   creator:        ${c.group.creator.toBase58()}`);
    console.log(`   admin:          ${c.group.admin.toBase58()}`);
    console.log(`   group_num:      ${c.group.groupNum}`);
    if (c.usdcBank) {
      console.log(`   USDC bank:      ${c.usdcBank.publicKey.toBase58()}`);
      console.log(`   USDC bank name: ${c.usdcBank.name}`);
    } else {
      console.log(`   USDC bank:      (none — has banks for: ${[...new Set(Array.from(c.group.banksMapByMint.values()).flat().map(b => b.mint.toBase58().slice(0,8)))].join(",")})`);
    }
    console.log(`   PerpMarkets (${c.perps.length}):`);
    for (const pm of c.perps.slice(0, 6)) {
      console.log(`     ${pm.publicKey.toBase58()}  name=${pm.name}  perp_market_index=${pm.perpMarketIndex}`);
    }
    console.log();
  }

  if (withUsdc.length === 0) {
    console.log("\n⚠ No group accepts our test USDC mint. Either:");
    console.log("  • mint the wallet some Mango devnet USDC, OR");
    console.log("  • use a different group's stable bank (USDT etc) and swap");
  }
}

async function fetchAllGroupPks(conn, programId) {
  // Group discriminator (sha256("account:Group")[..8] base58)
  const { createHash } = await import("node:crypto");
  const disc = createHash("sha256").update("account:Group").digest().slice(0, 8);
  const bs58 = (await import("bs58")).default ?? (await import("bs58"));
  const accs = await conn.getProgramAccounts(programId, {
    encoding: "base64",
    dataSlice: { offset: 0, length: 0 },
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } }],
  });
  return accs.map((a) => a.pubkey.toBase58());
}

main().catch((e) => {
  console.error("\n✗", e?.stack || e);
  process.exit(1);
});
