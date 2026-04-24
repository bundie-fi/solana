/**
 * zerion-swap.ts — shell-out wrapper for the forked Zerion CLI.
 *
 * Bounty requires: "all swaps route through Zerion API". The canonical
 * agent-side way to do that in this monorepo is to invoke
 *   node packages/zerion-agent/cli/zerion.js swap <from> <to> <amount> \
 *     --chain <chain> --wallet <ows-wallet-name>
 *
 * The CLI itself handles:
 *   - OWS wallet resolution (reads ~/.ows/wallets/<name>)
 *   - Zerion API request signing with ZERION_API_KEY
 *   - quote + execute + tx confirmation
 *
 * Env expected:
 *   ZERION_API_KEY       — required; otherwise CLI errors cleanly
 *   ZERION_AGENT_TOKEN   — optional; CLI will prompt or error if missing
 *
 * This wrapper is deliberately thin: we capture stdout/stderr and let
 * callers decide what to do with non-zero exits. The daemon treats a CLI
 * failure as an `execute_error` and continues to the next action so one
 * flaky swap doesn't kill the whole tick.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Default CLI path resolves relative to the repo root. The daemon is run
 * via `pnpm --filter @bundie/programs` so cwd is the programs package root —
 * we walk up three levels to the repo root, then into packages/zerion-agent.
 */
const DEFAULT_CLI_PATH = resolve(
  process.cwd(),
  "..", // packages/programs → packages
  "zerion-agent",
  "cli",
  "zerion.js",
);

export interface SwapArgs {
  fromToken: string;
  toToken: string;
  /** UI amount, e.g. "0.05" */
  amount: string;
  /** "solana" for us */
  chain: string;
  /** OWS wallet name — e.g. "bundie/alice" (matches how the vault is provisioned). */
  walletName: string;
  /** Override the CLI path if you've moved it; defaults to monorepo path. */
  cliPath?: string;
  /** Forward extra flags to the underlying CLI call if needed. */
  extraFlags?: string[];
}

export interface SwapResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Parsed tx hash from the CLI output when we can pull it; undefined otherwise. */
  txHash?: string;
}

function parseTxHash(stdout: string): string | undefined {
  // The CLI emits structured JSON when --json is used; otherwise pretty text.
  // Try a JSON parse first.
  try {
    const json = JSON.parse(stdout);
    if (json?.tx?.hash) return String(json.tx.hash);
  } catch {
    // Not JSON — grep common patterns.
  }
  const m = stdout.match(/tx[^A-Za-z0-9]*hash[^A-Za-z0-9]*([A-Za-z0-9]{20,})/i);
  return m?.[1];
}

/**
 * Run `zerion swap` via child_process.spawnSync. Returns { ok, stdout, stderr }.
 * Does NOT throw — callers branch on `ok`.
 *
 * NOTE: Requires ZERION_API_KEY to be set in the environment the daemon
 * inherits. This is documented in the .env loading path in
 * run-agent-daemon.ts.
 */
export function executeZerionSwap(args: SwapArgs): SwapResult {
  const cliPath = args.cliPath ?? DEFAULT_CLI_PATH;
  const argv = [
    cliPath,
    "swap",
    args.fromToken,
    args.toToken,
    args.amount,
    "--chain",
    args.chain,
    "--wallet",
    args.walletName,
    "--json",
    ...(args.extraFlags ?? []),
  ];

  const res = spawnSync("node", argv, {
    env: { ...process.env },
    encoding: "utf8",
    timeout: 60_000,
  });

  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  const exitCode = res.status;
  const ok = exitCode === 0;
  return {
    ok,
    stdout,
    stderr,
    exitCode,
    txHash: ok ? parseTxHash(stdout) : undefined,
  };
}
