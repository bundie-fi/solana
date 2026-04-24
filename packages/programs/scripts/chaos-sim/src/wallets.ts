/**
 * wallets.ts — chaos wallet pool, backed by the Zerion vault.
 *
 * Bundie agents ARE Zerion-managed wallets. Every chaos agent is provisioned
 * via `zerion-bundie agent create` (which calls OWS under the hood); the
 * private key never leaves the vault directory at ~/.ows/wallets/.
 *
 * `setupPool()` shells out to `zerion-bundie agent create` for each role
 * (idempotent — re-running is safe), then queries `agent list` to enumerate
 * them. It returns `ChaosWallet[]` where each entry exposes the role +
 * pubkey + a `signWith` discriminator; callers use that discriminator to
 * pick a signing path:
 *
 *   - signWith === 'zerion-vault'
 *       The agent lives in the Zerion vault. Sign by shelling out to
 *       `zerion-bundie agent sign --name <role> --tx <base64>`.
 *
 *   - signWith === 'file'
 *       Backwards-compat path. The keys/<role>.json file still exists on
 *       disk AND no Zerion vault entry was found for that role. The
 *       in-memory `keypair` is loaded so callers (cli-runner, funding,
 *       sns) can keep working until the operator runs the migration.
 *
 * The fallback exists so the existing chaos pool keeps functioning while
 * an operator runs `zerion-bundie chaos-sim-migrate`. After migration the
 * fallback will not trigger (vault entry takes precedence).
 *
 * --- Hard rules ---
 *  - DENY-by-default: if a vault entry is missing AND no fallback file
 *    exists, throw — never silently call `Keypair.generate()`.
 *  - We never delete keys/<role>.json automatically. The operator deletes
 *    them manually after verifying migration.
 */
import { Keypair } from "@solana/web3.js";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WALLET_COUNT } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");

/**
 * Path to the zerion-bundie CLI entry point. Override via env if you
 * vendor it elsewhere. Defaulting to the monorepo path keeps the chaos-sim
 * usable from `pnpm --filter @bundie/programs chaos:setup` without extra
 * env wiring.
 */
const ZERION_BUNDIE_BIN =
  process.env.ZERION_BUNDIE_BIN ||
  resolve(__dirname, "..", "..", "..", "..", "zerion-agent", "src", "cli.js");

export type SignWith = "zerion-vault" | "file";

export interface ChaosWallet {
  role: string;       // "creator-0", "trader-3", etc.
  pubkeyB58: string;  // cached for logging
  signWith: SignWith;
  /** Only populated when signWith === 'file'. Backwards-compat fallback;
   *  vault-managed wallets must NEVER expose a Keypair to callers. */
  keypair?: Keypair;
}

/** Run `node zerion-bundie ...` and parse stdout as JSON. Throws on
 *  non-zero exit or unparseable output. Stderr is surfaced for diagnostics. */
function runZerionBundie(args: string[]): Record<string, unknown> {
  const res = spawnSync("node", [ZERION_BUNDIE_BIN, ...args], {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(
      `zerion-bundie ${args.join(" ")} failed (exit ${res.status}): ${res.stderr || res.stdout}`,
    );
  }
  const out = res.stdout.trim();
  if (!out) throw new Error(`zerion-bundie ${args.join(" ")} produced no stdout`);
  try {
    return JSON.parse(out);
  } catch (err) {
    throw new Error(
      `zerion-bundie ${args.join(" ")} stdout was not JSON: ${(err as Error).message}\n${out}`,
    );
  }
}

interface VaultAgent {
  role: string;
  pubkey: string;
}

function vaultList(): Map<string, VaultAgent> {
  const out = runZerionBundie(["agent", "list"]) as {
    agents?: Array<{ role: string; pubkey: string }>;
  };
  const map = new Map<string, VaultAgent>();
  for (const a of out.agents || []) map.set(a.role, { role: a.role, pubkey: a.pubkey });
  return map;
}

function vaultCreate(role: string): VaultAgent {
  const out = runZerionBundie(["agent", "create", "--name", role]) as {
    role: string;
    pubkey: string;
  };
  return { role: out.role, pubkey: out.pubkey };
}

function fileFallback(role: string): ChaosWallet | null {
  const path = join(KEYS_DIR, `${role}.json`);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf-8")) as number[];
  const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
  return {
    role,
    pubkeyB58: kp.publicKey.toBase58(),
    signWith: "file",
    keypair: kp,
  };
}

/**
 * Resolve a single role: vault first, file second. Throws DENY-by-default
 * when neither path produces a wallet — never silently calls
 * `Keypair.generate()`.
 */
function resolveRole(role: string, vault: Map<string, VaultAgent>): ChaosWallet {
  const v = vault.get(role);
  if (v) {
    return { role, pubkeyB58: v.pubkey, signWith: "zerion-vault" };
  }
  const f = fileFallback(role);
  if (f) return f;
  throw new Error(
    `No wallet for role "${role}" — not in Zerion vault and no keys/${role}.json fallback. ` +
      `Run \`zerion-bundie agent create --name ${role}\` (or call setupPool() to create the full pool).`,
  );
}

/**
 * Generate (or reuse) the full chaos wallet pool, persisted in the Zerion
 * vault. Idempotent: existing vault entries are returned as-is; missing
 * roles get created. Roles: creator-{0..N-1} + trader-{0..N-1}.
 */
export function setupPool(): ChaosWallet[] {
  const vault = vaultList();
  const wallets: ChaosWallet[] = [];

  const ensure = (role: string) => {
    if (!vault.has(role)) {
      const v = vaultCreate(role);
      vault.set(role, v);
    }
    return resolveRole(role, vault);
  };

  for (let i = 0; i < WALLET_COUNT; i++) wallets.push(ensure(`creator-${i}`));
  for (let i = 0; i < WALLET_COUNT; i++) wallets.push(ensure(`trader-${i}`));
  return wallets;
}

/**
 * Load the existing pool WITHOUT auto-creating missing entries. Use this
 * for read-only operations (doctor, run) where missing entries should
 * surface as errors rather than silently spawn new keys.
 */
export function loadPool(): ChaosWallet[] {
  const vault = vaultList();
  const wallets: ChaosWallet[] = [];
  for (let i = 0; i < WALLET_COUNT; i++) wallets.push(resolveRole(`creator-${i}`, vault));
  for (let i = 0; i < WALLET_COUNT; i++) wallets.push(resolveRole(`trader-${i}`, vault));
  return wallets;
}

/** Print the pool table to stdout. Used by the `setup` subcommand. */
export function printPool(wallets: ChaosWallet[]): void {
  const w = (s: string, n: number) => s.padEnd(n);
  console.log(w("ROLE", 12), w("SIGNED-BY", 14), "PUBKEY");
  console.log("-".repeat(80));
  for (const wlt of wallets) {
    console.log(w(wlt.role, 12), w(wlt.signWith, 14), wlt.pubkeyB58);
  }
}
