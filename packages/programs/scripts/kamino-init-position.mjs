#!/usr/bin/env node
/**
 * kamino-init-position.mjs — routes Kamino UserMetadata + Obligation init
 * THROUGH our strategy-token + forked Beethoven (dispatch byte 6).
 *
 * Unlike kamino-test-deposit.mjs (which bypasses Beethoven to validate
 * the external contract), this script exercises the real production path:
 *
 *   authority (user) ──▶ strategy-token::init_position (byte 6)
 *                          └──▶ beethoven::try_from_deposit_init_context
 *                                   └──▶ KaminoInitAccounts
 *                                          └──▶ Kamino::init_signed
 *                                                 ├──▶ CPI init_user_metadata   (wallet PDA signs via seeds)
 *                                                 └──▶ CPI init_obligation      (wallet PDA signs via seeds)
 *
 * Prereqs: a YIELD strategy already exists and its protocol field is
 * Kamino's program id. Works on strategy 6kQ1qdE2sQ8L69Cv2bAjZKXMyLD73nCkh5wqjorvLCiv
 * created earlier this iteration.
 *
 * Usage:
 *   DRY_RUN=1 STRATEGY=<pubkey> node kamino-init-position.mjs
 *   DRY_RUN=0 STRATEGY=<pubkey> node kamino-init-position.mjs
 *
 * Env:
 *   RPC_URL    (default: https://api.devnet.solana.com)
 *   KEYPAIR    (default: ~/.config/solana/id.json)
 *   STRATEGY   (default: seeded YIELD strategy 6kQ1qdE2sQ8L...)
 *   LENDING_MARKET  (default: 27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J)
 *   DRY_RUN    (default: 1 — set to 0 to send)
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
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RPC_URL       = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH  = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");
const STRATEGY      = new PublicKey(process.env.STRATEGY || "6kQ1qdE2sQ8L69Cv2bAjZKXMyLD73nCkh5wqjorvLCiv");
const LENDING_MARKET = new PublicKey(process.env.LENDING_MARKET || "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J");
const DRY_RUN       = process.env.DRY_RUN !== "0";

const STRATEGY_TOKEN_PROGRAM_ID = new PublicKey("Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm");
const KAMINO_LEND_PROGRAM_ID    = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const DEFAULT_PUBKEY             = new PublicKey("11111111111111111111111111111111");

// --- PDA helpers ---------------------------------------------------------

function walletPda(strategy) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("wallet"), strategy.toBuffer()],
    STRATEGY_TOKEN_PROGRAM_ID,
  )[0];
}

function userMetadataPda(owner) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_meta"), owner.toBuffer()],
    KAMINO_LEND_PROGRAM_ID,
  )[0];
}

function vanillaObligationPda(owner, lendingMarket) {
  // tag=0 (Vanilla), id=0, seed1=seed2=default pubkey — matches klend-sdk
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

// --- Main ----------------------------------------------------------------

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"))),
  );

  const wallet = walletPda(STRATEGY);
  const userMetadata = userMetadataPda(wallet);
  const obligation = vanillaObligationPda(wallet, LENDING_MARKET);

  console.log(`RPC:             ${RPC_URL}`);
  console.log(`Authority:       ${payer.publicKey.toBase58()}`);
  console.log(`Strategy:        ${STRATEGY.toBase58()}`);
  console.log(`Lending market:  ${LENDING_MARKET.toBase58()}`);
  console.log(`Wallet PDA:      ${wallet.toBase58()}`);
  console.log(`User metadata:   ${userMetadata.toBase58()}`);
  console.log(`Obligation:      ${obligation.toBase58()}`);
  console.log(`Dry run:         ${DRY_RUN}`);
  console.log();

  // Already-initialised check — both PDAs must NOT exist yet.
  const [umInfo, oblInfo] = await Promise.all([
    conn.getAccountInfo(userMetadata),
    conn.getAccountInfo(obligation),
  ]);
  if (umInfo) console.log("⚠ user_metadata already initialised");
  if (oblInfo) console.log("⚠ obligation already initialised");
  if (umInfo || oblInfo) {
    console.log("(init_user_metadata / init_obligation fail atomically if the PDA exists)");
  }
  console.log();

  // Build the strategy-token byte-6 ix.
  // Layout: disc=6, then:
  //   [0] authority           (signer, writable)       — fee payer
  //   [1] strategy            (read)
  //   [2] kamino_program      (read)                   — Beethoven detector
  //   [3] owner (wallet PDA)  (read)                   — signs via seeds inside program
  //   [4] fee_payer           (signer, writable)       — same as authority
  //   [5] user_metadata       (writable)               — to be created
  //   [6] referrer_metadata   (read)                   — kamino_program as placeholder
  //   [7] lending_market      (read)
  //   [8] obligation          (writable)               — to be created
  //   [9] seed1_account       (read)                   — default pubkey
  //  [10] seed2_account       (read)                   — default pubkey
  //  [11] rent sysvar         (read)
  //  [12] system_program      (read)

  const ix = new TransactionInstruction({
    programId: STRATEGY_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey,           isSigner: true,  isWritable: true  },
      { pubkey: STRATEGY,                  isSigner: false, isWritable: false },
      { pubkey: KAMINO_LEND_PROGRAM_ID,    isSigner: false, isWritable: false },
      { pubkey: wallet,                    isSigner: false, isWritable: false },
      { pubkey: payer.publicKey,           isSigner: true,  isWritable: true  },
      { pubkey: userMetadata,              isSigner: false, isWritable: true  },
      { pubkey: KAMINO_LEND_PROGRAM_ID,    isSigner: false, isWritable: false },
      { pubkey: LENDING_MARKET,            isSigner: false, isWritable: false },
      { pubkey: obligation,                isSigner: false, isWritable: true  },
      { pubkey: DEFAULT_PUBKEY,            isSigner: false, isWritable: false },
      { pubkey: DEFAULT_PUBKEY,            isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,        isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
    ],
    data: Buffer.from([6]),
  });

  console.log(`Accounts in tx: ${ix.keys.length}`);

  if (DRY_RUN) {
    const sim = await conn.simulateTransaction(
      (() => { const t = new Transaction().add(ix); t.feePayer = payer.publicKey; return t; })(),
    );
    console.log("── simulateTransaction ──");
    console.log(`  err:  ${JSON.stringify(sim.value.err)}`);
    console.log(`  CUs:  ${sim.value.unitsConsumed}`);
    if (sim.value.logs) {
      console.log("  logs (last 15):");
      sim.value.logs.slice(-15).forEach((l) => console.log(`    ${l}`));
    }
    console.log("\nDry run — set DRY_RUN=0 to send.");
    return;
  }

  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer]);
  console.log(`\n✓ init_position confirmed: ${sig}`);
  console.log(`  https://orbmarkets.io/tx/${sig}?cluster=devnet`);
}

main().catch((e) => {
  console.error("\n✗", e);
  process.exit(1);
});
