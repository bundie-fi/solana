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
import { createRequire } from "node:module";

// `@bundie/zerion-agent` is now a declared workspace dep (see
// packages/backend/package.json). Resolving via require.resolve gives us the
// canonical path regardless of monorepo layout / Railway bundling.
const requireFn = createRequire(import.meta.url);
const ZERION_CLI_PATH = requireFn.resolve("@bundie/zerion-agent/src/cli.js");

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
