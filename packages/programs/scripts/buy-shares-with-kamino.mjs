#!/usr/bin/env node
/**
 * buy-shares-with-kamino.mjs — strategy-token::buy_shares (dispatch byte 1)
 * with a Kamino deposit threaded through `remaining_accounts`.
 *
 * Per the on-chain handler (programs/strategy-token/src/instructions/buy_shares.rs)
 * a YIELD strategy's buy_shares ALREADY performs the Beethoven deposit CPI
 * inside the same instruction:
 *
 *     util::transfer USDC: buyer ATA → wallet ATA
 *     beethoven::try_from_deposit_context(remaining_accounts)
 *     beethoven::DepositContext::deposit_signed(amount, …, wallet_signer)
 *
 * So we DO NOT need a separate `rebalance` ix. We just need to assemble
 * the `remaining_accounts` block in the layout that beethoven's Kamino
 * adapter expects (see crates/deposit/kamino/src/lib.rs, KaminoDepositAccounts):
 *
 *   [0]  kamino_lending_program          (the program ID itself, as an account)
 *   [1]  owner                            = wallet PDA
 *   [2]  obligation                       = vanilla(wallet, market)
 *   [3]  lending_market
 *   [4]  lending_market_authority         = PDA("lma", market)
 *   [5]  reserve
 *   [6]  reserve_liquidity_mint
 *   [7]  reserve_liquidity_supply
 *   [8]  reserve_collateral_mint
 *   [9]  reserve_destination_deposit_collateral
 *   [10] user_source_liquidity            = wallet's USDC ATA
 *   [11] placeholder_user_destination_collateral  (= klend program id when None)
 *   [12] collateral_token_program         = SPL Token (classic)
 *   [13] liquidity_token_program          = reserve.liquidity.tokenProgram
 *   [14] instruction_sysvar_account
 *   [15] obligation_farm_user_state       (= klend program id when None)
 *   [16] reserve_farm_state               (= klend program id when None)
 *   [17] farms_program
 *   [18] scope_oracle                     = reserve.config.tokenInfo.scopeConfiguration.priceFeed
 *   [19..] additional reserve accounts (≤13, owned by Kamino) — empty for single-reserve strategies
 *
 * Reserve fields are decoded from the on-chain Reserve account using klend-sdk's
 * codegen `Reserve.decode()` (avoids the broken transitive kliquidity-sdk import path).
 *
 * Usage:
 *   node buy-shares-with-kamino.mjs \
 *     --strategy <pubkey> \
 *     --usdc-amount 0.05 \
 *     --kamino-reserve 9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy \
 *     [--lending-market 27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J] \
 *     [--dry-run]
 *
 * Env:
 *   RPC_URL    (default: https://api.devnet.solana.com)
 *   KEYPAIR    (default: ~/.config/solana/id.json)
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Reserve } from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Reserve.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ────────────────────────────── constants ──────────────────────────────

const STRATEGY_TOKEN_PROGRAM_ID = new PublicKey(
  "Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm",
);
const KAMINO_LEND_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const KAMINO_FARMS_PROGRAM_ID = new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
const DEFAULT_PUBKEY = new PublicKey("11111111111111111111111111111111");
const DEFAULT_LENDING_MARKET = new PublicKey(
  "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J",
);

// ────────────────────────────── PDAs ──────────────────────────────

function walletPda(strategy) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("wallet"), strategy.toBuffer()],
    STRATEGY_TOKEN_PROGRAM_ID,
  )[0];
}

function vanillaObligationPda(owner, lendingMarket) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from([0]),
      Buffer.from([0]),
      owner.toBuffer(),
      lendingMarket.toBuffer(),
      DEFAULT_PUBKEY.toBuffer(),
      DEFAULT_PUBKEY.toBuffer(),
    ],
    KAMINO_LEND_PROGRAM_ID,
  )[0];
}

function lendingMarketAuthorityPda(lendingMarket) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lma"), lendingMarket.toBuffer()],
    KAMINO_LEND_PROGRAM_ID,
  )[0];
}

// Read the strategy account's mint / wallet / deposit_mint without needing the IDL.
// Field offsets must match programs/strategy-token/src/state/strategy.rs.
const OFF_MINT = 40;
const OFF_WALLET = 72;
const OFF_DEPOSIT_MINT = 104;
const OFF_STRATEGY_TYPE = 232;
const OFF_STATUS = 233;

function decodeStrategy(buf) {
  return {
    mint: new PublicKey(buf.subarray(OFF_MINT, OFF_MINT + 32)),
    wallet: new PublicKey(buf.subarray(OFF_WALLET, OFF_WALLET + 32)),
    depositMint: new PublicKey(buf.subarray(OFF_DEPOSIT_MINT, OFF_DEPOSIT_MINT + 32)),
    strategyType: buf[OFF_STRATEGY_TYPE],
    status: buf[OFF_STATUS],
  };
}

// klend-sdk's codegen Reserve uses kit `Address` strings — coerce to PublicKey.
function pk(addr) {
  return new PublicKey(typeof addr === "string" ? addr : addr.toString());
}

// ────────────────────────────── arg parsing ──────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--strategy") args.strategy = argv[++i];
    else if (a === "--usdc-amount") args.usdcAmount = parseFloat(argv[++i]);
    else if (a === "--kamino-reserve") args.reserve = argv[++i];
    else if (a === "--lending-market") args.lendingMarket = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node buy-shares-with-kamino.mjs --strategy <pk> --usdc-amount <num> --kamino-reserve <pk> [--lending-market <pk>] [--dry-run]`);
      process.exit(0);
    }
  }
  if (!args.strategy) throw new Error("missing --strategy");
  if (args.usdcAmount === undefined || Number.isNaN(args.usdcAmount))
    throw new Error("missing --usdc-amount");
  if (!args.reserve) throw new Error("missing --kamino-reserve");
  return args;
}

// ────────────────────────────── main ──────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
  const KEYPAIR_PATH = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");

  const conn = new Connection(RPC_URL, "confirmed");
  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"))),
  );

  const strategy = new PublicKey(args.strategy);
  const reserveAddr = new PublicKey(args.reserve);
  const lendingMarket = new PublicKey(
    args.lendingMarket || DEFAULT_LENDING_MARKET,
  );

  // 1. Read strategy account
  const stratInfo = await conn.getAccountInfo(strategy);
  if (!stratInfo) throw new Error(`strategy ${strategy.toBase58()} not found`);
  const strat = decodeStrategy(stratInfo.data);

  console.log(`RPC:                ${RPC_URL}`);
  console.log(`Buyer:              ${buyer.publicKey.toBase58()}`);
  console.log(`Strategy:           ${strategy.toBase58()}`);
  console.log(`  type:             ${strat.strategyType} (0=YIELD, 1=AGENT)`);
  console.log(`  mint:             ${strat.mint.toBase58()}`);
  console.log(`  wallet:           ${strat.wallet.toBase58()}`);
  console.log(`  deposit_mint:     ${strat.depositMint.toBase58()}`);
  console.log(`Lending market:     ${lendingMarket.toBase58()}`);
  console.log(`Kamino reserve:     ${reserveAddr.toBase58()}`);
  console.log(`Amount:             ${args.usdcAmount} USDC`);
  console.log(`Dry run:            ${args.dryRun}`);
  console.log();

  if (strat.strategyType !== 0) {
    throw new Error(
      "this script only handles YIELD strategies (strategy_type=0)",
    );
  }

  // 2. Sanity-check the wallet PDA derivation matches the strategy field
  const expectedWallet = walletPda(strategy);
  if (!expectedWallet.equals(strat.wallet)) {
    throw new Error(
      `wallet PDA mismatch: derived=${expectedWallet.toBase58()} stored=${strat.wallet.toBase58()}`,
    );
  }
  const wallet = strat.wallet;

  // 3. Read Kamino Reserve account directly (avoid KaminoMarket loader's broken deps)
  const reserveInfo = await conn.getAccountInfo(reserveAddr);
  if (!reserveInfo) throw new Error(`reserve ${reserveAddr.toBase58()} not found`);
  if (!reserveInfo.owner.equals(KAMINO_LEND_PROGRAM_ID)) {
    throw new Error(
      `reserve owner ${reserveInfo.owner.toBase58()} is not Kamino program ${KAMINO_LEND_PROGRAM_ID.toBase58()}`,
    );
  }
  const reserve = Reserve.decode(reserveInfo.data);

  const reserveLiqMint = pk(reserve.liquidity.mintPubkey);
  if (!reserveLiqMint.equals(strat.depositMint)) {
    throw new Error(
      `reserve liquidity mint ${reserveLiqMint.toBase58()} does not match strategy deposit mint ${strat.depositMint.toBase58()}`,
    );
  }

  const reserveCollMint = pk(reserve.collateral.mintPubkey);
  const reserveLiqSupply = pk(reserve.liquidity.supplyVault);
  const reserveDestColl = pk(reserve.collateral.supplyVault);

  // Token programs from reserve config (devnet/mainnet may differ)
  const liquidityTokenProgram = pk(reserve.liquidity.tokenProgram);
  // cTokens use the classic SPL token program in vanilla klend
  const collateralTokenProgram = TOKEN_PROGRAM_ID;

  // Lending market authority PDA (seed = "lma")
  const lendingMarketAuthority = lendingMarketAuthorityPda(lendingMarket);

  // Scope oracle (priceFeed addr) — falls back to klend program id if not configured
  const scopeFeedAddr = pk(reserve.config.tokenInfo.scopeConfiguration.priceFeed);
  const scopeOracle = scopeFeedAddr.equals(DEFAULT_PUBKEY)
    ? KAMINO_LEND_PROGRAM_ID
    : scopeFeedAddr;

  // Obligation PDA — must already be initialised (run kamino-init-position.mjs first)
  const obligation = vanillaObligationPda(wallet, lendingMarket);
  const oblInfo = await conn.getAccountInfo(obligation);
  if (!oblInfo) {
    throw new Error(
      `obligation ${obligation.toBase58()} not initialised — run kamino-init-position.mjs first`,
    );
  }

  // ATAs
  const buyerSharesAta = getAssociatedTokenAddressSync(
    strat.mint,
    buyer.publicKey,
  );
  const buyerUsdcAta = getAssociatedTokenAddressSync(
    strat.depositMint,
    buyer.publicKey,
  );
  const walletUsdcAta = getAssociatedTokenAddressSync(
    strat.depositMint,
    wallet,
    true, // allowOwnerOffCurve — wallet is a PDA
  );

  // 4. Build the 11 fixed buy_shares accounts
  const fixedAccounts = [
    { pubkey: buyer.publicKey,              isSigner: true,  isWritable: true  }, // [0] buyer
    { pubkey: strategy,                     isSigner: false, isWritable: true  }, // [1] strategy
    { pubkey: strat.mint,                   isSigner: false, isWritable: true  }, // [2] mint
    { pubkey: buyerSharesAta,               isSigner: false, isWritable: true  }, // [3] buyer_shares_ata
    { pubkey: wallet,                       isSigner: false, isWritable: false }, // [4] wallet PDA
    { pubkey: walletUsdcAta,                isSigner: false, isWritable: true  }, // [5] wallet_token_ata
    { pubkey: buyerUsdcAta,                 isSigner: false, isWritable: true  }, // [6] buyer_token_ata
    { pubkey: TOKEN_PROGRAM_ID,             isSigner: false, isWritable: false }, // [7] token_program
    { pubkey: SystemProgram.programId,      isSigner: false, isWritable: false }, // [8] system_program
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,  isSigner: false, isWritable: false }, // [9] ata_program
    { pubkey: strat.depositMint,            isSigner: false, isWritable: false }, // [10] deposit_mint
  ];

  // 5. Build the 19 Kamino remaining_accounts (no extra reserves for single-asset)
  const kaminoAccounts = [
    { pubkey: KAMINO_LEND_PROGRAM_ID,       isSigner: false, isWritable: false }, // [0] program id
    { pubkey: wallet,                       isSigner: false, isWritable: true  }, // [1] owner (PDA "signs" via beethoven)
    { pubkey: obligation,                   isSigner: false, isWritable: true  }, // [2] obligation
    { pubkey: lendingMarket,                isSigner: false, isWritable: false }, // [3]
    { pubkey: lendingMarketAuthority,       isSigner: false, isWritable: false }, // [4]
    { pubkey: reserveAddr,                  isSigner: false, isWritable: true  }, // [5] reserve
    { pubkey: reserveLiqMint,               isSigner: false, isWritable: false }, // [6]
    { pubkey: reserveLiqSupply,             isSigner: false, isWritable: true  }, // [7]
    { pubkey: reserveCollMint,              isSigner: false, isWritable: true  }, // [8]
    { pubkey: reserveDestColl,              isSigner: false, isWritable: true  }, // [9]
    { pubkey: walletUsdcAta,                isSigner: false, isWritable: true  }, // [10] user_source_liquidity (wallet's USDC ATA)
    { pubkey: KAMINO_LEND_PROGRAM_ID,       isSigner: false, isWritable: false }, // [11] placeholder_user_destination_collateral (None)
    { pubkey: collateralTokenProgram,       isSigner: false, isWritable: false }, // [12]
    { pubkey: liquidityTokenProgram,        isSigner: false, isWritable: false }, // [13]
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,   isSigner: false, isWritable: false }, // [14]
    { pubkey: KAMINO_LEND_PROGRAM_ID,       isSigner: false, isWritable: false }, // [15] obligation_farm_user_state (None)
    { pubkey: KAMINO_LEND_PROGRAM_ID,       isSigner: false, isWritable: false }, // [16] reserve_farm_state (None)
    { pubkey: KAMINO_FARMS_PROGRAM_ID,      isSigner: false, isWritable: false }, // [17] farms_program
    { pubkey: scopeOracle,                  isSigner: false, isWritable: false }, // [18] scope_oracle
  ];

  console.log(`Wallet PDA:         ${wallet.toBase58()}`);
  console.log(`Wallet USDC ATA:    ${walletUsdcAta.toBase58()}`);
  console.log(`Obligation:         ${obligation.toBase58()}`);
  console.log(`Market authority:   ${lendingMarketAuthority.toBase58()}`);
  console.log(`Scope oracle:       ${scopeOracle.toBase58()}`);
  console.log();
  console.log(`Fixed buy_shares accounts:  ${fixedAccounts.length}`);
  console.log(`Kamino remaining_accounts:  ${kaminoAccounts.length}`);
  console.log(`Total accounts in ix:       ${fixedAccounts.length + kaminoAccounts.length}`);
  console.log();

  // 6. Build instruction data: dispatch byte = 1, then u64 LE amount
  const amountLamports = BigInt(Math.round(args.usdcAmount * 1_000_000));
  const data = Buffer.alloc(1 + 8);
  data.writeUInt8(1, 0);
  data.writeBigUInt64LE(amountLamports, 1);

  const ix = new TransactionInstruction({
    programId: STRATEGY_TOKEN_PROGRAM_ID,
    keys: [...fixedAccounts, ...kaminoAccounts],
    data,
  });

  // 7. Dry-run vs send
  const tx = new Transaction().add(ix);
  tx.feePayer = buyer.publicKey;
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  if (args.dryRun) {
    const sim = await conn.simulateTransaction(tx);
    console.log("── simulateTransaction ──");
    console.log(`  err:  ${JSON.stringify(sim.value.err)}`);
    console.log(`  CUs:  ${sim.value.unitsConsumed}`);
    if (sim.value.logs) {
      console.log("  logs (last 20):");
      sim.value.logs.slice(-20).forEach((l) => console.log(`    ${l}`));
    }
    // Sign locally so we can show what the signature WOULD be
    tx.sign(buyer);
    const sigBytes = tx.signatures[0]?.signature;
    const sigStub = sigBytes
      ? Buffer.from(sigBytes).toString("hex").slice(0, 16) + "…"
      : "<unsigned>";
    console.log(`\nOK — would send tx ${sigStub}`);
    return;
  }

  console.log("Sending…");
  const sig = await sendAndConfirmTransaction(conn, tx, [buyer], {
    commitment: "confirmed",
  });
  console.log(`\n✓ buy_shares confirmed: ${sig}`);
  console.log(`  https://orbmarkets.io/tx/${sig}?cluster=devnet`);
}

main().catch((e) => {
  console.error("\n✗", e?.stack || e);
  process.exit(1);
});
