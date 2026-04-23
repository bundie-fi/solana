#!/usr/bin/env node
/**
 * kamino-test-deposit.mjs — direct Kamino deposit via klend-sdk
 *
 * Purpose: prove Kamino devnet works end-to-end from our wallet,
 * and capture the 19-account list Beethoven's on-chain CPI expects.
 *
 * DRY_RUN=1 (default) prints the account list without sending.
 * DRY_RUN=0 sends the deposit tx.
 *
 * The printed account list is the reference we adapt for strategy-token's
 * remaining_accounts in buy-shares (the wallet PDA becomes the obligation
 * owner instead of this script's payer).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import {
  KaminoMarket,
  KaminoAction,
  VanillaObligation,
  PROGRAM_ID,
} from "@kamino-finance/klend-sdk";
import BN from "bn.js";

const RPC_URL        = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH   = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");
const LENDING_MARKET = "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J";
const USDC_MINT      = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const RESERVE_PUBKEY = "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy";
const AMOUNT_USDC    = parseFloat(process.env.AMOUNT_USDC || "0.01"); // 10_000 base units
const DRY_RUN        = process.env.DRY_RUN !== "0";

// Avg devnet slot duration in ms (used by klend for staleness calcs)
const DEVNET_SLOT_DURATION_MS = 450;

async function main() {
  const rpc = createSolanaRpc(RPC_URL);
  const kpBytes = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")));
  const payer = await createKeyPairSignerFromBytes(kpBytes);
  console.log(`RPC:            ${RPC_URL}`);
  console.log(`Payer:          ${payer.address}`);
  console.log(`Lending market: ${LENDING_MARKET}`);
  console.log(`Reserve:        ${RESERVE_PUBKEY}`);
  console.log(`Amount:         ${AMOUNT_USDC} USDC`);
  console.log(`Dry run:        ${DRY_RUN}`);
  console.log();

  const market = await KaminoMarket.load(
    rpc,
    LENDING_MARKET,
    DEVNET_SLOT_DURATION_MS,
    PROGRAM_ID,
    true, // withReserves
  );
  if (!market) throw new Error(`could not load lending market ${LENDING_MARKET}`);
  console.log(`✓ loaded market with ${market.reserves.size} reserves`);

  const reserve = market.reserves.get(RESERVE_PUBKEY);
  if (!reserve) throw new Error(`reserve ${RESERVE_PUBKEY} not in market`);
  console.log(`✓ reserve mint:         ${reserve.getLiquidityMint()}`);
  console.log(`  collateral mint:      ${reserve.getCTokenMint()}`);
  console.log(`  liquidity supply:     ${reserve.state.liquidity.supplyVault}`);
  console.log(`  destination collateral: ${reserve.state.collateral.supplyVault}`);
  console.log();

  const amountLamports = new BN(Math.round(AMOUNT_USDC * 1_000_000));
  const vanilla = new VanillaObligation(PROGRAM_ID);

  const action = await KaminoAction.buildDepositTxns(
    market,
    amountLamports,
    USDC_MINT,
    payer,
    vanilla,
    true,                // useV2Ixs
    undefined,           // scopeRefreshConfig (let SDK decide)
  );

  console.log(`── setup instructions (${action.setupIxs.length}) ──`);
  for (const ix of action.setupIxs) {
    console.log(`  program=${ix.programAddress}  accounts=${ix.accounts?.length ?? 0}  data_bytes=${ix.data?.length ?? 0}`);
  }
  console.log(`── main lending instructions (${action.lendingIxs.length}) ──`);
  for (const [i, ix] of action.lendingIxs.entries()) {
    console.log(`  [${i}] program=${ix.programAddress}  accounts=${ix.accounts?.length ?? 0}  data_bytes=${ix.data?.length ?? 0}`);
    for (const [j, acc] of (ix.accounts ?? []).entries()) {
      console.log(`       ${String(j).padStart(2)} ${acc.address}  signer=${!!(acc.role & 1)} writable=${!!(acc.role & 2)}`);
    }
  }
  console.log(`── cleanup instructions (${action.cleanupIxs.length}) ──`);

  if (DRY_RUN) {
    console.log("\nDry run — not sending. Set DRY_RUN=0 to submit on devnet.");
    return;
  }

  // ── Build + send tx via @solana/kit ──
  const wsUrl = RPC_URL.replace(/^http/, "ws");
  const rpcSubs = createSolanaRpcSubscriptions(wsUrl);
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const allIxs = [...action.setupIxs, ...action.lendingIxs, ...action.cleanupIxs];
  console.log(`\nSending ${allIxs.length} instructions in one tx...`);

  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(allIxs, m),
  );

  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const signature = getSignatureFromTransaction(signedTx);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: rpcSubs });
  try {
    await sendAndConfirm(signedTx, { commitment: "confirmed" });
    console.log(`✓ deposit confirmed: ${signature}`);
    console.log(`  https://orbmarkets.io/tx/${signature}?cluster=devnet`);
  } catch (e) {
    console.error(`\n✗ send failed: ${e?.message ?? e}`);
    console.error(`  signature (if landed): ${signature}`);
    throw e;
  }
}

main().catch((e) => {
  console.error("\n✗", e);
  process.exit(1);
});
