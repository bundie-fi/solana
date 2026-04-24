/**
 * cli-runner.ts — invoke @bundie/sol-cli as a child process.
 *
 * Each role in the chaos sim acts through the published CLI rather than
 * reaching into the program directly — that way the harness exercises the
 * same surface a third-party agent (or human) would use.
 *
 * --- Two execution paths (chosen per-wallet) ---
 *
 * 1. signWith === 'file' (legacy fallback)
 *    - Bundie-sol is invoked with `--keypair <path>` AND `--execute`.
 *    - Bundie-sol signs + submits in one shot.
 *    - Kept for backwards-compat until all wallets are migrated to the vault.
 *
 * 2. signWith === 'zerion-vault'  (the canonical path for Bundie agents)
 *    - Bundie-sol is invoked WITHOUT `--execute` (prepare-only). It emits a
 *      `PreparedTx` JSON envelope with `tx` = base64 of the serialized,
 *      blockhash-set, partial-signed tx.
 *    - We hand that base64 to `zerion-bundie agent execute --name <role>
 *      --action <kind> --tx <b64> --notional-usd <n>`. The Zerion CLI:
 *        a. Runs the DENY-by-default policy framework (chain_lock,
 *           spend_limit, expiry — plus asset_whitelist + nav_divergence
 *           for swap-style actions).
 *        b. Signs via the OWS vault (~/.ows/wallets/<role>).
 *        c. Broadcasts via the configured RPC + confirms.
 *        d. Appends to the in-vault action log.
 *    - Bundie-sol never sees the key material; the chaos harness never
 *      sees the signature primitives. Every agent op flows through the
 *      Zerion-managed funnel.
 *
 * This matches the task: agent COMPOSE (create-strategy) and CREATE-MARKET
 * operations both run through Zerion. The human web-app flow uses the
 * standard wallet-adapter path (no Zerion in the loop).
 */
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CLI_BIN, RPC_URL, TX_JITTER_MAX_MS, TX_JITTER_MIN_MS } from "./config.js";
import { ChaosWallet } from "./wallets.js";
// Note: `signWithVault` (vault-signer.ts) is now used ONLY by sns.ts —
// .bundie subdomain registration needs a special two-signer dance
// (root_owner + payer) that sits outside the agent-execute funnel.
// Every other agent action flows through `zerion-bundie agent execute`.

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");

const ZERION_BUNDIE_BIN =
  process.env.ZERION_BUNDIE_BIN ||
  resolve(__dirname, "..", "..", "..", "..", "zerion-agent", "src", "cli.js");

export interface CliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Map the chaos-sim's bundie-sol subcommand to the Zerion `--action` label
 * the policy framework picks bundles for. Unknown subcommands fall back
 * to "other" which gets the conservative 3-policy bundle (chain_lock +
 * spend_limit + expiry).
 *
 * Notional defaults are sane devnet placeholders — well under the
 * spend_limit caps so the chaos sim doesn't hit them. Production
 * integrations should compute notional from the actual ix payload.
 */
function actionFromArgs(args: string[]): { action: string; notionalUsd: number } {
  const sub = args[0] ?? "other";
  switch (sub) {
    case "create-strategy":
      return { action: "create-strategy", notionalUsd: 0.5 };
    case "create-market":
      return { action: "create-market", notionalUsd: 0.5 };
    case "rebalance":
      return { action: "rebalance", notionalUsd: 0.1 };
    case "predict":
    case "trade":
      return { action: "predict", notionalUsd: 0.1 };
    case "redeem":
      return { action: "redeem", notionalUsd: 0.1 };
    default:
      return { action: sub, notionalUsd: 0.1 };
  }
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
 * Vault-managed path: bundie-sol builds the PreparedTx; we hand it to
 * `zerion-bundie agent execute` which runs the policy framework, signs
 * via OWS, broadcasts, confirms, and records. Returns a CliResult that
 * preserves bundie-sol's metadata (so downstream parsers like
 * extractStrategyAddress keep working) with the signature injected under
 * `txSignature` and `signedBy: "zerion-execute"`.
 *
 * On policy DENY, the Zerion CLI exits non-zero with the deny reason in
 * stderr — we surface that as a CliResult failure so the chaos recorder
 * marks the event with the policy that blocked it.
 */
async function runWithVault(
  wallet: ChaosWallet,
  args: string[],
): Promise<{ stdout: string; stderr: string; ok: boolean; durationMs: number }> {
  const start = Date.now();
  const [cmd, ...preargs] = splitCliBin();
  // Prepare-only (no --execute). bundie-sol reads --keypair only for the
  // pubkey in prepare mode — never touches the secret bytes. For
  // vault-managed wallets we hand it a pubkey-only placeholder file.
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

  // Hand off to `zerion-bundie agent execute`. The Zerion CLI does
  // policy → sign → broadcast → confirm → record. We never call
  // sendRawTransaction ourselves anymore — every Bundie-agent action
  // flows through the single Zerion-mediated funnel.
  //
  // ZERION_BUNDIE_STATE is pinned so every chaos invocation writes its
  // action log to the same file under chaos-sim/logs/, regardless of
  // which cwd pnpm runs from. Audit trail then survives a chaos run for
  // post-hoc analysis.
  const { action, notionalUsd } = actionFromArgs(args);
  const execRes = spawnSync(
    "node",
    [
      ZERION_BUNDIE_BIN,
      "agent",
      "execute",
      "--name", wallet.role,
      "--action", action,
      "--tx", envelope.tx as string,
      "--notional-usd", String(notionalUsd),
      "--rpc", RPC_URL,
    ],
    {
      encoding: "utf-8",
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        ZERION_BUNDIE_STATE: process.env.ZERION_BUNDIE_STATE ||
          join(__dirname, "..", "logs", "zerion-action-log.json"),
      },
    },
  );

  if (execRes.status !== 0) {
    // `agent execute` writes structured-error JSON to stderr on policy
    // DENY or sign/broadcast failure. Pass through unchanged so the
    // chaos recorder logs the deny reason.
    return {
      ok: false,
      stdout: execRes.stdout || "",
      stderr:
        (built.stderr || "") +
        (execRes.stderr || execRes.stdout || "agent execute failed without output"),
      durationMs: Date.now() - start,
    };
  }

  let execJson: { ok?: boolean; signature?: string };
  try {
    execJson = JSON.parse(execRes.stdout.trim());
  } catch (err) {
    return {
      ok: false,
      stdout: execRes.stdout || "",
      stderr:
        (built.stderr || "") +
        `\nvault-runner: agent execute stdout was not JSON: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
  }
  if (!execJson.ok || typeof execJson.signature !== "string") {
    return {
      ok: false,
      stdout: execRes.stdout || "",
      stderr:
        (built.stderr || "") +
        `\nvault-runner: agent execute returned unexpected payload: ${execRes.stdout}`,
      durationMs: Date.now() - start,
    };
  }

  // Merge bundie-sol's metadata (strategyAddress, marketAddress, etc.)
  // with the freshly-confirmed signature so extractSignature /
  // extractStrategyAddress keep working downstream.
  const merged = {
    ...(envelope.metadata as Record<string, unknown> || {}),
    txSignature: execJson.signature,
    signedBy: "zerion-execute",
    role: wallet.role,
    action,
  };
  return {
    ok: true,
    stdout: JSON.stringify(merged),
    stderr: built.stderr || "",
    durationMs: Date.now() - start,
  };
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
