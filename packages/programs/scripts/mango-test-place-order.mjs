#!/usr/bin/env node
/**
 * mango-test-place-order.mjs — direct Mango v4 perpPlaceOrder via SDK.
 *
 * Purpose: prove Mango v4 devnet PerpPlaceOrder works end-to-end from our
 * deploy wallet, and capture the account list + borsh data shape that
 * Beethoven's `perps/mango/src/lib.rs` will CPI into.
 *
 * Phases (idempotent, run in order):
 *   A. Ensure MangoAccount exists for our wallet on Group 1701.
 *   B. Ensure ≥ MIN_SOL_COLLATERAL native SOL deposited as collateral.
 *   C. Cancel any open orders (cleanup).
 *   D. Build perpPlaceOrder ix; PRINT its account list + data hex.
 *   E. Send the place_order tx (PostOnly, ~50% under oracle — won't fill).
 *
 * DRY_RUN=1 (default): inspects state, exits BEFORE sending any setup
 *   tx if the account/collateral isn't ready (so you can review what
 *   would happen). If A and B are already done from a prior run, dumps
 *   the would-be place_order ix and exits.
 * DRY_RUN=0: sends accountCreate / tokenDeposit / cancelAll if needed,
 *   then sends the place_order tx.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import pkg from "@coral-xyz/anchor";
const { AnchorProvider, Wallet } = pkg;
import {
  MangoClient,
  MANGO_V4_ID,
  PerpOrderSide,
  PerpOrderType,
} from "@blockworks-foundation/mango-v4";

const RPC_URL      = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");
const CLUSTER      = "devnet";
const GROUP_PK     = new PublicKey("6jjXUTWFCpkBd7HqX5TsKrdmmNQwHvNHC8pi9VbE7kr1");
const PERP_MARKET_INDEX = 0; // BTC-PERP in this group
const SOL_MINT     = new PublicKey("So11111111111111111111111111111111111111112");
const MIN_SOL_COLLATERAL = parseFloat(process.env.MIN_SOL_COLLATERAL || "0.5");
const DEPOSIT_SOL  = parseFloat(process.env.DEPOSIT_SOL || "0.5");
const DRY_RUN      = process.env.DRY_RUN !== "0";
// Mango devnet has unhealthy SOL oracle (OracleConfidence error 6023).
// SKIP_DEPOSIT lets us still capture the perpPlaceOrder ix layout
// (account list + borsh data) for porting to Rust, even with zero collateral.
const SKIP_DEPOSIT = process.env.SKIP_DEPOSIT === "1";

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const kpBytes = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")));
  const kp = Keypair.fromSecretKey(kpBytes);
  const wallet = new Wallet(kp);
  const provider = new AnchorProvider(conn, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  const programId = new PublicKey(MANGO_V4_ID[CLUSTER]);
  const client = MangoClient.connect(provider, CLUSTER, programId, {
    idsSource: "get-program-accounts",
  });

  console.log(`RPC:        ${RPC_URL}`);
  console.log(`Owner:      ${kp.publicKey.toBase58()}`);
  console.log(`Group:      ${GROUP_PK.toBase58()} (1701)`);
  console.log(`PerpIndex:  ${PERP_MARKET_INDEX} (BTC-PERP)`);
  console.log(`Dry run:    ${DRY_RUN}`);
  console.log();

  const group = await client.getGroup(GROUP_PK);
  const perpMarket = group.getPerpMarketByMarketIndex(PERP_MARKET_INDEX);
  console.log(`✓ loaded group + perp market ${perpMarket.publicKey.toBase58()} (${perpMarket.name})`);

  // ── Phase A: MangoAccount ──────────────────────────────────────────────
  let mangoAccount;
  const existing = await client.getMangoAccountsForOwner(group, kp.publicKey);
  if (existing.length > 0) {
    mangoAccount = existing[0];
    console.log(`✓ A. existing MangoAccount: ${mangoAccount.publicKey.toBase58()} (${existing.length} total)`);
  } else if (DRY_RUN) {
    console.log("→ A. no MangoAccount; would create one (re-run with DRY_RUN=0 to send)");
    return;
  } else {
    console.log("→ A. no MangoAccount, creating…");
    const sig = await client.createMangoAccount(group, 0, "yields-v2-test", 8, 4, 4, 4);
    console.log(`  tx: ${sig.signature}`);
    // Devnet RPC can lag — retry the fetch a few times.
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const fresh = await client.getMangoAccountsForOwner(group, kp.publicKey);
      if (fresh.length > 0) { mangoAccount = fresh[0]; break; }
    }
    if (!mangoAccount) throw new Error(`MangoAccount not visible after creation (tx ${sig.signature})`);
    console.log(`✓ created MangoAccount: ${mangoAccount.publicKey.toBase58()}`);
  }

  // Reload to get fresh balances
  await mangoAccount.reload(client);

  // ── Phase B: SOL collateral ────────────────────────────────────────────
  const solBalance = mangoAccount.getTokenBalanceUi(group.getFirstBankByMint(SOL_MINT));
  console.log(`  current SOL collateral: ${solBalance}`);
  if (SKIP_DEPOSIT) {
    console.log("⊘ B. skipped (SKIP_DEPOSIT=1)");
  } else if (solBalance < MIN_SOL_COLLATERAL) {
    if (DRY_RUN) {
      console.log(`→ B. would deposit ${DEPOSIT_SOL} SOL (re-run with DRY_RUN=0)`);
      return;
    }
    console.log(`→ B. depositing ${DEPOSIT_SOL} SOL…`);
    const sig = await client.tokenDeposit(group, mangoAccount, SOL_MINT, DEPOSIT_SOL);
    console.log(`  tx: ${sig.signature}`);
    await mangoAccount.reload(client);
    console.log(`✓ B. SOL collateral after: ${mangoAccount.getTokenBalanceUi(group.getFirstBankByMint(SOL_MINT))}`);
  } else {
    console.log(`✓ B. SOL collateral sufficient (≥${MIN_SOL_COLLATERAL})`);
  }

  // ── Phase C: cancel open orders (cleanup) ──────────────────────────────
  const openOrdersOnMarket = mangoAccount.perpOpenOrders.filter(
    (oo) => oo.orderMarket === PERP_MARKET_INDEX,
  );
  if (openOrdersOnMarket.length > 0) {
    console.log(`→ C. cancelling ${openOrdersOnMarket.length} existing orders…`);
    const sig = await client.perpCancelAllOrders(group, mangoAccount, PERP_MARKET_INDEX, 10);
    console.log(`  tx: ${sig.signature}`);
    await mangoAccount.reload(client);
  } else {
    console.log("✓ C. no existing perp orders");
  }

  // ── Phase D: build place_order ix and dump it ─────────────────────────
  const oraclePriceUi = perpMarket.uiPrice;
  const bidPriceUi = oraclePriceUi * 0.5; // 50% under — postonly won't cross book
  const sizeUi = 0.0001; // 0.0001 BTC ≈ $5 — well under our collateral health
  const clientOrderId = Math.floor(Date.now() / 1000);
  console.log();
  console.log(`oracle price (UI):    ${oraclePriceUi}`);
  console.log(`bid price (UI):       ${bidPriceUi}`);
  console.log(`size (UI):            ${sizeUi} BTC`);
  console.log(`client_order_id:      ${clientOrderId}`);
  console.log();

  const ix = await client.perpPlaceOrderIx(
    group,
    mangoAccount,
    PERP_MARKET_INDEX,
    PerpOrderSide.bid,
    bidPriceUi,
    sizeUi,
    undefined,           // maxQuoteQuantity
    clientOrderId,
    PerpOrderType.postOnly,
    false,               // reduceOnly
    0,                   // expiryTimestamp
    10,                  // limit
  );

  console.log(`── perpPlaceOrder ix (${ix.keys.length} accounts) ──`);
  console.log(`programId: ${ix.programId.toBase58()}`);
  for (const [i, k] of ix.keys.entries()) {
    const role = (k.isSigner ? "S" : ".") + (k.isWritable ? "W" : "R");
    console.log(`  [${String(i).padStart(2)}] ${role} ${k.pubkey.toBase58()}`);
  }
  console.log(`data (${ix.data.length} bytes hex): ${ix.data.toString("hex")}`);
  // Decode the data layout for porting:
  console.log("data layout:");
  console.log(`  [00..08] discriminator: ${ix.data.slice(0, 8).toString("hex")}`);
  console.log(`  [08..09] side:          ${ix.data[8]} (0=Bid 1=Ask)`);
  console.log(`  [09..17] price_lots:    ${ix.data.readBigInt64LE(9)} (i64)`);
  console.log(`  [17..25] max_base_lots: ${ix.data.readBigInt64LE(17)} (i64)`);
  console.log(`  [25..33] max_quote_lots:${ix.data.readBigInt64LE(25)} (i64)`);
  console.log(`  [33..41] client_id:     ${ix.data.readBigUInt64LE(33)} (u64)`);
  console.log(`  [41..42] order_type:    ${ix.data[41]} (0=Limit 1=IOC 2=PostOnly 3=Market 4=PostOnlySlide)`);
  console.log(`  [42..43] reduce_only:   ${ix.data[42]}`);
  console.log(`  [43..51] expiry_ts:     ${ix.data.readBigUInt64LE(43)} (u64)`);
  console.log(`  [51..52] limit:         ${ix.data[51]}`);
  console.log();

  if (DRY_RUN) {
    console.log("Dry run — not sending phase E. Set DRY_RUN=0 to submit.");
    return;
  }

  // ── Phase E: send the order ───────────────────────────────────────────
  const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  const tx = new Transaction().add(cuIx, ix);
  tx.feePayer = kp.publicKey;
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(kp);

  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  console.log(`→ E. sending order…  ${sig}`);
  const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight: (await conn.getLatestBlockhash()).lastValidBlockHeight }, "confirmed");
  if (conf.value.err) {
    console.error(`✗ order tx failed: ${JSON.stringify(conf.value.err)}`);
    process.exit(1);
  }
  console.log(`✓ E. order placed: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((e) => {
  console.error("\n✗", e?.stack || e);
  process.exit(1);
});
