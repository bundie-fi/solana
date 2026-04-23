/**
 * cli-runner.ts — invoke @bundie/sol-cli as a child process.
 *
 * Each role in the chaos sim acts through the published CLI rather than
 * reaching into the program directly — that way the harness exercises the
 * same surface a third-party agent (or human) would use.
 *
 * The CLI is prepare-only by default; we always pass `--execute` so it
 * signs + sends. The `--keypair <path>` flag points at the per-role key
 * file we generated.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CLI_BIN, RPC_URL, TX_JITTER_MAX_MS, TX_JITTER_MIN_MS } from "./config.js";
import { ChaosWallet } from "./wallets.js";

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

/**
 * Run a CLI subcommand. The CLI binary is split into argv tokens via
 * naive whitespace split — fine because CLI_BIN is hard-coded in config.ts
 * and never user-supplied.
 */
export async function runCli(
  wallet: ChaosWallet,
  args: string[],
): Promise<CliResult> {
  await jitter();
  const start = Date.now();

  const [cmd, ...preargs] = CLI_BIN.split(/\s+/);
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
  const stdout = res.stdout || "";
  const stderr = res.stderr || "";
  return {
    ok: res.status === 0,
    stdout,
    stderr,
    durationMs: Date.now() - start,
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
