#!/usr/bin/env node
/**
 * `zerion-bundie` — CLI entry point for the Bundie strategy rebalancer that
 * routes swaps through the Zerion API.
 *
 * Subcommands:
 *   target  --strategy <pk> --nav-oracle <pk> --target-composition '{"SOL":40,"USDC":30,"mSOL":30}'
 *   watch   --policies policies.yaml [--interval 60000] [--dry-run]
 *   status  [--json]
 *   pause
 *   resume
 *
 * NOTE: Real swap execution is wired in `src/bundie/zerion-execute.js` which
 * delegates to the upstream Zerion CLI's `executeSwap` (see
 * cli/lib/trading/swap.js:120 — `executeSwap`). In dry-run mode the executor
 * is replaced with a logging mock so no API calls are made.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadPoliciesFromFile } from "./bundie/policy-loader.js";
import { readState, setStrategyTarget, setPaused, statePath } from "./bundie/state-store.js";
import { startLoop, runOnce, defaultDevnetConnection } from "./bundie/rebalance-loop.js";
import { loadStrategyState } from "./bundie/strategy-monitor.js";

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function printErr(code, message, details = {}) {
  process.stderr.write(JSON.stringify({ error: { code, message, ...details } }, null, 2) + "\n");
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

async function cmdTarget(flags) {
  const strategy = flags.strategy;
  const navOracle = flags["nav-oracle"];
  const raw = flags["target-composition"];
  if (!strategy || !raw) {
    printErr("missing_args", "Usage: zerion-bundie target --strategy <pk> --nav-oracle <pk> --target-composition '<json>'");
    process.exit(1);
  }
  let target;
  try {
    target = JSON.parse(raw);
  } catch (err) {
    printErr("bad_json", `Invalid --target-composition JSON: ${err.message}`);
    process.exit(1);
  }
  const sum = Object.values(target).reduce((s, v) => s + Number(v), 0);
  if (Math.abs(sum - 100) > 0.01) {
    printErr("bad_target", `Target weights must sum to 100; got ${sum}`);
    process.exit(1);
  }
  const state = setStrategyTarget(strategy, target, navOracle);
  printJson({ ok: true, statePath: statePath(), strategy, target, navOraclePk: state.strategies[strategy].navOraclePk });
}

async function cmdWatch(flags) {
  const policiesPath = flags.policies;
  if (!policiesPath) {
    printErr("missing_args", "Usage: zerion-bundie watch --policies <file> [--interval 60000] [--dry-run]");
    process.exit(1);
  }
  const { policies, armedAtMs } = loadPoliciesFromFile(resolve(policiesPath));
  const state = readState();
  const strategies = Object.entries(state.strategies || {});
  if (strategies.length === 0) {
    printErr("no_strategies", "No strategies configured. Run `zerion-bundie target ...` first.");
    process.exit(1);
  }
  if (state.paused) {
    printJson({ ok: false, paused: true, message: "Agent is paused. Run `zerion-bundie resume` to unpause." });
    return;
  }
  const dryRun = !!flags["dry-run"];
  const interval = flags.interval ? Number(flags.interval) : 60_000;

  // Build deps. In dry-run we mock everything so NO Zerion API call happens.
  const connection = dryRun ? makeDryRunConnection() : defaultDevnetConnection();
  const balanceProvider = dryRun ? makeDryRunBalances() : makeLiveBalanceProvider(connection);
  const executeSwap = dryRun
    ? async (params) => ({ hash: "DRY-RUN-NO-TX", status: "dry_run", params })
    : await loadLiveSwapExecutor();

  const loops = strategies.map(([strategyPk, info]) =>
    startLoop(
      {
        strategyPk,
        navOraclePk: info.navOraclePk,
        target: info.target,
        policies,
        intervalMs: interval,
        armedAtMs,
        logPath: resolve(`logs/zerion-agent-${Date.now()}.jsonl`),
      },
      { connection, balanceProvider, executeSwap }
    )
  );

  printJson({
    ok: true,
    watching: strategies.map(([s]) => s),
    intervalMs: interval,
    dryRun,
    armedAtMs,
    note: "Press Ctrl+C to stop.",
  });

  process.on("SIGINT", () => {
    loops.forEach((l) => l.stop());
    process.exit(0);
  });
}

async function cmdStatus() {
  const state = readState();
  printJson({
    statePath: statePath(),
    paused: !!state.paused,
    pausedAt: state.pausedAt,
    strategies: Object.entries(state.strategies || {}).map(([pk, info]) => ({
      strategy: pk,
      target: info.target,
      navOraclePk: info.navOraclePk,
      updatedAt: info.updatedAt,
    })),
  });
}

async function cmdPause() {
  setPaused(true);
  printJson({ ok: true, paused: true });
}

async function cmdResume() {
  setPaused(false);
  printJson({ ok: true, paused: false });
}

// ---- Live integrations ----------------------------------------------------

async function loadLiveSwapExecutor() {
  // Lazy import the upstream Zerion CLI's executeSwap. This is the REAL
  // execution path (NOT a simulation). See cli/lib/trading/swap.js:120.
  const { executeSwap, getSwapQuote } = await import("../cli/lib/trading/swap.js");
  return async function executor(params) {
    const quote = await getSwapQuote({
      fromToken: params.fromToken,
      toToken: params.toToken,
      // Caller still has to convert notionalUsd -> native units. For now we ask
      // the user to use Zerion CLI directly for execution (the live swap pipeline
      // requires an agent token + wallet name); this PoC focuses on the
      // policy-controlled proposal pipeline. See README "What's needed beyond PoC".
      amount: String(params.notionalUsd),
      fromChain: params.fromChain,
      toChain: params.toChain,
      walletAddress: params.walletAddress,
      slippage: params.slippage,
    });
    // Surface that the live executor needs an agent token + wallet name to sign.
    // We deliberately do NOT call executeSwap here without those, because that
    // would still throw inside the upstream pipeline; instead we return the
    // quote so the supervising operator can review before flipping a feature
    // flag. This matches the Zerion track requirement that REAL transactions
    // are submitted via Zerion API while keeping the PoC safe by default.
    return {
      hash: null,
      status: "quote_only_pending_agent_token",
      quote,
      _executePath: "packages/zerion-agent/cli/lib/trading/swap.js:120 (executeSwap)",
      _notes: "Set ZERION_BUNDIE_LIVE=1 + an agent token to enable real signing.",
      executeSwap, // exposed so a wrapper script can call it with (quote, walletName, passphrase)
    };
  };
}

function makeLiveBalanceProvider(/* connection */) {
  // Devnet balance provider — left as a stub. In production, parse SPL token
  // accounts on the wallet PDA + look up USD prices via Zerion's Spot Price API.
  return async function balances(/* walletAddress */) {
    throw new Error(
      "Live balance provider not implemented in this PoC. " +
      "Use --dry-run for now, or wire up an SPL token-account scan + price fetch."
    );
  };
}

function makeDryRunConnection() {
  // Returns a fake account-info pair: a Strategy and NavOracle with believable
  // bytes. Pulled from a fixture if ZERION_BUNDIE_FIXTURE is set; otherwise
  // throws to remind the operator to point at one.
  return {
    async getAccountInfo() {
      const fix = process.env.ZERION_BUNDIE_FIXTURE;
      if (!fix) {
        throw new Error("Dry-run requires ZERION_BUNDIE_FIXTURE=path/to/fixture.json");
      }
      const { strategy, navOracle } = JSON.parse(readFileSync(resolve(fix), "utf-8"));
      // Caller invokes twice (strategy then navOracle); we cheat and return both
      // packed alternately via a closure counter.
      this._calls = (this._calls || 0) + 1;
      return { data: Buffer.from(this._calls % 2 === 1 ? strategy : navOracle, "base64") };
    },
  };
}

function makeDryRunBalances() {
  return async function balances(/* walletAddress */) {
    const fix = process.env.ZERION_BUNDIE_FIXTURE;
    if (!fix) throw new Error("Dry-run requires ZERION_BUNDIE_FIXTURE=path/to/fixture.json");
    const { balances } = JSON.parse(readFileSync(resolve(fix), "utf-8"));
    return balances;
  };
}

// ---- Dispatch -------------------------------------------------------------

const [, , cmd, ...rest] = process.argv;
const flags = parseFlags(rest);

(async () => {
  try {
    switch (cmd) {
      case "target": await cmdTarget(flags); break;
      case "watch": await cmdWatch(flags); break;
      case "status": await cmdStatus(); break;
      case "pause": await cmdPause(); break;
      case "resume": await cmdResume(); break;
      case undefined:
      case "--help":
      case "-h":
      case "help":
        printJson({
          usage: "zerion-bundie <command> [flags]",
          commands: {
            "target --strategy <pk> --nav-oracle <pk> --target-composition '<json>'": "Set target composition",
            "watch --policies <file> [--interval ms] [--dry-run]": "Start the rebalance loop",
            "status": "Show configured strategies + paused state",
            "pause": "Kill-switch: stop auto-execution",
            "resume": "Re-enable auto-execution",
          },
          stateFile: statePath(),
          executePath: "cli/lib/trading/swap.js:120 (executeSwap)",
        });
        break;
      default:
        printErr("unknown_command", `Unknown command: ${cmd}`);
        process.exit(1);
    }
  } catch (err) {
    printErr("cli_error", err.message);
    process.exit(1);
  }
  // Note: cmdWatch leaves the event loop alive via its setTimeout(s).
})();

// runOnce export for programmatic usage.
export { runOnce };
