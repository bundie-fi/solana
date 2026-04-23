#!/usr/bin/env node
/**
 * seed-prediction-markets.mjs — Seed devnet with a prediction market.
 *
 * Discovers live Strategy accounts on the deployed strategy-token program,
 * picks one, and issues a `create_market` ix against the prediction-market
 * program. Intended to give the `/markets` UI real on-chain data instead of
 * mock "coming soon" cards.
 *
 * Default mode is DRY-RUN: prints the discovered strategies, the chosen
 * market PDA + derived mints + vault, the encoded ix data, and the full
 * AccountMeta list. Pass `--send` to actually broadcast the tx.
 *
 * Usage:
 *   node packages/programs/scripts/seed-prediction-markets.mjs            # dry-run
 *   node packages/programs/scripts/seed-prediction-markets.mjs --send     # actually send
 *   STRATEGY=<pubkey> node ... --send                                     # pin a strategy
 *
 * Env:
 *   RPC_URL           default https://api.devnet.solana.com
 *   WALLET_KEYPAIR    default ~/.config/solana/id.json
 *   STRATEGY          (optional) pubkey to use; otherwise pick the first
 *                     strategy whose authority != our wallet, falling back
 *                     to the first strategy returned.
 *   THRESHOLD_BPS     default 1500   (15% APY)
 *   FEE_BPS           default 100    (1%)
 *   INITIAL_SUBSIDY   default 5_000_000 (5 USDC; payer must have it)
 *   RESOLUTION_SLOTS  default 200_000 (~24h on devnet)
 *
 * Limitations (see report):
 *   - Does NOT call buy_shares. The on-chain handler rejects buys whose buyer
 *     equals the strategy's authority (CreatorCannotPredictOnOwnStrategy).
 *     Both live devnet strategies share our wallet as authority, so buying
 *     YES/NO from this script is impossible without a 2nd funded wallet.
 *   - Does NOT call resolve. Settling needs the strategy's NavOracle to
 *     have snapshot_count > 0 — that requires update_nav, which CPIs into
 *     Kamino reserves and is out of scope for a seeder.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────
const STRATEGY_TOKEN_PROGRAM_ID = new PublicKey(
  "Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm"
);
const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4"
);
const DEVNET_USDC = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/** Strategy account discriminator — must match strategy-token/src/state/strategy.rs */
const STRATEGY_DISCRIMINATOR = Buffer.from([
  0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11,
]);

/** Anchor `create_market` ix discriminator — from prediction_market IDL */
const CREATE_MARKET_DISC = Buffer.from([103, 226, 97, 235, 200, 188, 251, 254]);

/** MarketType enum: 0 = Absolute, 1 = Relative */
const MARKET_TYPE_ABSOLUTE = 0;

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const WALLET_PATH =
  process.env.WALLET_KEYPAIR || join(homedir(), ".config/solana/id.json");
const SEND = process.argv.includes("--send");

const THRESHOLD_BPS = BigInt(process.env.THRESHOLD_BPS || "1500");
const FEE_BPS = Number(process.env.FEE_BPS || 100);
const INITIAL_SUBSIDY = BigInt(process.env.INITIAL_SUBSIDY || "5000000");
const RESOLUTION_DELTA = BigInt(process.env.RESOLUTION_SLOTS || "200000");

// ── Helpers ────────────────────────────────────────────────────────────────
function loadKeypair(path) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))
  );
}

function marketPda(strategy, marketId) {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(marketId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), strategy.toBuffer(), idBuf],
    PREDICTION_MARKET_PROGRAM_ID
  );
}

function vaultPda(market) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID
  );
}

function yesMintPda(market) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), market.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID
  );
}

function noMintPda(market) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), market.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID
  );
}

/**
 * Borsh-encode a non-empty UTF-8 string the way Anchor expects:
 * 4-byte little-endian length prefix, then bytes.
 */
function encodeString(s) {
  const bytes = Buffer.from(s, "utf8");
  const out = Buffer.alloc(4 + bytes.length);
  out.writeUInt32LE(bytes.length, 0);
  bytes.copy(out, 4);
  return out;
}

/**
 * Encode the create_market instruction data per the Anchor IDL.
 * args: question(String), market_id(u64), market_type(enum),
 *       threshold_bps(u64), resolution_slot(u64), initial_subsidy(u64),
 *       fee_bps(u16), initial_nav_per_share(u64), initial_nav_per_share_b(u64)
 */
function encodeCreateMarket({
  question,
  marketId,
  marketType,
  thresholdBps,
  resolutionSlot,
  initialSubsidy,
  feeBps,
  initialNavPerShare,
  initialNavPerShareB,
}) {
  const qBuf = encodeString(question);
  const fixed = Buffer.alloc(8 + 1 + 8 + 8 + 8 + 2 + 8 + 8); // marketId..navB
  let off = 0;
  fixed.writeBigUInt64LE(marketId, off); off += 8;
  fixed.writeUInt8(marketType, off++);
  fixed.writeBigUInt64LE(thresholdBps, off); off += 8;
  fixed.writeBigUInt64LE(resolutionSlot, off); off += 8;
  fixed.writeBigUInt64LE(initialSubsidy, off); off += 8;
  fixed.writeUInt16LE(feeBps, off); off += 2;
  fixed.writeBigUInt64LE(initialNavPerShare, off); off += 8;
  fixed.writeBigUInt64LE(initialNavPerShareB, off); off += 8;
  return Buffer.concat([CREATE_MARKET_DISC, qBuf, fixed]);
}

async function listStrategies(connection) {
  const accs = await connection.getProgramAccounts(STRATEGY_TOKEN_PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: bs58.encode(STRATEGY_DISCRIMINATOR) } },
    ],
  });
  return accs.map(({ pubkey, account }) => {
    const d = Buffer.from(account.data);
    const authority = new PublicKey(d.subarray(8, 40));
    const nameRaw = d.subarray(200, 232);
    const nul = nameRaw.indexOf(0);
    const name = nameRaw
      .subarray(0, nul === -1 ? 32 : nul)
      .toString("utf8");
    return { pubkey, authority, name };
  });
}

function fmtKey(label, pk, role) {
  const w = role.signer ? "S" : " ";
  const m = role.writable ? "W" : " ";
  return `    [${w}${m}] ${label.padEnd(22)} ${pk.toBase58()}`;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(WALLET_PATH);

  console.log("seed-prediction-markets");
  console.log("  RPC:    ", RPC_URL);
  console.log("  payer:  ", payer.publicKey.toBase58());
  console.log("  mode:   ", SEND ? "SEND" : "DRY-RUN (pass --send to broadcast)");
  console.log();

  const balLamports = await conn.getBalance(payer.publicKey);
  console.log("  SOL:    ", (balLamports / 1e9).toFixed(4));

  // If STRATEGY env is set, skip getProgramAccounts (often rate-limited on
  // public devnet RPC) and fetch just that one account.
  let chosen;
  if (process.env.STRATEGY) {
    const want = new PublicKey(process.env.STRATEGY);
    const acc = await conn.getAccountInfo(want);
    if (!acc) {
      console.error(`STRATEGY=${want.toBase58()} not found on-chain.`);
      process.exit(1);
    }
    const d = Buffer.from(acc.data);
    if (!d.subarray(0, 8).equals(STRATEGY_DISCRIMINATOR)) {
      console.error(`STRATEGY=${want.toBase58()} is not a Strategy account.`);
      process.exit(1);
    }
    const authority = new PublicKey(d.subarray(8, 40));
    const nameRaw = d.subarray(200, 232);
    const nul = nameRaw.indexOf(0);
    const name = nameRaw
      .subarray(0, nul === -1 ? 32 : nul)
      .toString("utf8");
    chosen = { pubkey: want, authority, name };
    console.log(`\n  Using STRATEGY override: ${want.toBase58()}`);
  } else {
    const strategies = await listStrategies(conn);
    console.log(`\n  Found ${strategies.length} strategies on-chain:`);
    for (const s of strategies) {
      const self = s.authority.equals(payer.publicKey) ? " (own)" : "";
      console.log(`    ${s.pubkey.toBase58()}  ${s.name || "<unnamed>"}${self}`);
    }
    if (strategies.length === 0) {
      console.error("\nNo strategies on devnet. Run scripts/seed-devnet.ts first.");
      process.exit(1);
    }
    chosen =
      strategies.find((s) => !s.authority.equals(payer.publicKey)) ||
      strategies[0];
  }

  console.log(`\n  Chosen strategy: ${chosen.pubkey.toBase58()} (${chosen.name})`);
  if (chosen.authority.equals(payer.publicKey)) {
    console.log(
      "    NOTE: payer == strategy.authority — buy_shares from this wallet would fail"
    );
    console.log(
      "    with CreatorCannotPredictOnOwnStrategy (error 6011). Skipping share buys."
    );
  }

  // ── Build create_market ix ──────────────────────────────────────────────
  const marketId = BigInt(Date.now());
  const slot = await conn.getSlot();
  const resolutionSlot = BigInt(slot) + RESOLUTION_DELTA;

  const [market, marketBump] = marketPda(chosen.pubkey, marketId);
  const [vault] = vaultPda(market);
  const [yesMint] = yesMintPda(market);
  const [noMint] = noMintPda(market);

  const question = `Will "${chosen.name}" exceed ${Number(THRESHOLD_BPS) / 100}% APY?`;
  const ixData = encodeCreateMarket({
    question,
    marketId,
    marketType: MARKET_TYPE_ABSOLUTE,
    thresholdBps: THRESHOLD_BPS,
    resolutionSlot,
    initialSubsidy: INITIAL_SUBSIDY,
    feeBps: FEE_BPS,
    initialNavPerShare: 1_000_000n, // 1.0 USDC seed NAV
    initialNavPerShareB: 0n,
  });

  // strategy_b is unused for Absolute — pass SystemProgram as placeholder.
  const accounts = [
    { pubkey: payer.publicKey, isSigner: true,  isWritable: true,  _label: "creator"            },
    { pubkey: market,          isSigner: false, isWritable: true,  _label: "market (PDA)"       },
    { pubkey: chosen.pubkey,   isSigner: false, isWritable: false, _label: "strategy"           },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false, _label: "strategy_b (unused)" },
    { pubkey: DEVNET_USDC,     isSigner: false, isWritable: false, _label: "collateral_mint"    },
    { pubkey: vault,           isSigner: false, isWritable: true,  _label: "vault (PDA)"        },
    { pubkey: yesMint,         isSigner: false, isWritable: true,  _label: "yes_mint (PDA)"     },
    { pubkey: noMint,          isSigner: false, isWritable: true,  _label: "no_mint (PDA)"      },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false, _label: "token_program"     },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false, _label: "system_program" },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false, _label: "rent"            },
  ];

  console.log("\n── create_market ix ──");
  console.log("  marketId:        ", marketId.toString());
  console.log("  market PDA:      ", market.toBase58(), `(bump ${marketBump})`);
  console.log("  vault:           ", vault.toBase58());
  console.log("  yes_mint:        ", yesMint.toBase58());
  console.log("  no_mint:         ", noMint.toBase58());
  console.log("  question:        ", question);
  console.log("  threshold_bps:   ", THRESHOLD_BPS.toString(), `(${Number(THRESHOLD_BPS)/100}% APY)`);
  console.log("  resolution_slot: ", resolutionSlot.toString(), `(in ~${Number(RESOLUTION_DELTA) * 0.4 / 3600} h)`);
  console.log("  initial_subsidy: ", INITIAL_SUBSIDY.toString(), "(uUSDC)");
  console.log("  fee_bps:         ", FEE_BPS);
  console.log("  ix data length:  ", ixData.length, "bytes");
  console.log("  ix data (hex):   ", ixData.toString("hex"));
  console.log("  accounts:");
  for (const a of accounts) {
    console.log(fmtKey(a._label, a.pubkey, { signer: a.isSigner, writable: a.isWritable }));
  }

  const ix = new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys: accounts.map(({ pubkey, isSigner, isWritable }) => ({
      pubkey, isSigner, isWritable,
    })),
    data: ixData,
  });

  if (!SEND) {
    console.log("\nDRY-RUN: not sending. Re-run with --send to broadcast.");
    console.log(`Explorer (after send): https://orbmarkets.io/address/${market.toBase58()}?cluster=devnet`);
    return;
  }

  console.log("\nSending create_market…");
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, tx, [payer]);
  console.log("  ✓ tx:", sig);
  console.log("  ✓ market:", market.toBase58());
  console.log(
    `  Explorer: https://orbmarkets.io/address/${market.toBase58()}?cluster=devnet`
  );
  console.log(
    `  Tx:       https://orbmarkets.io/tx/${sig}?cluster=devnet`
  );
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message || e);
  process.exit(1);
});
