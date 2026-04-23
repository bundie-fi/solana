/**
 * wallets.ts — chaos wallet pool management.
 *
 * `setupPool()` generates fresh keypairs and persists them to ./keys/.
 * Idempotent: if a key file already exists, it's loaded, not overwritten.
 *
 * Each wallet is single-purpose for traceability — creator-0, creator-1,
 * trader-0, etc. The pool is small (5 by default) so we can fund all of
 * them from the deployer's USDC balance without exhausting it.
 */
import { Keypair } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { WALLET_COUNT } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");

export interface ChaosWallet {
  role: string;       // "creator-0", "trader-3", etc.
  keypair: Keypair;
  pubkeyB58: string;  // cached for logging
}

function ensureKeysDir() {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
}

function keyfilePath(role: string): string {
  return join(KEYS_DIR, `${role}.json`);
}

function loadOrGenerate(role: string): Keypair {
  ensureKeysDir();
  const path = keyfilePath(role);
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/**
 * Generate (or load existing) the full chaos wallet pool.
 *
 * Roles: creator-{0..N-1} + trader-{0..N-1}. Creators also act as
 * market-makers (each opens markets on its own strategies).
 */
export function setupPool(): ChaosWallet[] {
  const wallets: ChaosWallet[] = [];
  for (let i = 0; i < WALLET_COUNT; i++) {
    const role = `creator-${i}`;
    const kp = loadOrGenerate(role);
    wallets.push({ role, keypair: kp, pubkeyB58: kp.publicKey.toBase58() });
  }
  for (let i = 0; i < WALLET_COUNT; i++) {
    const role = `trader-${i}`;
    const kp = loadOrGenerate(role);
    wallets.push({ role, keypair: kp, pubkeyB58: kp.publicKey.toBase58() });
  }
  return wallets;
}

export function loadPool(): ChaosWallet[] {
  // Same as setupPool — both load existing or generate fresh.
  return setupPool();
}

/** Print the pool table to stdout. Used by the `setup` subcommand. */
export function printPool(wallets: ChaosWallet[]): void {
  const w = (s: string, n: number) => s.padEnd(n);
  console.log(w("ROLE", 12), "PUBKEY");
  console.log("-".repeat(60));
  for (const wlt of wallets) {
    console.log(w(wlt.role, 12), wlt.pubkeyB58);
  }
}
