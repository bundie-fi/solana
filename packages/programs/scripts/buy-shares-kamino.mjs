#!/usr/bin/env node
/**
 * buy-shares-kamino.mjs — CLI resolver for the buy-shares + rebalance pair
 * on a strategy whose long leg is a Kamino reserve deposit.
 *
 * Usage:
 *   node buy-shares-kamino.mjs --strategy <pubkey> --usdc <amount> \
 *       --kamino-reserve <reserve-pubkey> [--lending-market <pk>] [--send]
 *
 * Env fallbacks: STRATEGY, USDC, KAMINO_RESERVE, LENDING_MARKET.
 *
 * Defaults to a DRY RUN — pass --send to submit on devnet.
 *
 * What it does:
 *   1. Loads the on-chain strategy account, derives the wallet PDA, sanity-
 *      checks deposit_mint matches the reserve's liquidity mint.
 *   2. Re-uses the klend-sdk resolver pattern from kamino-test-deposit.mjs:
 *      builds a deposit action with the wallet PDA as the noop-signer owner,
 *      then extracts the 17 main-ix accounts and the scope_prices oracle
 *      from the setup refreshReserve ix.
 *   3. Assembles remaining_accounts = [KAMINO_PROGRAM, ...the_17, scope_oracle]
 *      — this is the layout the on-chain Beethoven Kamino adapter expects
 *      (see packages/beethoven/crates/deposit/kamino/src/lib.rs).
 *   4. Builds two strategy-token instructions:
 *        - buy_shares  (disc=1, data=u64 LE amount):  11 fixed accounts.
 *        - rebalance   (disc=4, data=[num_steps=1, ACTION_DEPOSIT=0, amount LE]):
 *                                                     2 fixed + 19 remaining.
 *   5. Dry-run prints the assembled keys[] for each ix; --send submits both
 *      txs sequentially (buy_shares first, then rebalance).
 *
 * Hard-coded devnet config (matches kamino-test-deposit.mjs):
 *   RPC: https://api.devnet.solana.com
 *   wallet: ~/.config/solana/id.json
 *   USDC: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
 *   strategy program: Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  KaminoMarket,
  KaminoAction,
  VanillaObligation,
  PROGRAM_ID as KAMINO_PROGRAM_ID,
} from "@kamino-finance/klend-sdk";
// Anchor pulls in BN; the wrapped import dance prevents the BN ESM/CJS
// "default-export not callable" footgun (same trick kamino-test-deposit.mjs uses).
import pkg from "@coral-xyz/anchor";
const { AnchorProvider, Wallet } = pkg;
import BN from "bn.js";

// ───────────────────────────── constants ──────────────────────────────

const RPC_URL              = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH         = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");
const STRATEGY_PROGRAM_ID  = address("Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm");
const USDC_MINT            = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const DEFAULT_LENDING_MKT  = address("27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J");
const SYSTEM_PROGRAM       = address("11111111111111111111111111111111");
const TOKEN_PROGRAM        = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM          = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const DEVNET_SLOT_DURATION_MS = 450;

// strategy-token state field offsets — must match programs/strategy-token/src/state/strategy.rs
const OFF_DISCRIMINATOR  = 0;
const OFF_MINT           = 40;
const OFF_WALLET         = 72;
const OFF_DEPOSIT_MINT   = 104;
const OFF_STRATEGY_TYPE  = 232;
const STRATEGY_DISCRIMINATOR = Buffer.from([0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11]);
const STRATEGY_TYPE_YIELD = 0;

// rebalance step action discriminators
const ACTION_DEPOSIT = 0;

// ───────────────────────────── arg parsing ──────────────────────────────

function parseArgs(argv) {
  const args = { send: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send")            args.send = true;
    else if (a === "--strategy")        args.strategy = argv[++i];
    else if (a === "--usdc")            args.usdc = argv[++i];
    else if (a === "--kamino-reserve")  args.reserve = argv[++i];
    else if (a === "--lending-market")  args.lendingMarket = argv[++i];
    else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new UserError(`unknown arg: ${a}`);
    }
  }
  args.strategy      = args.strategy      || process.env.STRATEGY;
  args.usdc          = args.usdc          || process.env.USDC;
  args.reserve       = args.reserve       || process.env.KAMINO_RESERVE;
  args.lendingMarket = args.lendingMarket || process.env.LENDING_MARKET;
  if (!args.strategy) throw new UserError("missing --strategy (or STRATEGY env var)");
  if (!args.usdc)     throw new UserError("missing --usdc (or USDC env var) — value in USDC, e.g. 0.05");
  if (!args.reserve)  throw new UserError("missing --kamino-reserve (or KAMINO_RESERVE env var)");
  const usdcFloat = parseFloat(args.usdc);
  if (!Number.isFinite(usdcFloat) || usdcFloat <= 0) {
    throw new UserError(`invalid --usdc value: ${args.usdc}`);
  }
  args.usdcFloat = usdcFloat;
  return args;
}

function printUsage() {
  console.log(
    `Usage: node buy-shares-kamino.mjs \\\n` +
    `         --strategy <pubkey> \\\n` +
    `         --usdc <amount-in-usdc> \\\n` +
    `         --kamino-reserve <reserve-pubkey> \\\n` +
    `         [--lending-market <pubkey>] \\\n` +
    `         [--send]   # default is dry-run\n` +
    `\n` +
    `Env fallbacks: STRATEGY, USDC, KAMINO_RESERVE, LENDING_MARKET`,
  );
}

// User-facing error (printed without stack)
class UserError extends Error {}

function safeAddress(s, label) {
  try {
    return address(s);
  } catch {
    throw new UserError(`${label} is not a valid base58 pubkey: ${s}`);
  }
}

// ───────────────────────────── helpers ──────────────────────────────

function decodeStrategy(buf) {
  if (buf.length < 322) {
    throw new UserError(`strategy account too short (${buf.length} bytes)`);
  }
  const disc = buf.subarray(OFF_DISCRIMINATOR, OFF_DISCRIMINATOR + 8);
  if (!disc.equals(STRATEGY_DISCRIMINATOR)) {
    throw new UserError("account discriminator does not match Strategy");
  }
  const enc = getAddressEncoder();
  const decAddr = (off) => {
    // getAddressEncoder().encode/decode work on Address. Easiest path: treat
    // 32 raw bytes → Address by base58-encoding. Use a tiny helper instead.
    return base58FromBytes(buf.subarray(off, off + 32));
  };
  return {
    mint:         decAddr(OFF_MINT),
    wallet:       decAddr(OFF_WALLET),
    depositMint:  decAddr(OFF_DEPOSIT_MINT),
    strategyType: buf[OFF_STRATEGY_TYPE],
  };
}

// Minimal base58 encode (no extra dep). 32-byte input → Address string.
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58FromBytes(bytes) {
  // Count leading zeros
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // Convert big-endian byte array to base58
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return address(out);
}

async function deriveWalletPda(strategy) {
  const [pda] = await getProgramDerivedAddress({
    programAddress: STRATEGY_PROGRAM_ID,
    seeds: [Buffer.from("wallet"), getAddressEncoder().encode(strategy)],
  });
  return pda;
}

async function ata(owner, mint) {
  const [pda] = await findAssociatedTokenPda({
    owner,
    tokenProgram: TOKEN_PROGRAM,
    mint,
  });
  return pda;
}

// kit-style account formatter — matches kamino-test-deposit.mjs's debug print
function fmtAccount(acc, idx) {
  return `       ${String(idx).padStart(2)} ${acc.address}` +
         `  signer=${(acc.role & 2) === 2}` +
         `  writable=${(acc.role & 1) === 1}`;
}

function logAccountList(label, accounts) {
  console.log(`── ${label} (${accounts.length} accounts) ──`);
  accounts.forEach((a, i) => console.log(fmtAccount(a, i)));
}

// ───────────────────────────── main ──────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  const strategyAddr = safeAddress(args.strategy, "--strategy");
  const reserveAddr  = safeAddress(args.reserve,  "--kamino-reserve");
  const lendingMkt   = args.lendingMarket
    ? safeAddress(args.lendingMarket, "--lending-market")
    : DEFAULT_LENDING_MKT;
  const amountLamports = new BN(Math.round(args.usdcFloat * 1_000_000));

  // ── Set up RPC + signer ────────────────────────────────────────────
  const rpc = createSolanaRpc(RPC_URL);
  let kpBytes;
  try {
    kpBytes = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")));
  } catch (e) {
    throw new UserError(`could not load keypair from ${KEYPAIR_PATH}: ${e.message}`);
  }
  const buyer = await createKeyPairSignerFromBytes(kpBytes);

  console.log(`RPC:             ${RPC_URL}`);
  console.log(`Buyer:           ${buyer.address}`);
  console.log(`Strategy:        ${strategyAddr}`);
  console.log(`Lending market:  ${lendingMkt}`);
  console.log(`Reserve:         ${reserveAddr}`);
  console.log(`Amount:          ${args.usdcFloat} USDC (${amountLamports.toString()} base units)`);
  console.log(`Mode:            ${args.send ? "SEND" : "DRY RUN"}`);
  console.log();

  // ── Read strategy account ──────────────────────────────────────────
  let stratBuf;
  try {
    const acct = await rpc.getAccountInfo(strategyAddr, { encoding: "base64" }).send();
    if (!acct.value) {
      throw new UserError(`strategy ${strategyAddr} not found on devnet`);
    }
    stratBuf = Buffer.from(acct.value.data[0], "base64");
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError(`RPC error fetching strategy: ${e.message ?? e}`);
  }
  const strat = decodeStrategy(stratBuf);
  console.log(`  type:          ${strat.strategyType} (0=YIELD, 1=AGENT)`);
  console.log(`  mint:          ${strat.mint}`);
  console.log(`  wallet:        ${strat.wallet}`);
  console.log(`  deposit_mint:  ${strat.depositMint}`);

  // Sanity-check wallet PDA derivation.
  const walletPda = await deriveWalletPda(strategyAddr);
  if (walletPda !== strat.wallet) {
    throw new UserError(
      `wallet PDA mismatch: derived=${walletPda} stored=${strat.wallet}`,
    );
  }
  if (strat.depositMint !== USDC_MINT) {
    console.warn(`⚠ strategy deposit_mint (${strat.depositMint}) is not the devnet USDC mint`);
  }

  // ── Use klend-sdk to resolve the deposit ix ────────────────────────
  const market = await KaminoMarket.load(
    rpc,
    lendingMkt,
    DEVNET_SLOT_DURATION_MS,
    KAMINO_PROGRAM_ID,
    true,
  );
  if (!market) throw new UserError(`could not load lending market ${lendingMkt}`);

  const reserve = market.reserves.get(reserveAddr);
  if (!reserve) {
    throw new UserError(
      `reserve ${reserveAddr} not in market ${lendingMkt}`,
    );
  }

  const reserveLiqMint = reserve.getLiquidityMint();
  if (reserveLiqMint !== strat.depositMint) {
    throw new UserError(
      `reserve liquidity mint (${reserveLiqMint}) ≠ strategy deposit mint (${strat.depositMint})`,
    );
  }

  // Wallet PDA acts as the obligation owner. KaminoAction.buildDepositTxns
  // accepts a TransactionSigner; for accounts-only resolution, a noop signer
  // bound to the wallet PDA is sufficient (we never call its sign method).
  const walletSigner = createNoopSigner(walletPda);
  const vanilla = new VanillaObligation(KAMINO_PROGRAM_ID);

  let action;
  try {
    action = await KaminoAction.buildDepositTxns(
      market,
      amountLamports,
      strat.depositMint,
      walletSigner,
      vanilla,
      true,            // useV2Ixs
      undefined,       // scopeRefreshConfig — let SDK pick
    );
  } catch (e) {
    throw new UserError(`klend-sdk buildDepositTxns failed: ${e.message ?? e}`);
  }

  if (action.lendingIxs.length !== 1) {
    throw new UserError(
      `expected 1 lending ix from klend-sdk, got ${action.lendingIxs.length}`,
    );
  }
  const sdkAccounts = action.lendingIxs[0].accounts ?? [];
  if (sdkAccounts.length !== 17) {
    throw new UserError(
      `expected 17 accounts in klend-sdk deposit ix, got ${sdkAccounts.length} — Kamino layout drift?`,
    );
  }

  // Find the scope_oracle for our reserve.
  // Approach 1: scan setup/cleanup/inBetween ixs for the refreshReserve ix
  //   (disc = [2, 218, 138, 235, 79, 201, 25, 102]); account[5] is scopePrices.
  // Approach 2: fall back to reading the reserve's tokenInfo.scopeConfiguration
  //   directly (works even if the SDK reordered ixs).
  // Beethoven treats KAMINO_PROGRAM_ID at scope_oracle as a placeholder.
  const REFRESH_RESERVE_DISC = [2, 218, 138, 235, 79, 201, 25, 102];
  const matchesRefresh = (data) =>
    data && data.length >= 8 &&
    REFRESH_RESERVE_DISC.every((b, i) => data[i] === b);

  let scopeOracle = KAMINO_PROGRAM_ID;
  const allIxs = [
    ...(action.setupIxs ?? []),
    ...(action.inBetweenIxs ?? []),
    ...(action.cleanupIxs ?? []),
  ];
  for (const ix of allIxs) {
    if (!matchesRefresh(ix.data)) continue;
    const accs = ix.accounts ?? [];
    if (accs.length >= 6 && accs[0].address === reserveAddr) {
      scopeOracle = accs[5].address;
      break;
    }
  }
  // Approach 2: read directly from reserve state if the ix scan missed.
  if (scopeOracle === KAMINO_PROGRAM_ID) {
    try {
      const feed = reserve.state?.config?.tokenInfo?.scopeConfiguration?.priceFeed;
      const feedStr = feed ? feed.toString() : "";
      if (feedStr && feedStr !== "11111111111111111111111111111111") {
        scopeOracle = address(feedStr);
      } else {
        console.warn("⚠ reserve has no scope priceFeed — scope_oracle defaulted to KAMINO_PROGRAM_ID");
      }
    } catch (e) {
      console.warn(`⚠ could not read scope priceFeed: ${e.message ?? e}`);
    }
  }

  // ── Assemble Beethoven remaining_accounts ──────────────────────────
  // [0] kamino_lending_program  (detector)
  // [1..18] = the 17 main-ix accounts from klend-sdk
  // [18] = scope_oracle
  const remainingAccounts = [
    { address: KAMINO_PROGRAM_ID, role: 0 },
    ...sdkAccounts,
    { address: scopeOracle,       role: 0 },
  ];

  // The first sdk-account is the owner (wallet PDA) and is marked role=3
  // (writable + signer). The signer flag on a remaining account is fine —
  // the on-chain pinocchio program signs via the wallet PDA seeds; the
  // signer marker just lets the runtime accept the wallet PDA as the
  // expected signer in the inner CPI.

  // ── Compute strategy-token "fixed" accounts for buy_shares ────────
  const buyerSharesAta = await ata(buyer.address, strat.mint);
  const buyerUsdcAta   = await ata(buyer.address, strat.depositMint);
  const walletUsdcAta  = await ata(walletPda,     strat.depositMint);

  const buySharesAccounts = [
    { address: buyer.address,   role: 3, signer: buyer }, // [0] buyer (W+S)
    { address: strategyAddr,    role: 1 },                // [1] strategy (W)
    { address: strat.mint,      role: 1 },                // [2] mint (W)
    { address: buyerSharesAta,  role: 1 },                // [3] buyer_shares_ata (W)
    { address: walletPda,       role: 0 },                // [4] wallet PDA
    { address: walletUsdcAta,   role: 1 },                // [5] wallet_token_ata (W)
    { address: buyerUsdcAta,    role: 1 },                // [6] buyer_token_ata (W)
    { address: TOKEN_PROGRAM,   role: 0 },                // [7] token_program
    { address: SYSTEM_PROGRAM,  role: 0 },                // [8] system_program
    { address: ATA_PROGRAM,     role: 0 },                // [9] ata_program
    { address: strat.depositMint, role: 0 },              // [10] deposit_mint
  ];

  // ── Compute strategy-token "fixed" accounts for rebalance ──────────
  const rebalanceFixed = [
    { address: buyer.address,  role: 3, signer: buyer }, // [0] authority (W+S)
    { address: strategyAddr,   role: 1 },                // [1] strategy (W)
  ];

  // ── Build instruction-data buffers ─────────────────────────────────
  // buy_shares: [disc=1, amount LE u64]
  const buySharesData = new Uint8Array(1 + 8);
  buySharesData[0] = 1;
  const dvBS = new DataView(buySharesData.buffer, buySharesData.byteOffset, buySharesData.byteLength);
  dvBS.setBigUint64(1, BigInt(amountLamports.toString()), true);

  // rebalance: [disc=4, num_steps=1, ACTION_DEPOSIT=0, amount LE u64]
  const rebalanceData = new Uint8Array(1 + 1 + 1 + 8);
  rebalanceData[0] = 4;
  rebalanceData[1] = 1;
  rebalanceData[2] = ACTION_DEPOSIT;
  const dvRB = new DataView(rebalanceData.buffer, rebalanceData.byteOffset, rebalanceData.byteLength);
  dvRB.setBigUint64(3, BigInt(amountLamports.toString()), true);

  // Optionally append remaining accounts to buy_shares for YIELD strategies
  // (the on-chain handler requires non-empty remaining for YIELD). For AGENT
  // strategies, buy_shares stays at 11 fixed accounts. Either way the
  // rebalance ix carries the full Beethoven account list itself.
  let buySharesFinalAccounts;
  if (strat.strategyType === STRATEGY_TYPE_YIELD) {
    console.warn(
      "⚠ strategy_type=YIELD — on-chain buy_shares requires non-empty remaining_accounts.",
    );
    console.warn(
      "  Including the full Kamino account list on buy_shares too (rebalance still issues a 2nd deposit).",
    );
    buySharesFinalAccounts = [...buySharesAccounts, ...remainingAccounts];
  } else {
    buySharesFinalAccounts = buySharesAccounts;
  }

  const buySharesIx = {
    programAddress: STRATEGY_PROGRAM_ID,
    accounts: buySharesFinalAccounts,
    data: buySharesData,
  };

  const rebalanceIx = {
    programAddress: STRATEGY_PROGRAM_ID,
    accounts: [...rebalanceFixed, ...remainingAccounts],
    data: rebalanceData,
  };

  // ── Print ix shapes ────────────────────────────────────────────────
  console.log();
  console.log(`Wallet PDA:          ${walletPda}`);
  console.log(`Wallet USDC ATA:     ${walletUsdcAta}`);
  console.log(`Buyer shares ATA:    ${buyerSharesAta}`);
  console.log(`Buyer USDC ATA:      ${buyerUsdcAta}`);
  console.log(`Scope oracle:        ${scopeOracle}`);
  console.log();
  console.log(`buy_shares ix data (${buySharesData.length} B): ${Buffer.from(buySharesData).toString("hex")}`);
  console.log(`rebalance  ix data (${rebalanceData.length} B): ${Buffer.from(rebalanceData).toString("hex")}`);
  console.log();
  logAccountList("buy_shares accounts",   buySharesIx.accounts);
  console.log();
  logAccountList("rebalance accounts",    rebalanceIx.accounts);
  console.log();

  if (!args.send) {
    console.log("Dry run — pass --send to submit on devnet.");
    return;
  }

  // ── Send ───────────────────────────────────────────────────────────
  const wsUrl = RPC_URL.replace(/^http/, "ws");
  const rpcSubs = createSolanaRpcSubscriptions(wsUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions: rpcSubs,
  });

  const sendOne = async (label, ix) => {
    let blockhash;
    try {
      ({ value: blockhash } = await rpc.getLatestBlockhash().send());
    } catch (e) {
      throw new UserError(`RPC failure getting blockhash before ${label}: ${e.message ?? e}`);
    }
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(buyer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([ix], m),
    );
    const signed = await signTransactionMessageWithSigners(msg);
    const sig = getSignatureFromTransaction(signed);
    try {
      await sendAndConfirm(signed, { commitment: "confirmed" });
    } catch (e) {
      throw new UserError(
        `${label} send failed: ${e.message ?? e}\n  signature (if landed): ${sig}\n  https://orbmarkets.io/tx/${sig}?cluster=devnet`,
      );
    }
    console.log(`✓ ${label} confirmed: ${sig}`);
    console.log(`  https://orbmarkets.io/tx/${sig}?cluster=devnet`);
    return sig;
  };

  console.log("\nSending buy_shares…");
  await sendOne("buy_shares", buySharesIx);
  console.log("\nSending rebalance…");
  await sendOne("rebalance",  rebalanceIx);
  console.log("\nDone.");
}

main().catch((e) => {
  if (e instanceof UserError) {
    console.error(`\n✗ ${e.message}`);
  } else {
    // Generic RPC / unexpected — show the message but spare the stack trace
    // unless DEBUG=1 is set.
    if (process.env.DEBUG === "1") {
      console.error("\n✗", e);
    } else {
      console.error(`\n✗ ${e?.message ?? e}`);
      console.error("  (run with DEBUG=1 for full stack)");
    }
  }
  process.exit(1);
});
