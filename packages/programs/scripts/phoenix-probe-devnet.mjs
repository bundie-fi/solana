#!/usr/bin/env node
/**
 * phoenix-probe-devnet.mjs — ground-truth Phoenix `Swap` ix layout.
 *
 * Builds a Phoenix `Swap` instruction via @ellipsis-labs/phoenix-sdk for an
 * arbitrary SOL/USDC market on devnet, then dumps:
 *   • programId
 *   • keys[] with role flags — source-of-truth ordering for
 *     `PhoenixSwapAccounts` in beethoven/crates/swap/phoenix.
 *   • data hex — should be ~57 bytes for an IOC swap with both Options None
 *     (1 outer Swap tag + 1 IOC tag + 1 side + 1 None price + 8+8+8+8 lots
 *     + 1 self_trade_behavior + 1 None match_limit + 16 client_order_id
 *     + 1 use_only_deposited_funds + 1 None last_valid_slot
 *     + 1 None last_valid_unix_timestamp).
 *
 * Read-only: never sends. Run with:
 *   node packages/programs/scripts/phoenix-probe-devnet.mjs
 *
 * Optional env:
 *   RPC_URL          devnet RPC (default https://api.devnet.solana.com)
 *   KEYPAIR          path to signer keypair (default ~/.config/solana/id.json)
 *   MARKET           market pubkey (default: first market in MarketConfigs)
 *   SIDE             "Bid" or "Ask" (default "Ask" — sell base for quote)
 *   IN_AMOUNT        atoms in (default 1_000_000)
 *   MIN_OUT          min atoms out (default 0 = any)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as Phoenix from "@ellipsis-labs/phoenix-sdk";

const RPC_URL      = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");
const SIDE         = (process.env.SIDE || "Ask").toLowerCase() === "bid"
                     ? Phoenix.Side.Bid : Phoenix.Side.Ask;
const IN_AMOUNT    = BigInt(process.env.IN_AMOUNT || "1000000");
const MIN_OUT      = BigInt(process.env.MIN_OUT || "0");

const PHOENIX_PROGRAM_ID = new PublicKey(
  "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",
);

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const kpBytes = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")));
  const wallet = Keypair.fromSecretKey(kpBytes);

  const client = await Phoenix.Client.create(conn);
  const markets = [...client.markets.entries()];
  if (markets.length === 0) {
    console.error("No Phoenix markets discovered on this RPC");
    process.exit(1);
  }
  const marketAddress = process.env.MARKET
    ? new PublicKey(process.env.MARKET)
    : new PublicKey(markets[0][0]);
  const marketState = client.markets.get(marketAddress.toBase58());
  if (!marketState) {
    console.error(`Market ${marketAddress.toBase58()} not in cache`);
    process.exit(1);
  }

  console.log(`RPC:        ${RPC_URL}`);
  console.log(`Wallet:     ${wallet.publicKey.toBase58()}`);
  console.log(`Program:    ${PHOENIX_PROGRAM_ID.toBase58()}`);
  console.log(`Market:     ${marketAddress.toBase58()}`);
  console.log(`Side:       ${SIDE === Phoenix.Side.Bid ? "Bid (buy base)" : "Ask (sell base)"}`);
  console.log(`In:         ${IN_AMOUNT}`);
  console.log(`Min out:    ${MIN_OUT}`);
  console.log();

  // Build an IOC swap order packet using the SDK helper. The SDK takes
  // human-readable amounts; we approximate by using lot equivalents.
  const orderPacket = marketState.getSwapOrderPacket({
    side: SIDE,
    inAmount: Number(IN_AMOUNT) / 1e6, // best-effort; SDK uses display units
    slippage: 0.5,                     // 50% slippage cap for the probe only
  });

  const ix = client.createSwapInstruction(
    { orderPacket },
    {
      market: marketAddress,
      trader: wallet.publicKey,
      baseAccount: await Phoenix.getAssociatedTokenAddress(
        marketState.data.header.baseParams.mintKey,
        wallet.publicKey,
      ),
      quoteAccount: await Phoenix.getAssociatedTokenAddress(
        marketState.data.header.quoteParams.mintKey,
        wallet.publicKey,
      ),
    },
  );

  console.log("── instruction dump");
  console.log(`programId:  ${ix.programId.toBase58()}`);
  console.log(`keys (${ix.keys.length}):`);
  for (const [i, k] of ix.keys.entries()) {
    const flags = `${k.isSigner ? "S" : "-"}${k.isWritable ? "W" : "R"}`;
    console.log(`  ${String(i).padStart(2)}  ${flags}  ${k.pubkey.toBase58()}`);
  }
  console.log(`data (${ix.data.length} bytes):`);
  console.log(`  hex: ${Buffer.from(ix.data).toString("hex")}`);
  console.log(`  [0] outer Swap tag           = ${ix.data[0]}`);
  console.log(`  [1] OrderPacket variant tag  = ${ix.data[1]} (1 = IOC)`);
  console.log(`  [2] side                     = ${ix.data[2]} (0=Bid, 1=Ask)`);

  console.log();
  console.log("Compare these keys[] to PhoenixSwapAccounts ordering in");
  console.log("packages/beethoven/crates/swap/phoenix/src/lib.rs.");
}

main().catch((e) => {
  console.error("\n✗", e?.stack || e);
  process.exit(1);
});
