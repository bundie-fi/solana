#!/usr/bin/env node
/**
 * openbook-v2-probe-devnet.mjs — ground-truth `place_take_order` ix layout.
 *
 * Builds an OpenBook v2 `place_take_order` instruction via
 * @openbook-dex/openbook-v2, then dumps:
 *   • programId
 *   • keys[] (each with role flags) — source-of-truth ordering for
 *     `OpenbookV2SwapAccounts` in beethoven/crates/swap/openbook-v2.
 *   • data hex (8-byte Anchor disc + 27-byte Borsh args = 35 bytes)
 *
 * Read-only: never sends. Run with:
 *   node packages/programs/scripts/openbook-v2-probe-devnet.mjs
 *
 * Optional env:
 *   RPC_URL    devnet RPC (default https://api.devnet.solana.com)
 *   KEYPAIR    path to signer keypair (default ~/.config/solana/id.json)
 *   MARKET     base58 market pubkey to probe (default: enumerate first market)
 *   SIDE       "bid" or "ask" (default "bid")
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import {
  OpenBookV2Client,
  OPENBOOK_PROGRAM_ID,
  Side,
  PlaceOrderType,
} from "@openbook-dex/openbook-v2";

const RPC_URL      = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");
const SIDE_ARG     = (process.env.SIDE || "bid").toLowerCase();

// Sanity: hash the Anchor method name and confirm the disc we hardcoded.
const EXPECTED_DISC = [3, 44, 71, 3, 26, 199, 203, 85];

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const kpBytes = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")));
  const wallet = new Wallet(Keypair.fromSecretKey(kpBytes));
  const provider = new AnchorProvider(conn, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });

  console.log(`RPC:        ${RPC_URL}`);
  console.log(`Wallet:     ${wallet.publicKey.toBase58()}`);
  console.log(`Program:    ${OPENBOOK_PROGRAM_ID.toBase58()}`);
  console.log();

  const client = new OpenBookV2Client(provider, OPENBOOK_PROGRAM_ID);

  // Pick a market: env override or the first one we can find.
  let marketPk;
  if (process.env.MARKET) {
    marketPk = new PublicKey(process.env.MARKET);
  } else {
    const markets = await client.program.account.market.all();
    if (markets.length === 0) {
      console.error("No markets found on devnet — set MARKET=<pubkey>");
      process.exit(1);
    }
    marketPk = markets[0].publicKey;
    console.log(`Auto-picked market: ${marketPk.toBase58()} (of ${markets.length})`);
  }

  const market = await client.deserializeMarketAccount(marketPk);
  if (!market) throw new Error("Failed to load market account");

  const userBase = await getOrInferTokenAccount(conn, wallet.publicKey, market.baseMint);
  const userQuote = await getOrInferTokenAccount(conn, wallet.publicKey, market.quoteMint);

  const side = SIDE_ARG === "ask" ? Side.Ask : Side.Bid;
  const args = {
    side,
    priceLots: new BN("9223372036854775807"), // i64::MAX — "any price"
    maxBaseLots: new BN(1),
    maxQuoteLotsIncludingFees: new BN(1),
    orderType: PlaceOrderType.ImmediateOrCancel,
    limit: 10,
  };

  const ix = await client.program.methods
    .placeTakeOrder(
      args.side,
      args.priceLots,
      args.maxBaseLots,
      args.maxQuoteLotsIncludingFees,
      args.orderType,
      args.limit,
    )
    .accounts({
      signer: wallet.publicKey,
      penaltyPayer: wallet.publicKey,
      market: marketPk,
      marketAuthority: market.marketAuthority,
      bids: market.bids,
      asks: market.asks,
      marketBaseVault: market.marketBaseVault,
      marketQuoteVault: market.marketQuoteVault,
      eventHeap: market.eventHeap,
      userBaseAccount: userBase,
      userQuoteAccount: userQuote,
      oracleA: market.oracleA?.equals(PublicKey.default) ? null : market.oracleA,
      oracleB: market.oracleB?.equals(PublicKey.default) ? null : market.oracleB,
      openOrdersAdmin: null,
    })
    .instruction();

  console.log("\n=== place_take_order ix ===");
  console.log(`programId: ${ix.programId.toBase58()}`);
  console.log(`keys (${ix.keys.length}):`);
  ix.keys.forEach((k, i) => {
    const role = `${k.isSigner ? "S" : "-"}${k.isWritable ? "W" : "-"}`;
    console.log(`  [${String(i).padStart(2, "0")}] ${role}  ${k.pubkey.toBase58()}`);
  });

  const dataHex = ix.data.toString("hex");
  console.log(`\ndata (${ix.data.length} bytes): ${dataHex}`);
  const disc = Array.from(ix.data.slice(0, 8));
  const discMatches =
    disc.length === EXPECTED_DISC.length &&
    disc.every((b, i) => b === EXPECTED_DISC[i]);
  console.log(`disc:   [${disc.join(", ")}]`);
  console.log(`expect: [${EXPECTED_DISC.join(", ")}]  ${discMatches ? "OK" : "MISMATCH"}`);
}

async function getOrInferTokenAccount(_conn, owner, mint) {
  // Caller can swap this for getAssociatedTokenAddressSync if needed; for a
  // probe that doesn't send, the exact ATA address is fine to derive offline.
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  return getAssociatedTokenAddressSync(mint, owner, true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
