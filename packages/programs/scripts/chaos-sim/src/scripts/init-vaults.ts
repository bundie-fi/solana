#!/usr/bin/env -S tsx
/**
 * init-vaults.ts — one-time bootstrap that initialises a `BundieVault`
 * PDA for each of the three hardcoded agent identities (alice / bob /
 * charlie) on devnet.
 *
 * Idempotent: if the vault PDA already exists on devnet, the script
 * skips it. Safe to re-run as part of a redeploy checklist.
 *
 * Usage:
 *   pnpm --filter @bundie/programs init-vaults
 *
 * Each new vault is seeded at `initial_nav = 1_000_000` (= $1.00 in
 * bUSD base units). That is the hackathon-scale starter — the daemon
 * will commit a real NAV next tick via `commit_nav`, monotonically
 * incrementing `nav_epoch` from 0.
 *
 * Signing: agent keypairs are loaded from `chaos-sim/keys/<agent>-vault.json`
 * (the same files that `run-agent-daemon.ts` uses). If those files are
 * missing the script fails fast — operator must create them via
 * `solana-keygen new` (or migrate to the Zerion vault path) before
 * re-running.
 */

import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { config as loadDotEnv } from "dotenv";

import {
  PREDICTION_MARKET_PROGRAM_ID,
  bundieVaultPda,
} from "../actions/create-nav-market.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAOS_DIR = join(__dirname, "..", "..");

loadDotEnv({ path: join(CHAOS_DIR, ".env") });

// ─── Helpers ──────────────────────────────────────────────────────────────

function anchorDiscriminator(fnName: string): Buffer {
  return createHash("sha256")
    .update(`global:${fnName}`)
    .digest()
    .subarray(0, 8);
}

function u64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

interface AgentEntry {
  name: string;
  keyfile: string; // relative to CHAOS_DIR
}

// Mirror the AGENTS map in run-agent-daemon.ts. Keep this list in sync if
// new agents are added.
const AGENTS: AgentEntry[] = [
  { name: "alice.bundie", keyfile: "keys/alice-vault.json" },
  { name: "bob.bundie", keyfile: "keys/bob-vault.json" },
  { name: "charlie.bundie", keyfile: "keys/charlie-vault.json" },
];

const INITIAL_NAV_LAMPORTS = 1_000_000n; // $1.00 in bUSD base units (6 dp)

// ─── Main ─────────────────────────────────────────────────────────────────

async function initVaultIfMissing(
  conn: Connection,
  kp: Keypair,
): Promise<{ status: "skipped" | "created"; vaultPda: string; txSig?: string }> {
  const vaultPda = bundieVaultPda(kp.publicKey);

  const info = await conn.getAccountInfo(vaultPda, "confirmed");
  if (info) {
    return { status: "skipped", vaultPda: vaultPda.toBase58() };
  }

  const data = Buffer.concat([
    anchorDiscriminator("init_vault"),
    u64LE(INITIAL_NAV_LAMPORTS),
  ]);

  const keys = [
    { pubkey: kp.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = kp.publicKey;

  const txSig = await sendAndConfirmTransaction(conn, tx, [kp], {
    commitment: "confirmed",
  });

  return { status: "created", vaultPda: vaultPda.toBase58(), txSig };
}

async function main(): Promise<void> {
  const devnetUrl =
    process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
  const conn = new Connection(devnetUrl, "confirmed");

  console.log("=== Bundie init-vaults bootstrap ===");
  console.log(`devnet RPC:   ${devnetUrl}`);
  console.log(`program:      ${PREDICTION_MARKET_PROGRAM_ID.toBase58()}`);
  console.log(`initial NAV:  ${INITIAL_NAV_LAMPORTS} lamports ($1.00 bUSD)`);
  console.log("");

  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const agent of AGENTS) {
    const keyPath = join(CHAOS_DIR, agent.keyfile);
    if (!existsSync(keyPath)) {
      console.error(
        `[${agent.name}] FAILED: missing keypair ${keyPath}\n` +
          `  Run \`solana-keygen new --outfile ${keyPath}\` (or migrate to ` +
          `the Zerion vault path) before re-running.`,
      );
      failedCount++;
      continue;
    }

    let kp: Keypair;
    try {
      kp = loadKeypair(keyPath);
    } catch (err) {
      console.error(
        `[${agent.name}] FAILED: could not parse keypair: ${(err as Error).message}`,
      );
      failedCount++;
      continue;
    }

    const expectedVaultPda = bundieVaultPda(kp.publicKey).toBase58();
    console.log(
      `[${agent.name}] authority=${kp.publicKey.toBase58()} vault=${expectedVaultPda}`,
    );

    try {
      const res = await initVaultIfMissing(conn, kp);
      if (res.status === "skipped") {
        console.log(`  → already initialised, skipping`);
        skippedCount++;
      } else {
        console.log(`  → created (tx ${res.txSig})`);
        createdCount++;
      }
    } catch (err) {
      const e = err as Error;
      console.error(`  → FAILED: ${e.message}`);
      failedCount++;
    }
  }

  console.log("");
  console.log(
    `=== summary: ${createdCount} created, ${skippedCount} skipped, ${failedCount} failed ===`,
  );

  // Surface failure to CI so a missing keypair turns into a non-zero exit.
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[init-vaults] fatal:", (err as Error).stack || err);
  process.exit(1);
});
