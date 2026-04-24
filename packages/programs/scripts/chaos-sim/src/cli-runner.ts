/**
 * cli-runner.ts — invoke @bundie/sol-cli as a child process.
 *
 * Each role in the chaos sim acts through the published CLI rather than
 * reaching into the program directly — that way the harness exercises the
 * same surface a third-party agent (or human) would use.
 *
 * --- Two signing paths (chosen per-wallet) ---
 *
 * 1. signWith === 'file' (legacy fallback)
 *    - Bundie-sol is invoked with `--keypair <path>` AND `--execute`.
 *    - Bundie-sol signs + submits in one shot.
 *    - Kept for backwards-compat until all wallets are migrated to the vault.
 *
 * 2. signWith === 'zerion-vault'
 *    - Bundie-sol is invoked WITHOUT `--execute` (prepare-only). It emits a
 *      `PreparedTx` JSON envelope with `tx` = base64 of the serialized,
 *      blockhash-set, partial-signed tx.
 *    - We pass that base64 to `zerion-bundie agent sign --name <role>
 *      --tx <b64>` which shells out to OWS; Zerion's vault writes the
 *      agent's positional signature and returns the fully-signed tx.
 *    - We broadcast with a plain `connection.sendRawTransaction` —
 *      bundie-sol never touches the key material.
 *
 * This matches option (b) in the task spec: Zerion-mediated signing happens
 * OUTSIDE bundie-sol's --execute path, so bundie-sol stays unchanged.
 */
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CLI_BIN, RPC_URL, TX_JITTER_MAX_MS, TX_JITTER_MIN_MS } from "./config.js";
import { ChaosWallet } from "./wallets.js";
import { signWithVault } from "./vault-signer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");

export interface CliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function jitter(): Promise<void> {
  const ms =
    TX_JITTER_MIN_MS + Math.random() * (TX_JITTER_MAX_MS - TX_JITTER_MIN_MS);
  return new Promise((r) => setTimeout(r, ms));
}

function splitCliBin(): string[] {
  // CLI_BIN is hard-coded in config.ts and never user-supplied — naive
  // whitespace split is safe.
  return CLI_BIN.split(/\s+/);
}

/**
 * File-fallback path: bundie-sol signs + submits with the on-disk keypair.
 */
function runWithFile(wallet: ChaosWallet, args: string[]): {
  ok: boolean;
  stdout: string;
  stderr: string;
  start: number;
} {
  const start = Date.now();
  const [cmd, ...preargs] = splitCliBin();
  const full = [
    ...preargs,
    ...args,
    "--rpc",
    RPC_URL,
    "--keypair",
    join(KEYS_DIR, `${wallet.role}.json`),
    "--execute",
  ];
  const res = spawnSync(cmd, full, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: res.status === 0,
    stdout: typeof res.stdout === "string" ? res.stdout : "",
    stderr: typeof res.stderr === "string" ? res.stderr : "",
    start,
  };
}

/**
 * Vault-managed path: bundie-sol builds the PreparedTx; we sign with Zerion
 * and broadcast ourselves. Returns a CliResult that preserves bundie-sol's
 * stdout (so downstream parsers like extractStrategyAddress still work)
 * with the signature injected under `txSignature`.
 */
async function runWithVault(
  wallet: ChaosWallet,
  args: string[],
): Promise<{ stdout: string; stderr: string; ok: boolean; durationMs: number }> {
  const start = Date.now();
  const [cmd, ...preargs] = splitCliBin();
  // Prepare-only (no --execute). We pass a --payer hint so bundie-sol knows
  // whose signature to reserve — it writes `feePayer` into the tx buffer.
  // If the CLI lacks `--payer` for a given subcommand, it defaults to the
  // keypair of the currently configured wallet; we pass --keypair too so
  // the pubkey is readable from disk even though we don't sign with it.
  //
  // We DO NOT pass --execute. We DO pass --keypair because bundie-sol uses
  // it purely as the payer pubkey source in prepare mode — it never touches
  // the secret bytes when --execute is absent. (See CLI README: prepare
  // mode only reads `publicKey` from the keypair file.) For vault-managed
  // wallets we still need a file on disk to satisfy this; we write a
  // pubkey-only placeholder via writePubkeyOnlyFile below.
  const keyfile = pubkeyOnlyFile(wallet);
  const full = [
    ...preargs,
    ...args,
    "--rpc",
    RPC_URL,
    "--keypair",
    keyfile,
  ];
  const built = spawnSync(cmd, full, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (built.status !== 0) {
    return {
      ok: false,
      stdout: built.stdout || "",
      stderr: built.stderr || "",
      durationMs: Date.now() - start,
    };
  }
  // Parse the PreparedTx envelope. bundie-sol prints JSON when --execute is
  // absent; find the first `{`.
  const envelope = tryParseJson(built.stdout);
  if (!envelope || typeof envelope.tx !== "string") {
    return {
      ok: false,
      stdout: built.stdout || "",
      stderr:
        (built.stderr || "") +
        "\nvault-runner: bundie-sol did not emit a PreparedTx envelope (missing `tx`).",
      durationMs: Date.now() - start,
    };
  }
  try {
    const signedB64 = signWithVault(wallet.role, envelope.tx as string);
    const conn = new Connection(RPC_URL, "confirmed");
    const raw = Buffer.from(signedB64, "base64");
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
    // Confirm with bundie-sol's blockhash-height if present.
    if (typeof envelope.blockhash === "string" && typeof envelope.lastValidBlockHeight === "number") {
      await conn.confirmTransaction(
        {
          signature: sig,
          blockhash: envelope.blockhash as string,
          lastValidBlockHeight: envelope.lastValidBlockHeight as number,
        },
        "confirmed",
      );
    }
    // Emit a CLI-compatible JSON envelope so extractSignature / extractStrategyAddress
    // keep working. We merge bundie-sol's metadata (strategyAddress, marketAddress,
    // etc.) with our freshly-minted signature.
    const merged = {
      ...(envelope.metadata as Record<string, unknown> || {}),
      txSignature: sig,
      signedBy: "zerion-vault",
      role: wallet.role,
    };
    return {
      ok: true,
      stdout: JSON.stringify(merged),
      stderr: built.stderr || "",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: built.stdout || "",
      stderr:
        (built.stderr || "") + `\nvault-runner: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * bundie-sol's prepare mode reads the payer pubkey from a keypair file
 * (it never signs in prepare mode). For vault-managed wallets we can't
 * hand it the secret — so we write a `pubkey-only` placeholder file that
 * masquerades as a 64-byte secret-key array with the first 32 bytes zeroed
 * (the public half is what bundie-sol reads). We write this once per role
 * under keys/.vault-<role>.json (not committed; the keys dir gitignores *).
 *
 * SECURITY: the placeholder bytes are NOT a real secret — they're zeros in
 * the secret half and the real public bytes in the public half. Nothing in
 * the file can sign anything.
 *
 * Actually simpler: bundie-sol accepts a plain pubkey file too? We keep
 * the full-array shape because that's the format the CLI parses by
 * default. The zero-secret approach is safe because we never pass
 * --execute so bundie-sol never attempts a real signature.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
function pubkeyOnlyFile(wallet: ChaosWallet): string {
  const dir = join(KEYS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // If the real keypair file exists on disk (pre-migration fallback), use
  // it — bundie-sol still won't sign since we omit --execute, and this
  // avoids writing extra placeholder files.
  const real = join(dir, `${wallet.role}.json`);
  if (existsSync(real)) return real;
  const placeholder = join(dir, `.vault-${wallet.role}.json`);
  if (!existsSync(placeholder)) {
    const pub = new PublicKey(wallet.pubkeyB58).toBytes();
    const fake64 = new Uint8Array(64);
    fake64.set(pub, 32); // secret=zeros, public half = real pubkey bytes
    writeFileSync(placeholder, JSON.stringify(Array.from(fake64)));
  }
  return placeholder;
}

/**
 * Run a CLI subcommand. Dispatches to the file-backed or vault-backed
 * path based on `wallet.signWith`.
 */
export async function runCli(
  wallet: ChaosWallet,
  args: string[],
): Promise<CliResult> {
  await jitter();
  if (wallet.signWith === "zerion-vault") {
    return runWithVault(wallet, args);
  }
  const r = runWithFile(wallet, args);
  return {
    ok: r.ok,
    stdout: r.stdout,
    stderr: r.stderr,
    durationMs: Date.now() - r.start,
  };
}

/**
 * The CLI emits JSON envelopes when --execute succeeds. We try JSON parse
 * first, fall back to regex for any pre-execute summary lines.
 */
function tryParseJson(stdout: string): Record<string, unknown> | null {
  // Find the FIRST `{` and try to parse from there to the end.
  const idx = stdout.indexOf("{");
  if (idx === -1) return null;
  try {
    return JSON.parse(stdout.slice(idx));
  } catch {
    return null;
  }
}

export function extractSignature(stdout: string): string | null {
  const json = tryParseJson(stdout);
  if (json) {
    for (const k of ["createSignature", "depositSignature", "signature", "txSignature", "tx"]) {
      const v = json[k];
      if (typeof v === "string" && v.length >= 40) return v;
    }
  }
  const m =
    stdout.match(/Signature:\s+([A-Za-z0-9]{40,90})/) ||
    stdout.match(/tx\s+([A-Za-z0-9]{40,90})/) ||
    stdout.match(/sent\s+([A-Za-z0-9]{40,90})/i);
  return m ? m[1] : null;
}

export function extractStrategyAddress(stdout: string): string | null {
  const json = tryParseJson(stdout);
  if (json && typeof json.strategyAddress === "string") return json.strategyAddress;
  const m =
    stdout.match(/[Ss]trategy(?:Address|\s+address)?\s*[:=]?\s*([1-9A-HJ-NP-Za-km-z]{32,44})/) ||
    stdout.match(/created\s+strategy\s+([1-9A-HJ-NP-Za-km-z]{32,44})/i);
  return m ? m[1] : null;
}

export function extractMarketAddress(stdout: string): string | null {
  const json = tryParseJson(stdout);
  if (json && typeof json.marketAddress === "string") return json.marketAddress;
  const m =
    stdout.match(/[Mm]arket(?:Address|\s+address)?\s*[:=]?\s*([1-9A-HJ-NP-Za-km-z]{32,44})/) ||
    stdout.match(/opened\s+market\s+([1-9A-HJ-NP-Za-km-z]{32,44})/i);
  return m ? m[1] : null;
}

// VersionedTransaction import is kept for future use if bundie-sol starts
// emitting v0 tx envelopes; current bundie-sol emits legacy Transaction
// (see packages/bundie-fi/cli/solana/src/prepare.ts which calls
// `tx.serialize()` from a legacy Transaction).
void VersionedTransaction;
void Transaction;
