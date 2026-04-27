#!/usr/bin/env node
/**
 * test-resolution.mjs — End-to-end resolution-path smoke test on devnet.
 *
 * What this exercises (Phase Q item #5 from HANDOFF-2026-04-27.md):
 *
 *   1. create_market_v2 (kind=1 NavTarget) seeded with `--initial-subsidy`
 *      bUSD, predicting on a peer agent's BundieVault NAV.
 *   2. (optional, default ON) buy_shares — splits a small amount across
 *      YES + NO so the market ends up with non-zero outcome supply on both
 *      sides. Disabled with `--no-buys`.
 *   3. Polls `getSlot` until the market's resolution_slot is reached.
 *   4. resolve_market_v2 — passes the snapshotted target_vault_a; reads
 *      MarketStatus + Outcome from the post-resolution Market account.
 *   5. Reports the winning side, final NAV vs target, total YES vs NO
 *      supply, and the market vault bUSD balance.
 *   6. (optional, default ON) attempts a redeem from the SAME wallet that
 *      bought shares — expected to succeed for the winning side and fail
 *      with `WrongOutcomeMint` for the losing side. Disabled with
 *      `--no-redeem`.
 *
 * Notes on the buy-shares step:
 *   - The deployer (4rebicw8…) is also the creator of this market, so we
 *     use the deployer as the buyer. The on-chain
 *     CreatorCannotPredictOnOwnStrategy guard fires only when the buyer ==
 *     the BundieVault.authority — for charlie's vault that's
 *     8zNazDgyrTX… (≠ deployer), so deployer can buy on this peer market.
 *   - We deliberately buy a tiny amount per side (default 0.1 bUSD shares)
 *     so the post-resolution payout math is easy to eyeball.
 *
 * Usage:
 *   node packages/programs/scripts/test-resolution.mjs                  # dry-run
 *   node packages/programs/scripts/test-resolution.mjs --send           # actually broadcast
 *   node packages/programs/scripts/test-resolution.mjs --send --no-buys # only create + resolve
 *
 * Env / flags:
 *   RPC_URL              default https://api.devnet.solana.com
 *   WALLET_KEYPAIR       default ~/.config/solana/id.json (deployer)
 *   BUSD_MINT_FILE       default <repo>/busd-mint.json
 *   TARGET_AGENT         default 8zNazDgyrTX1CTaPk4G6hZ8r47SbVajh1vcFrqNAzBFg (charlie)
 *   WINDOW_SLOTS         default 1000     (~6.5 minutes)
 *   INITIAL_SUBSIDY      default 2000000  (2 bUSD, matches smoke-test)
 *   FEE_BPS              default 100      (1%)
 *   THRESHOLD_LAMPORTS   default 2000000  (2 bUSD; charlie starts at 1 bUSD,
 *                                          so YES requires NAV doubling
 *                                          inside the window — usually NO wins)
 *   BUY_AMOUNT           default 100000   (0.1 share-unit; mirrors UI minimum)
 *   POLL_INTERVAL_MS     default 5000
 *   --send               actually broadcast all txs (default = dry-run)
 *   --no-buys            skip the buy_shares step (only test create + resolve)
 *   --no-redeem          skip the post-resolve redeem attempt
 *
 * Expected runtime: ~7 minutes when run with --send and default
 * WINDOW_SLOTS=1000 (1000 slots × ~0.4s + ~30s of tx overhead).
 *
 * Limitations: NAV will only move during the window if the target agent's
 * chaos-sim is running and the agent's `commit_nav` ticks land on devnet.
 * If NAV doesn't move, kind=1 NavTarget with a threshold above the snapshot
 * resolves to Outcome::No deterministically. To force YES, set
 * THRESHOLD_LAMPORTS to a value below the agent's current nav_lamports.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  getMint,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Constants (must mirror the deployed program) ─────────────────────────

const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);

const DEFAULT_BUSD_MINT = new PublicKey(
  "42LaRiwvuxfQv5rfHMmk9wU3K2nRxMGzgukNJztydpiB",
);

// charlie's BundieVault authority — keypair pubkey, NOT the vault PDA.
// Vault PDA derives from: ["bundie_vault", this pubkey].
const CHARLIE_AUTHORITY = new PublicKey(
  "8zNazDgyrTX1CTaPk4G6hZ8r47SbVajh1vcFrqNAzBFg",
);

const MARKET_KIND_NAV_TARGET = 1;
const MARKET_PAYLOAD_LEN = 64;

// MarketStatus enum — matches state::Market.status order.
const MARKET_STATUS_ACTIVE = 0;
const MARKET_STATUS_RESOLVED = 1;
const MARKET_STATUS_CANCELLED = 2;

// Outcome enum.
const OUTCOME_YES = 0;
const OUTCOME_NO = 1;

// Anchor account discriminators (sha256("account:<Name>")[..8]).
const MARKET_DISCRIMINATOR = Buffer.from([
  219, 190, 213, 55, 0, 227, 198, 154,
]);
const BUNDIE_VAULT_DISCRIMINATOR = Buffer.from([
  239, 32, 103, 186, 197, 8, 108, 152,
]);

// ─── CLI / env handling ───────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../../../");

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const WALLET_PATH =
  process.env.WALLET_KEYPAIR || join(homedir(), ".config/solana/id.json");
const BUSD_MINT_FILE =
  process.env.BUSD_MINT_FILE || join(REPO_ROOT, "busd-mint.json");

const TARGET_AGENT = new PublicKey(
  process.env.TARGET_AGENT || CHARLIE_AUTHORITY.toBase58(),
);

const WINDOW_SLOTS = BigInt(process.env.WINDOW_SLOTS || "1000");
const INITIAL_SUBSIDY = BigInt(process.env.INITIAL_SUBSIDY || "2000000"); // 2 bUSD
const FEE_BPS = Number(process.env.FEE_BPS || "100");
const THRESHOLD_LAMPORTS = BigInt(
  process.env.THRESHOLD_LAMPORTS || "2000000", // 2 bUSD
);
const BUY_AMOUNT = BigInt(process.env.BUY_AMOUNT || "100000"); // 0.1 share
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || "5000");

const SEND = process.argv.includes("--send");
const SKIP_BUYS = process.argv.includes("--no-buys");
const SKIP_REDEEM = process.argv.includes("--no-redeem");

// ─── Encoding helpers ─────────────────────────────────────────────────────

function anchorIxDisc(fnName) {
  return createHash("sha256")
    .update(`global:${fnName}`)
    .digest()
    .subarray(0, 8);
}

function u8(v) {
  const b = Buffer.alloc(1);
  b.writeUInt8(v, 0);
  return b;
}
function u16LE(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
}
function u64LE(v) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v), 0);
  return b;
}
function borshString(s) {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

function loadKeypair(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  // Tolerates both raw-array (Solana CLI default) and the busd-mint.json
  // shape ({ mint, authority, secret }).
  const secret = Array.isArray(raw) ? raw : raw.secret;
  if (!Array.isArray(secret)) {
    throw new Error(`keypair file ${path} has no secret array`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

// ─── PDA derivation ───────────────────────────────────────────────────────

function bundieVaultPda(authority) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bundie_vault"), authority.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  return pda;
}

function deriveMarketPdas(strategy, marketId) {
  const idLE = u64LE(marketId);
  const [marketPda, marketBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), strategy.toBuffer(), idLE],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPda.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  const [yesMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), marketPda.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  const [noMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), marketPda.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  return { marketPda, marketBump, vaultPda, yesMintPda, noMintPda };
}

// ─── Instruction builders ─────────────────────────────────────────────────

function buildCreateMarketV2Ix({
  creator,
  marketPda,
  strategy,
  strategyB,
  collateralMint,
  vault,
  yesMint,
  noMint,
  subsidySource,
  targetVaultA,
  targetVaultB, // pass programId sentinel for None
  question,
  marketId,
  kind,
  payload,
  resolutionSlot,
  initialSubsidy,
  feeBps,
}) {
  const data = Buffer.concat([
    anchorIxDisc("create_market_v2"),
    borshString(question),
    u64LE(marketId),
    u8(kind),
    payload,
    u64LE(resolutionSlot),
    u64LE(initialSubsidy),
    u16LE(feeBps),
    u64LE(0n), // initial_nav_a — handler overrides for kinds 1/2/3
    u64LE(0n), // initial_nav_b
  ]);

  const keys = [
    { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: marketPda, isSigner: false, isWritable: true },
    { pubkey: strategy, isSigner: false, isWritable: false },
    { pubkey: strategyB, isSigner: false, isWritable: false },
    { pubkey: collateralMint, isSigner: false, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: yesMint, isSigner: false, isWritable: true },
    { pubkey: noMint, isSigner: false, isWritable: true },
    { pubkey: subsidySource, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: targetVaultA, isSigner: false, isWritable: false },
    { pubkey: targetVaultB, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys,
    data,
  });
}

function buildBuySharesIx({
  buyer,
  marketPda,
  strategy,
  yesMint,
  noMint,
  vault,
  buyerCollateral,
  buyerYesAta,
  buyerNoAta,
  outcome, // 0 = YES, 1 = NO
  amount,
}) {
  // Anchor ix data: discriminator || Outcome (u8) || amount (u64 LE)
  const data = Buffer.concat([
    anchorIxDisc("buy_shares"),
    u8(outcome),
    u64LE(amount),
  ]);

  const keys = [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: marketPda, isSigner: false, isWritable: true },
    { pubkey: strategy, isSigner: false, isWritable: false },
    { pubkey: yesMint, isSigner: false, isWritable: true },
    { pubkey: noMint, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: buyerCollateral, isSigner: false, isWritable: true },
    { pubkey: buyerYesAta, isSigner: false, isWritable: true },
    { pubkey: buyerNoAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys,
    data,
  });
}

function buildResolveMarketV2Ix({
  resolver,
  marketPda,
  dataA,
  dataB,
  targetVaultA,
  targetVaultB,
}) {
  const data = anchorIxDisc("resolve_market_v2");
  const keys = [
    { pubkey: resolver, isSigner: true, isWritable: false },
    { pubkey: marketPda, isSigner: false, isWritable: true },
    { pubkey: dataA, isSigner: false, isWritable: false },
    { pubkey: dataB, isSigner: false, isWritable: false },
    { pubkey: targetVaultA, isSigner: false, isWritable: false },
    { pubkey: targetVaultB, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys,
    data,
  });
}

function buildRedeemIx({
  redeemer,
  marketPda,
  winnerMint,
  redeemerShares,
  redeemerCollateral,
  vault,
}) {
  const data = anchorIxDisc("redeem");
  const keys = [
    { pubkey: redeemer, isSigner: true, isWritable: true },
    { pubkey: marketPda, isSigner: false, isWritable: false },
    { pubkey: winnerMint, isSigner: false, isWritable: true },
    { pubkey: redeemerShares, isSigner: false, isWritable: true },
    { pubkey: redeemerCollateral, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys,
    data,
  });
}

// ─── Account decoders ─────────────────────────────────────────────────────

/**
 * Decode just enough of a Market account to determine status + outcome.
 *
 * Layout (after the 8-byte discriminator):
 *   strategy: Pubkey (32)
 *   strategy_b: Option<Pubkey> (1 + 32 if Some else 1)
 *   authority: Pubkey (32)
 *   subsidy_provider: Pubkey (32)
 *   question: String (4 + N bytes)
 *   market_type: enum u8 (1)
 *   market_id: u64 (8)
 *   threshold_bps: u64 (8)
 *   resolution_slot: u64 (8)
 *   yes_shares: u64 (8)
 *   no_shares: u64 (8)
 *   total_yes_cost: u64 (8)
 *   total_no_cost: u64 (8)
 *   liquidity_param: u64 (8)
 *   total_volume: u64 (8)
 *   fee_bps: u16 (2)
 *   vault: Pubkey (32)
 *   collateral_mint: Pubkey (32)
 *   outcome: Option<Outcome (u8)> (1 + 1 if Some else 1)
 *   status: enum u8 (1)
 *   ... (rest unused here)
 *
 * We walk the variable-length fields explicitly because `question` and the
 * two Option<> tags shift everything that follows.
 */
function decodeMarket(buf) {
  if (!buf || buf.length < 8) throw new Error("market: too short");
  const disc = buf.subarray(0, 8);
  if (!disc.equals(MARKET_DISCRIMINATOR)) {
    throw new Error("market: discriminator mismatch");
  }
  let off = 8;
  const strategy = new PublicKey(buf.subarray(off, off + 32));
  off += 32;
  const strategyBTag = buf.readUInt8(off);
  off += 1;
  let strategyB = null;
  if (strategyBTag === 1) {
    strategyB = new PublicKey(buf.subarray(off, off + 32));
    off += 32;
  }
  const authority = new PublicKey(buf.subarray(off, off + 32));
  off += 32;
  off += 32; // subsidy_provider
  const qLen = buf.readUInt32LE(off);
  off += 4;
  const question = buf.subarray(off, off + qLen).toString("utf8");
  off += qLen;
  off += 1; // market_type
  const marketId = buf.readBigUInt64LE(off);
  off += 8;
  off += 8; // threshold_bps
  const resolutionSlot = buf.readBigUInt64LE(off);
  off += 8;
  const yesShares = buf.readBigUInt64LE(off);
  off += 8;
  const noShares = buf.readBigUInt64LE(off);
  off += 8;
  off += 8 + 8 + 8 + 8; // total_yes_cost, total_no_cost, liquidity_param, total_volume
  off += 2; // fee_bps
  const vault = new PublicKey(buf.subarray(off, off + 32));
  off += 32;
  const collateralMint = new PublicKey(buf.subarray(off, off + 32));
  off += 32;
  const outcomeTag = buf.readUInt8(off);
  off += 1;
  let outcome = null;
  if (outcomeTag === 1) {
    outcome = buf.readUInt8(off);
    off += 1;
  }
  const status = buf.readUInt8(off);
  off += 1;
  return {
    strategy,
    strategyB,
    authority,
    question,
    marketId,
    resolutionSlot,
    yesShares,
    noShares,
    vault,
    collateralMint,
    outcome,
    status,
  };
}

/**
 * Decode `nav_lamports` from a BundieVault account.
 *
 * BundieVault layout (from state/bundie_vault.rs, Anchor):
 *   8   discriminator
 *   32  authority
 *   32  owner_wallet
 *   32  treasury_mint
 *   32  treasury_ata
 *   8   nav_lamports          ← byte 136
 *   8   nav_epoch             ← byte 144 (matches CLAUDE memory note)
 *   ...
 *
 * Returns null on any decoding error so the caller can log "?" without
 * aborting the whole resolution test.
 */
const BUNDIE_VAULT_NAV_LAMPORTS_OFFSET = 8 + 32 + 32 + 32 + 32; // 136
function tryDecodeBundieVaultNavLamports(buf) {
  if (!buf || buf.length < BUNDIE_VAULT_NAV_LAMPORTS_OFFSET + 8) return null;
  if (!buf.subarray(0, 8).equals(BUNDIE_VAULT_DISCRIMINATOR)) return null;
  try {
    return buf.readBigUInt64LE(BUNDIE_VAULT_NAV_LAMPORTS_OFFSET);
  } catch {
    return null;
  }
}

// ─── Output helpers ───────────────────────────────────────────────────────

function fmtKey(label, pk, role) {
  const w = role.signer ? "S" : " ";
  const m = role.writable ? "W" : " ";
  return `    [${w}${m}] ${label.padEnd(22)} ${pk.toBase58()}`;
}

function fmtBusd(rawAmount) {
  const n = Number(rawAmount) / 1e6;
  return `${n.toFixed(6)} bUSD`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Pre-flight: ensure deployer has bUSD ─────────────────────────────────

/**
 * If the deployer's bUSD ATA is missing or has < `needed` raw units,
 * mint exactly `needed` units to it from the bUSD authority key in
 * busd-mint.json. Returns the deployer's bUSD ATA pubkey.
 */
async function ensureDeployerBusd(connection, deployer, needed, busdMint) {
  const ata = getAssociatedTokenAddressSync(busdMint, deployer.publicKey);
  let currentBalance = 0n;
  try {
    const acc = await getAccount(connection, ata);
    currentBalance = acc.amount;
  } catch {
    currentBalance = 0n; // ATA missing
  }
  console.log(`  deployer bUSD balance: ${fmtBusd(currentBalance)}`);
  if (currentBalance >= needed) {
    return { ata, minted: 0n };
  }

  const shortfall = needed - currentBalance;
  console.log(
    `  shortfall ${fmtBusd(shortfall)} — minting from bUSD authority…`,
  );
  const busdAuthorityKp = loadKeypair(BUSD_MINT_FILE);

  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(
      deployer.publicKey, // payer
      ata,
      deployer.publicKey, // owner
      busdMint,
    ),
    createMintToInstruction(
      busdMint,
      ata,
      busdAuthorityKp.publicKey,
      shortfall,
    ),
  ];
  const tx = new Transaction().add(...ixs);
  tx.feePayer = deployer.publicKey;
  if (SEND) {
    const sig = await sendAndConfirmTransaction(connection, tx, [
      deployer,
      busdAuthorityKp,
    ]);
    console.log(`  ✓ minted ${fmtBusd(shortfall)} (tx ${sig})`);
  } else {
    console.log(
      `  DRY-RUN: would mint ${fmtBusd(shortfall)} via authority ${busdAuthorityKp.publicKey.toBase58()}`,
    );
  }
  return { ata, minted: shortfall };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Bundie prediction-market resolution-path test ===");
  console.log(`  RPC:           ${RPC_URL}`);
  console.log(`  wallet:        ${WALLET_PATH}`);
  console.log(`  busd-mint.json:${BUSD_MINT_FILE}`);
  console.log(`  target agent:  ${TARGET_AGENT.toBase58()}`);
  console.log(`  windowSlots:   ${WINDOW_SLOTS}`);
  console.log(`  threshold:     ${fmtBusd(THRESHOLD_LAMPORTS)}`);
  console.log(`  initSubsidy:   ${fmtBusd(INITIAL_SUBSIDY)}`);
  console.log(
    `  mode:          ${SEND ? "SEND" : "DRY-RUN"} (pass --send to broadcast)`,
  );
  console.log(`  buys:          ${SKIP_BUYS ? "off" : "on"}`);
  console.log(`  redeem:        ${SKIP_REDEEM ? "off" : "on"}`);
  console.log();

  const connection = new Connection(RPC_URL, "confirmed");
  const deployer = loadKeypair(WALLET_PATH);
  const busdMint = DEFAULT_BUSD_MINT; // overridable via BUSD_MINT env? add if needed

  const sol = await connection.getBalance(deployer.publicKey);
  console.log(`  deployer:      ${deployer.publicKey.toBase58()}`);
  console.log(`  deployer SOL:  ${(sol / 1e9).toFixed(4)}`);
  if (sol < 0.5 * 1e9) {
    console.warn(
      "  WARNING: deployer SOL < 0.5; create_market_v2 rents 5 PDAs and may fail",
    );
  }

  // ── Sanity: target BundieVault must exist on devnet ──
  const targetVaultAPda = bundieVaultPda(TARGET_AGENT);
  console.log(`  target vault A: ${targetVaultAPda.toBase58()}`);
  const targetVaultAcc = await connection.getAccountInfo(targetVaultAPda);
  if (!targetVaultAcc) {
    throw new Error(
      `target_vault_a ${targetVaultAPda.toBase58()} does not exist on devnet — pick a real agent`,
    );
  }
  if (
    !targetVaultAcc.data.subarray(0, 8).equals(BUNDIE_VAULT_DISCRIMINATOR)
  ) {
    throw new Error("target_vault_a discriminator mismatch (not a BundieVault)");
  }
  const initialNav = tryDecodeBundieVaultNavLamports(targetVaultAcc.data);
  console.log(
    `  current NAV:   ${initialNav === null ? "?" : fmtBusd(initialNav)}`,
  );

  if (deployer.publicKey.equals(TARGET_AGENT)) {
    throw new Error(
      "deployer cannot be the target agent (insider guard would reject)",
    );
  }

  // ── Pre-flight: bUSD ATA + balance for the deployer (creator + buyer) ──
  const buysCost = SKIP_BUYS ? 0n : BUY_AMOUNT * 4n; // very generous LMSR slack
  const requiredBusd = INITIAL_SUBSIDY + buysCost;
  console.log();
  console.log(`  required bUSD: ${fmtBusd(requiredBusd)}`);
  const { ata: deployerBusdAta } = await ensureDeployerBusd(
    connection,
    deployer,
    requiredBusd,
    busdMint,
  );

  // ── Build create_market_v2 PDAs ──
  const marketId = BigInt(Date.now());
  const startSlot = await connection.getSlot();
  const resolutionSlot = BigInt(startSlot) + WINDOW_SLOTS;
  const strategy = targetVaultAPda; // peer agent's BundieVault PDA
  const { marketPda, marketBump, vaultPda, yesMintPda, noMintPda } =
    deriveMarketPdas(strategy, marketId);
  const subsidySource = deployerBusdAta;
  const targetVaultASentinel = targetVaultAPda;
  const targetVaultBSentinel = PREDICTION_MARKET_PROGRAM_ID; // None

  // Build payload: kind=1 NavTarget, threshold at offset 0
  const payload = Buffer.alloc(MARKET_PAYLOAD_LEN);
  payload.set(u64LE(THRESHOLD_LAMPORTS), 0);

  const question = `Will agent ${TARGET_AGENT.toBase58().slice(0, 8)}… NAV >= ${fmtBusd(THRESHOLD_LAMPORTS)} by slot ${resolutionSlot}?`;

  console.log();
  console.log("── create_market_v2 ──");
  console.log(`  marketId:      ${marketId}`);
  console.log(`  market PDA:    ${marketPda.toBase58()} (bump ${marketBump})`);
  console.log(`  vault PDA:     ${vaultPda.toBase58()}`);
  console.log(`  yes mint:      ${yesMintPda.toBase58()}`);
  console.log(`  no mint:       ${noMintPda.toBase58()}`);
  console.log(`  startSlot:     ${startSlot}`);
  console.log(`  resolveSlot:   ${resolutionSlot}`);
  console.log(`  question:      ${question}`);

  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    deployer.publicKey,
    deployerBusdAta,
    deployer.publicKey,
    busdMint,
  );
  const createIx = buildCreateMarketV2Ix({
    creator: deployer.publicKey,
    marketPda,
    strategy,
    strategyB: SystemProgram.programId, // None for kind=1
    collateralMint: busdMint,
    vault: vaultPda,
    yesMint: yesMintPda,
    noMint: noMintPda,
    subsidySource,
    targetVaultA: targetVaultASentinel,
    targetVaultB: targetVaultBSentinel,
    question,
    marketId,
    kind: MARKET_KIND_NAV_TARGET,
    payload,
    resolutionSlot,
    initialSubsidy: INITIAL_SUBSIDY,
    feeBps: FEE_BPS,
  });

  if (!SEND) {
    console.log();
    console.log("DRY-RUN: stopping before any tx is broadcast.");
    console.log("  Re-run with --send to actually create + resolve.");
    console.log();
    console.log(`  create_market_v2 ix data length: ${createIx.data.length}`);
    console.log(`  ix accounts:`);
    for (const k of createIx.keys) {
      console.log(
        fmtKey("", k.pubkey, { signer: k.isSigner, writable: k.isWritable }),
      );
    }
    return;
  }

  // ── Step 1: send create_market_v2 ──
  console.log();
  console.log("Step 1: send create_market_v2…");
  const createTx = new Transaction().add(ataIx).add(createIx);
  const createSig = await sendAndConfirmTransaction(connection, createTx, [
    deployer,
  ]);
  console.log(`  ✓ create tx: ${createSig}`);

  // ── Step 2: optional buy_shares (split YES + NO) ──
  let yesAta, noAta;
  if (!SKIP_BUYS) {
    console.log();
    console.log("Step 2: buy_shares — 1× YES, 1× NO from deployer…");
    yesAta = getAssociatedTokenAddressSync(yesMintPda, deployer.publicKey);
    noAta = getAssociatedTokenAddressSync(noMintPda, deployer.publicKey);
    for (const side of [
      { label: "YES", outcome: OUTCOME_YES },
      { label: "NO", outcome: OUTCOME_NO },
    ]) {
      const ix = buildBuySharesIx({
        buyer: deployer.publicKey,
        marketPda,
        strategy, // the BundieVault PDA — buy_shares validates discriminator + authority
        yesMint: yesMintPda,
        noMint: noMintPda,
        vault: vaultPda,
        buyerCollateral: deployerBusdAta,
        buyerYesAta: yesAta,
        buyerNoAta: noAta,
        outcome: side.outcome,
        amount: BUY_AMOUNT,
      });
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
      console.log(`  ✓ ${side.label} bought (${BUY_AMOUNT} units): ${sig}`);
    }
  } else {
    console.log();
    console.log("Step 2: buy_shares SKIPPED (--no-buys).");
  }

  // ── Step 3: poll until resolution_slot ──
  console.log();
  console.log("Step 3: polling getSlot until resolution_slot…");
  const resolutionSlotN = Number(resolutionSlot);
  let lastLog = 0;
  while (true) {
    const cur = await connection.getSlot();
    const remaining = resolutionSlotN - cur;
    if (cur >= resolutionSlotN) {
      console.log(
        `  ✓ slot ${cur} >= resolution_slot ${resolutionSlotN} — proceeding to resolve.`,
      );
      break;
    }
    if (Date.now() - lastLog >= 5000) {
      const eta = (remaining * 0.4).toFixed(0);
      console.log(
        `  slot=${cur}  resolution=${resolutionSlotN}  remaining=${remaining} (~${eta}s)`,
      );
      lastLog = Date.now();
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // ── Step 4: resolve_market_v2 ──
  console.log();
  console.log("Step 4: send resolve_market_v2…");
  const resolveIx = buildResolveMarketV2Ix({
    resolver: deployer.publicKey,
    marketPda,
    dataA: SystemProgram.programId, // unused placeholder per IDL
    dataB: SystemProgram.programId, // unused placeholder per IDL
    targetVaultA: targetVaultAPda,
    targetVaultB: PREDICTION_MARKET_PROGRAM_ID, // None sentinel
  });
  const resolveTx = new Transaction().add(resolveIx);
  const resolveSig = await sendAndConfirmTransaction(connection, resolveTx, [
    deployer,
  ]);
  console.log(`  ✓ resolve tx: ${resolveSig}`);

  // ── Step 5: read post-resolution Market + supplies + vault balance ──
  console.log();
  console.log("Step 5: verify resolved state…");
  const marketAcc = await connection.getAccountInfo(marketPda);
  if (!marketAcc) throw new Error("market account vanished after resolve");
  const decoded = decodeMarket(marketAcc.data);

  if (decoded.status !== MARKET_STATUS_RESOLVED) {
    throw new Error(
      `market.status=${decoded.status}, expected ${MARKET_STATUS_RESOLVED} (Resolved)`,
    );
  }
  if (decoded.outcome === null) {
    throw new Error("market.outcome is None after resolve");
  }
  const winningSide = decoded.outcome === OUTCOME_YES ? "YES" : "NO";
  const losingSide = decoded.outcome === OUTCOME_YES ? "NO" : "YES";

  // Final NAV reading — re-fetch the BundieVault now (post-window).
  const targetVaultAccPost = await connection.getAccountInfo(targetVaultAPda);
  const finalNav = targetVaultAccPost
    ? tryDecodeBundieVaultNavLamports(targetVaultAccPost.data)
    : null;

  // Mint supplies + vault balance for sanity.
  const yesMintInfo = await getMint(connection, yesMintPda);
  const noMintInfo = await getMint(connection, noMintPda);
  const vaultAcc = await getAccount(connection, vaultPda);

  console.log(`  status:        ${decoded.status} (RESOLVED)`);
  console.log(`  winning side:  ${winningSide}`);
  console.log(
    `  final NAV:     ${finalNav === null ? "?" : fmtBusd(finalNav)}`,
  );
  console.log(`  target NAV:    ${fmtBusd(THRESHOLD_LAMPORTS)}`);
  console.log(`  YES supply:    ${yesMintInfo.supply.toString()}`);
  console.log(`  NO supply:     ${noMintInfo.supply.toString()}`);
  console.log(`  vault bUSD:    ${fmtBusd(vaultAcc.amount)}`);

  // ── Step 6: optional redeem path ──
  if (SKIP_REDEEM || SKIP_BUYS) {
    console.log();
    console.log(
      "Step 6: redeem SKIPPED " +
        (SKIP_REDEEM ? "(--no-redeem)." : "(--no-buys; nothing to redeem)."),
    );
    console.log();
    console.log("=== DONE ===");
    return;
  }

  console.log();
  console.log(`Step 6: redeem winning ${winningSide} shares…`);
  const winnerMint = winningSide === "YES" ? yesMintPda : noMintPda;
  const winnerShares = winningSide === "YES" ? yesAta : noAta;
  const loserMint = winningSide === "YES" ? noMintPda : yesMintPda;
  const loserShares = winningSide === "YES" ? noAta : yesAta;

  const redeemWinIx = buildRedeemIx({
    redeemer: deployer.publicKey,
    marketPda,
    winnerMint,
    redeemerShares: winnerShares,
    redeemerCollateral: deployerBusdAta,
    vault: vaultPda,
  });
  try {
    const tx = new Transaction().add(redeemWinIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
    console.log(`  ✓ ${winningSide} redeem succeeded: ${sig}`);
  } catch (e) {
    console.error(`  ✗ ${winningSide} redeem FAILED:`, e?.message || e);
  }

  console.log(`  attempting losing-side ${losingSide} redeem (expected fail)…`);
  const redeemLoseIx = buildRedeemIx({
    redeemer: deployer.publicKey,
    marketPda,
    winnerMint: loserMint, // intentionally wrong
    redeemerShares: loserShares,
    redeemerCollateral: deployerBusdAta,
    vault: vaultPda,
  });
  try {
    const tx = new Transaction().add(redeemLoseIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
    console.log(
      `  ! ${losingSide} redeem unexpectedly succeeded: ${sig} (should have errored on WrongOutcomeMint)`,
    );
  } catch (e) {
    const m = e?.message || String(e);
    console.log(
      `  ✓ ${losingSide} redeem rejected as expected: ${m.slice(0, 200)}…`,
    );
  }

  console.log();
  console.log("=== DONE ===");
}

main().catch((e) => {
  console.error();
  console.error("FAILED:", e?.message || e);
  if (e?.logs) {
    console.error("logs:");
    for (const l of e.logs) console.error(`  ${l}`);
  }
  process.exit(1);
});
