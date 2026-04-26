/**
 * Thin wrapper around the @bundie/zerion-agent CLI's `agent` subcommands.
 *
 * The CLI owns the OWS-vault provisioning + the policy-gated execute funnel.
 * We shell out (rather than importing the JS modules directly) because the
 * vault primitives mutate ~/.ows/wallets and we want one process per
 * provisioning to keep the OWS lock semantics clean.
 *
 * Both helpers expect the CLI to print a single JSON document on stdout.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

// ESM-friendly __dirname.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveCliPath(): string {
  // 1. Default monorepo layout: packages/backend/src/lib/ → ../../../zerion-agent/src/cli.js
  const rel = resolve(__dirname, "../../../zerion-agent/src/cli.js");
  if (existsSync(rel)) return rel;
  // 2. Fallback to require.resolve (only viable if zerion-agent is a real
  //    dependency — currently it's a workspace package referenced by path,
  //    so this is mostly defensive for prod bundling).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require("node:module");
    const requireFn = createRequire(import.meta.url);
    return requireFn.resolve("@bundie/zerion-agent/src/cli.js");
  } catch {
    // Last resort — return the relative path even if it doesn't exist so the
    // caller's spawn error is descriptive.
    return rel;
  }
}

const ZERION_CLI_PATH = resolveCliPath();

export interface ZerionAgentCreateResult {
  ok: boolean;
  pubkey: string;
  vaultName: string;
  role?: string;
  mirrored?: boolean;
  mirrorPath?: string;
}

/**
 * Provision a Bundie agent in the Zerion vault.
 *
 * When `mirrorKeypairPath` is provided, the CLI generates the keypair itself
 * (rather than letting OWS derive one from a fresh mnemonic) and writes the
 * 64-byte secret key to that path as a JSON byte array — matching the format
 * the chaos-sim daemon expects in `packages/programs/scripts/chaos-sim/keys/`.
 *
 * SECURITY-REGRESSION: this means the secret lives in two places (OWS vault
 * + plaintext file). Acceptable for hackathon / devnet automation only.
 */
export function zerionAgentCreate(
  name: string,
  mirrorKeypairPath?: string,
): ZerionAgentCreateResult {
  const args = [ZERION_CLI_PATH, "agent", "create", "--name", name];
  if (mirrorKeypairPath) {
    args.push("--mirror-keypair", mirrorKeypairPath);
  }
  const res = spawnSync("node", args, { encoding: "utf8", timeout: 30_000 });
  if (res.status !== 0) {
    throw new Error(
      `zerion agent create failed (status=${res.status}): ${res.stderr || res.stdout}`,
    );
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`zerion agent create returned invalid JSON: ${res.stdout}`);
  }
}

export interface ZerionAgentExecuteResult {
  ok?: boolean;
  signature?: string;
  decisions?: unknown[];
  durationMs?: number;
  deniedBy?: string;
}

export function zerionAgentExecute(opts: {
  name: string;
  txB64: string;
  action: string;
  notionalUsd: number;
  rpcUrl: string;
}): ZerionAgentExecuteResult {
  const res = spawnSync(
    "node",
    [
      ZERION_CLI_PATH,
      "agent",
      "execute",
      "--name",
      opts.name,
      "--tx",
      opts.txB64,
      "--action",
      opts.action,
      "--notional-usd",
      String(opts.notionalUsd),
      "--rpc",
      opts.rpcUrl,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  if (res.status !== 0) {
    throw new Error(
      `zerion agent execute failed (status=${res.status}): ${res.stderr || res.stdout}`,
    );
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`zerion agent execute returned invalid JSON: ${res.stdout}`);
  }
}

/** Exposed for tests / diagnostics. */
export const __zerionCliPath = ZERION_CLI_PATH;
