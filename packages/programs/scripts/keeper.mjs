#!/usr/bin/env node
/**
 * keeper.mjs — snapshot_positions keeper.
 *
 * For every Strategy account on devnet, call strategy-token's
 * snapshot_positions instruction (discriminator 5) so the
 * PositionSnapshots PDA gets a fresh 24h composition record.
 *
 * Expected to run on a Railway cron every ~24h. On-chain the program
 * enforces MIN_SNAPSHOT_INTERVAL_SLOTS (≈216,000 slots ≈ 24h); calling
 * more often than that reverts with ERROR_SNAPSHOT_TOO_SOON, which we
 * catch and treat as non-fatal (the cron just ran too early).
 *
 * This is a Mode 2 autonomous agent in the v5 archetype taxonomy —
 * permissionless keeper, no human prompt per run.
 *
 * Usage:
 *   node packages/programs/scripts/keeper.mjs
 *
 * Env:
 *   RPC_URL  (default: https://api.devnet.solana.com)
 *   KEEPER_KEYPAIR  (default: ~/.config/solana/id.json)
 *   DRY_RUN  (default: 0; set to 1 to list strategies without sending tx)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STRATEGY_TOKEN_PROGRAM_ID = new PublicKey(
  "Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm"
);

/** Strategy account discriminator — match state/strategy.rs */
const STRATEGY_DISCRIMINATOR = Buffer.from([
  0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11,
]);

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEEPER_KEYPAIR_PATH =
  process.env.KEEPER_KEYPAIR || join(homedir(), ".config/solana/id.json");
const DRY_RUN = process.env.DRY_RUN === "1";

function loadKeypair(path) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))
  );
}

function positionSnapshotsPda(strategy) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position_snapshots"), strategy.toBuffer()],
    STRATEGY_TOKEN_PROGRAM_ID
  )[0];
}

function buildSnapshotIx({ keeper, strategy }) {
  const snapshots = positionSnapshotsPda(strategy);
  return new TransactionInstruction({
    programId: STRATEGY_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: keeper,                  isSigner: true,  isWritable: true  },
      { pubkey: strategy,                isSigner: false, isWritable: false },
      { pubkey: snapshots,               isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([5]), // pinocchio instruction discriminator
  });
}

async function listStrategies(connection) {
  const accounts = await connection.getProgramAccounts(
    STRATEGY_TOKEN_PROGRAM_ID,
    {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: bs58.encode(STRATEGY_DISCRIMINATOR),
          },
        },
      ],
      dataSlice: { offset: 200, length: 32 }, // 32-byte name field for logging
    }
  );
  return accounts.map(({ pubkey, account }) => {
    const rawName = Buffer.from(account.data);
    const nullIdx = rawName.indexOf(0);
    const name = rawName
      .subarray(0, nullIdx === -1 ? 32 : nullIdx)
      .toString("utf8");
    return { pubkey, name };
  });
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const keeper = loadKeypair(KEEPER_KEYPAIR_PATH);

  console.log(`Keeper:       ${keeper.publicKey.toBase58()}`);
  console.log(`RPC:          ${RPC_URL}`);
  console.log(`Dry run:      ${DRY_RUN}`);
  console.log();

  const strategies = await listStrategies(connection);
  console.log(`Found ${strategies.length} strategies on-chain.`);
  console.log();

  if (strategies.length === 0) return;

  let snapshotted = 0;
  let tooSoon = 0;
  let errored = 0;

  for (const { pubkey, name } of strategies) {
    const label = `${pubkey.toBase58()} (${name || "<unnamed>"})`;

    if (DRY_RUN) {
      console.log(`  [dry-run] would snapshot: ${label}`);
      continue;
    }

    try {
      const ix = buildSnapshotIx({ keeper: keeper.publicKey, strategy: pubkey });
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [keeper]);
      console.log(`  ✓ snapshot ${label}  tx=${sig.slice(0, 12)}…`);
      snapshotted++;
    } catch (e) {
      const msg = (e && e.message) || String(e);
      // ERROR_SNAPSHOT_TOO_SOON = 0x17700005 = decimal 393_216_005
      if (msg.includes("0x17700005") || msg.includes("393216005") || msg.includes("SNAPSHOT_TOO_SOON")) {
        console.log(`  ·  ${label} — too soon (24h interval not met)`);
        tooSoon++;
      } else {
        console.error(`  ✗ ${label} — ${msg}`);
        errored++;
      }
    }
  }

  console.log();
  console.log(`Summary: ${snapshotted} snapshotted · ${tooSoon} too-soon · ${errored} errored`);
  if (errored > 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
