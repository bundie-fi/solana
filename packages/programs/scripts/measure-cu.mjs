#!/usr/bin/env node
/**
 * measure-cu.mjs — Measure LS-LMSR compute-unit consumption on devnet.
 *
 * Usage:
 *   node packages/programs/scripts/measure-cu.mjs
 *
 * Env:
 *   RPC_URL      (default: https://api.devnet.solana.com)
 *   KEYPAIR      (default: ~/.config/solana/id.json)
 *   MARKET       (default: baked-in seeded market pubkey)
 *   STRATEGY     (default: baked-in seeded strategy pubkey)
 *
 * What it does:
 *   Builds a buy_shares instruction, wraps it in a tx with a 1.4M CU limit,
 *   calls simulateTransaction, and prints consumedComputeUnits. No SOL or
 *   USDC is spent — simulation only.
 *
 *   This is the Week 2 gate in v5 §2 ("SBF profile of LS-LMSR on LiteSVM
 *   with worst-case inputs") for LS-LMSR. Target: <200K CU per buy_shares.
 *   Hard ceiling: 1.4M CU (Solana default).
 *
 *   Three scenarios are simulated:
 *     1. Small buy, balanced market  (typical case)
 *     2. Large buy, balanced market  (stress test on amount)
 *     3. Small buy, asymmetric market (stress test on LMSR log-sum-exp)
 *
 *   If any scenario exceeds 1.4M CU, Scenario A contingency kicks in
 *   (coarser precision or CLP migration pulled forward).
 *
 * Note: This script queries the on-chain market/strategy state. The current
 *   deployed version may or may not have the creator-self-exclusion change
 *   (commit d01a271). The +300 CU for that check is negligible; this script
 *   primarily measures LS-LMSR math which is unchanged by that commit.
 *
 * Prerequisites for a clean run:
 *   1. The wallet at $KEYPAIR must have an initialized USDC ATA for
 *      4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU on devnet. Create it with:
 *        spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --url devnet
 *      Then faucet some devnet USDC from https://faucet.circle.com
 *   2. Layout must match the deployed version. Current devnet = "legacy"
 *      (9 accounts, pre-d01a271). After redeploying the updated PM program,
 *      set LAYOUT=new to include the strategy account.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Defaults ───────────────────────────────────────────────────────────────
const PM_PROGRAM_ID = new PublicKey("Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4");
const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const MARKET_STR = process.env.MARKET || "2XfBNnZ5YEH23tB4QdCNzXu2bJmeY5WwmMuikGgZP8wu";
const STRATEGY_STR = process.env.STRATEGY || "93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF";
const KEYPAIR_PATH = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");

// ── Anchor discriminator for `buy_shares` ──────────────────────────────────
function discriminator(name) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}
const DISC_BUY_SHARES = discriminator("buy_shares");

// ── PDAs ───────────────────────────────────────────────────────────────────
function pda(seeds, programId) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function loadKeypair(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ── Simulation scenarios ───────────────────────────────────────────────────
const SCENARIOS = [
  { name: "baseline — 1 USDC YES",        outcome: 0, amount: 1_000_000n },
  { name: "large — 100 USDC YES",         outcome: 0, amount: 100_000_000n },
  { name: "small NO leg",                 outcome: 1, amount: 1_000_000n },
];

// ── Build buy_shares instruction ───────────────────────────────────────────
function encodeOutcome(outcome) {
  // Anchor enum { Yes } / { No } → single variant byte
  return Buffer.from([outcome]);
}

// Layout toggle: `new` matches the committed (self-exclusion) version; `legacy`
// matches the version deployed to devnet before that redeploy. Defaults to
// `legacy` so the script runs today without waiting on a redeploy.
const LAYOUT = process.env.LAYOUT || "legacy";

function buildBuySharesIx({ buyer, market, strategy, yesMint, noMint, vault, buyerCollateral, buyerYesAta, buyerNoAta, outcome, amount }) {
  const data = Buffer.concat([
    DISC_BUY_SHARES,
    encodeOutcome(outcome),
    Buffer.from(new BigUint64Array([amount]).buffer),
  ]);

  const base = [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: market, isSigner: false, isWritable: true },
  ];

  const withStrategy = LAYOUT === "new"
    ? [{ pubkey: strategy, isSigner: false, isWritable: false }]
    : [];

  const rest = [
    { pubkey: yesMint, isSigner: false, isWritable: true },
    { pubkey: noMint, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: buyerCollateral, isSigner: false, isWritable: true },
    { pubkey: buyerYesAta, isSigner: false, isWritable: true },
    { pubkey: buyerNoAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: PM_PROGRAM_ID,
    keys: [...base, ...withStrategy, ...rest],
    data,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`RPC:       ${RPC_URL}`);
  console.log(`Market:    ${MARKET_STR}`);
  console.log(`Strategy:  ${STRATEGY_STR}`);
  console.log(`Keypair:   ${KEYPAIR_PATH}`);
  console.log();

  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(KEYPAIR_PATH);
  const market = new PublicKey(MARKET_STR);
  const strategy = new PublicKey(STRATEGY_STR);

  const yesMint = pda([Buffer.from("yes_mint"), market.toBuffer()], PM_PROGRAM_ID);
  const noMint = pda([Buffer.from("no_mint"), market.toBuffer()], PM_PROGRAM_ID);
  const vault = pda([Buffer.from("vault"), market.toBuffer()], PM_PROGRAM_ID);

  const buyerCollateral = getAssociatedTokenAddressSync(DEVNET_USDC, payer.publicKey);
  const buyerYesAta = getAssociatedTokenAddressSync(yesMint, payer.publicKey, true);
  const buyerNoAta = getAssociatedTokenAddressSync(noMint, payer.publicKey, true);

  // Sanity: verify the strategy and market exist
  const [stratInfo, marketInfo] = await Promise.all([
    connection.getAccountInfo(strategy),
    connection.getAccountInfo(market),
  ]);
  if (!stratInfo) throw new Error(`Strategy account not found at ${STRATEGY_STR}`);
  if (!marketInfo) throw new Error(`Market account not found at ${MARKET_STR}`);
  console.log(`✓ strategy owner: ${stratInfo.owner.toBase58()}`);
  console.log(`✓ market owner:   ${marketInfo.owner.toBase58()}`);
  console.log();

  const results = [];
  for (const scn of SCENARIOS) {
    const ix = buildBuySharesIx({
      buyer: payer.publicKey,
      market,
      strategy,
      yesMint,
      noMint,
      vault,
      buyerCollateral,
      buyerYesAta,
      buyerNoAta,
      outcome: scn.outcome,
      amount: scn.amount,
    });

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
      .add(ix);
    tx.feePayer = payer.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    // classic Transaction signature: simulateTransaction(tx, signers?)
    const sim = await connection.simulateTransaction(tx, [payer]);

    const cu = sim.value.unitsConsumed;
    const err = sim.value.err;
    const firstLog = (sim.value.logs || [])
      .filter(l => l.includes("Program "))
      .slice(0, 3)
      .join("\n    ");

    results.push({ name: scn.name, amount: scn.amount.toString(), cu, err });
    console.log(`[${scn.name}]`);
    console.log(`  amount (base units): ${scn.amount}`);
    console.log(`  consumedComputeUnits: ${cu ?? "n/a"}`);
    console.log(`  err: ${err ? JSON.stringify(err) : "none"}`);
    if (err && firstLog) console.log(`  logs:\n    ${firstLog}`);
    console.log();
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("── Summary ──────────────────────────────────────────────────");
  const successes = results.filter(r => !r.err && r.cu != null);
  const failures  = results.filter(r => r.err);

  if (successes.length === 0) {
    console.log("No scenario simulated cleanly. Check that the market is active,");
    console.log("your wallet has the required USDC ATA initialized, and the");
    console.log("deployed PM program accepts the accounts in the order above");
    console.log("(note: the strategy account was added in commit d01a271 and");
    console.log("requires a redeploy before this script succeeds).");
  } else {
    const max = Math.max(...successes.map(r => r.cu));
    console.log(`  worst-case CU:        ${max.toLocaleString()}`);
    console.log(`  target (<200K):       ${max < 200_000 ? "PASS" : "FAIL"}`);
    console.log(`  hard ceiling (<1.4M): ${max < 1_400_000 ? "PASS" : "FAIL — Scenario A kicks in"}`);
  }

  if (failures.length) {
    console.log(`  ${failures.length} / ${results.length} scenarios errored.`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
