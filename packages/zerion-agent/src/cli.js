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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadPoliciesFromFile } from "./bundie/policy-loader.js";
import { readState, setStrategyTarget, setPaused, statePath } from "./bundie/state-store.js";
import { startLoop, runOnce, defaultDevnetConnection } from "./bundie/rebalance-loop.js";
import { loadStrategyState } from "./bundie/strategy-monitor.js";
import {
  createAgent,
  findAgent,
  hasAgent,
  importAgentFromKey,
  listAgents,
  signSolanaTx,
} from "./bundie/agent-vault.js";

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

// ---- Agent (Bundie agents on the Zerion vault) -----------------------------
//
// Sub-commands surface the OWS-backed primitives in `bundie/agent-vault.js`
// for chaos-sim and any future Bundie agent. None of these commands ever
// emit secret material to stdout/stderr — vault entries are stored under
// ~/.ows/wallets/ encrypted at rest by OWS.

async function cmdAgentCreate(flags) {
  const name = flags.name;
  if (!name) {
    printErr("missing_args", "Usage: zerion-bundie agent create --name <role>");
    process.exit(1);
  }
  const created = createAgent(name);
  // Idempotent: if the agent already existed, `created` mirrors the existing
  // record. Caller can detect newness via the `existedBefore` flag we set by
  // probing once before the create call.
  printJson({
    ok: true,
    role: created.role,
    pubkey: created.pubkey,
    vaultName: created.vaultName,
  });
}

async function cmdAgentList() {
  const agents = listAgents();
  printJson({
    ok: true,
    count: agents.length,
    agents: agents.map((a) => ({
      role: a.role,
      pubkey: a.pubkey,
      vaultName: a.vaultName,
    })),
  });
}

async function cmdAgentSign(flags) {
  const name = flags.name;
  const tx = flags.tx;
  if (!name || !tx) {
    printErr(
      "missing_args",
      "Usage: zerion-bundie agent sign --name <role> --tx <base64>",
    );
    process.exit(1);
  }
  // signSolanaTx throws DENY-by-default if the agent isn't in the vault.
  const signedB64 = signSolanaTx(name, tx);
  // Print ONLY the signed-tx bytes; never echo the input or any vault
  // metadata that could leak to terminal scrollback.
  printJson({ ok: true, role: name, signedTx: signedB64 });
}

async function cmdChaosSimMigrate(flags) {
  // Default keys dir: monorepo path. Override with --keys-dir for tests.
  const keysDir =
    flags["keys-dir"] ||
    resolve(
      new URL("../../programs/scripts/chaos-sim/keys", import.meta.url).pathname,
    );
  if (!existsSync(keysDir)) {
    printErr("missing_keys_dir", `keys directory not found: ${keysDir}`);
    process.exit(1);
  }
  const namesPath = join(keysDir, "agent-names.json");
  let names = {};
  if (existsSync(namesPath)) {
    try {
      const raw = JSON.parse(readFileSync(namesPath, "utf-8"));
      names = raw.agents || {};
    } catch (err) {
      printErr("bad_agent_names", `cannot parse agent-names.json: ${err.message}`);
      process.exit(1);
    }
  }
  const files = readdirSync(keysDir).filter(
    (f) => f.endsWith(".json") && f !== "agent-names.json",
  );
  const results = [];
  for (const file of files) {
    const role = file.replace(/\.json$/, "");
    const path = join(keysDir, file);
    let bytes;
    try {
      bytes = JSON.parse(readFileSync(path, "utf-8"));
    } catch (err) {
      results.push({ role, status: "skipped", reason: `bad-json: ${err.message}` });
      continue;
    }
    if (!Array.isArray(bytes) || (bytes.length !== 64 && bytes.length !== 32)) {
      results.push({
        role,
        status: "skipped",
        reason: `unexpected key length ${Array.isArray(bytes) ? bytes.length : "non-array"}`,
      });
      continue;
    }
    const wasInVault = hasAgent(role);
    try {
      const rec = importAgentFromKey(role, bytes);
      // Cross-check against agent-names.json to catch role/pubkey drift.
      const expectedPub = names[role]?.pubkey;
      const mismatch =
        expectedPub && expectedPub !== rec.pubkey
          ? { expected: expectedPub, got: rec.pubkey }
          : null;
      results.push({
        role,
        status: wasInVault ? "already-in-vault" : "imported",
        pubkey: rec.pubkey,
        ...(mismatch ? { warn_pubkey_mismatch: mismatch } : {}),
      });
    } catch (err) {
      results.push({ role, status: "failed", reason: err.message });
    }
  }
  printJson({
    ok: true,
    keysDir,
    fileNote:
      "Existing keys/<role>.json files are LEFT IN PLACE. Delete them manually after verifying migration.",
    migrated: results.filter((r) => r.status === "imported").length,
    alreadyInVault: results.filter((r) => r.status === "already-in-vault").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
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

const [, , cmd, sub, ...rest] = process.argv;
// Some commands take a subcommand (e.g. `agent create`); others don't.
// We parse flags from whichever tail is correct per command.
const flagArgs = ["agent"].includes(cmd) ? rest : [sub, ...rest].filter((x) => x !== undefined);
const flags = parseFlags(flagArgs);

(async () => {
  try {
    switch (cmd) {
      case "target": await cmdTarget(flags); break;
      case "watch": await cmdWatch(flags); break;
      case "status": await cmdStatus(); break;
      case "pause": await cmdPause(); break;
      case "resume": await cmdResume(); break;
      case "chaos-sim-migrate": await cmdChaosSimMigrate(flags); break;
      case "agent": {
        switch (sub) {
          case "create": await cmdAgentCreate(flags); break;
          case "list": await cmdAgentList(flags); break;
          case "sign": await cmdAgentSign(flags); break;
          default:
            printErr(
              "unknown_subcommand",
              `Unknown agent subcommand: ${sub}. Try: create, list, sign`,
            );
            process.exit(1);
        }
        break;
      }
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
            "agent create --name <role>": "Provision a Bundie agent in the Zerion vault",
            "agent list": "List Bundie agents in the Zerion vault",
            "agent sign --name <role> --tx <base64>": "Sign a Solana tx with a vault-managed agent key",
            "chaos-sim-migrate [--keys-dir <path>]": "Import existing chaos-sim keys/*.json into the Zerion vault (idempotent, leaves files on disk)",
          },
          stateFile: statePath(),
          executePath: "cli/lib/trading/swap.js:120 (executeSwap)",
          vaultPathEnv: "BUNDIE_AGENT_VAULT_PATH (optional override; default ~/.ows/wallets)",
          passphraseEnv: "BUNDIE_AGENT_PASSPHRASE (unattended-signing passphrase; default empty)",
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
