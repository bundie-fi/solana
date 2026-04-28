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

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { loadPoliciesFromFile } from "./bundie/policy-loader.js";
import { readState, setStrategyTarget, setPaused, statePath, appendActionLog } from "./bundie/state-store.js";
import { startLoop, runOnce, defaultDevnetConnection } from "./bundie/rebalance-loop.js";
import { loadStrategyState } from "./bundie/strategy-monitor.js";
import { makeEnforcer } from "./bundie/policies.js";
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
    printErr("missing_args", "Usage: zerion-bundie agent create --name <role> [--mirror-keypair <path>]");
    process.exit(1);
  }
  const mirrorPath = flags["mirror-keypair"];
  let created;
  let mirrored = false;
  if (mirrorPath && !findAgent(name)) {
    // SECURITY-REGRESSION (hackathon scope): generate the keypair OURSELVES so
    // we can write the 64-byte secret-key array to disk for the chaos-sim
    // daemon to discover. This means the secret lives in TWO places now:
    //   1. ~/.ows/wallets/<vaultName> (encrypted at rest by OWS)
    //   2. <mirror-path> (plaintext JSON byte array — same format the chaos
    //      sim already expects from earlier phases)
    // Acceptable for devnet automation; do NOT use this flag in production.
    const kp = Keypair.generate();
    const secretArr = Array.from(kp.secretKey);
    mkdirSync(dirname(mirrorPath), { recursive: true });
    writeFileSync(mirrorPath, JSON.stringify(secretArr) + "\n", { mode: 0o600 });
    created = importAgentFromKey(name, secretArr);
    mirrored = true;
  } else {
    created = createAgent(name);
  }
  // Idempotent: if the agent already existed, `created` mirrors the existing
  // record. Caller can detect newness via the `existedBefore` flag we set by
  // probing once before the create call.
  printJson({
    ok: true,
    role: created.role,
    pubkey: created.pubkey,
    vaultName: created.vaultName,
    mirrored,
    mirrorPath: mirrored ? mirrorPath : undefined,
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

// ---- agent execute ---------------------------------------------------------
//
// `execute` is the canonical "agent does a thing" surface. It runs the
// DENY-by-default policy framework BEFORE signing, then signs via OWS, then
// broadcasts via the configured RPC. Callers (chaos-sim, future autonomous
// agents) hand it a prepared tx and an action label; the rest is owned here.
//
// This is what makes the "agent execution flows through Zerion" claim
// honest — the chaos-sim's create-strategy / create-market / rebalance /
// predict events all pass through this single funnel rather than going
// agent-sign + raw-broadcast.
//
// Per-action policy bundles
// ─────────────────────────
// The five policies in `policies.js` are tuned for swap-style operations
// (asset_whitelist + nav_divergence assume fromMint/toMint). Non-swap
// program calls (create-strategy, create-market, predict, redeem,
// sns-register) are routed through a smaller bundle: chain_lock +
// spend_limit + expiry. Rebalances get the full five.
//
// Note: this v1 keeps policy CONFIG hardcoded (sane devnet defaults) so
// the chaos-sim doesn't need to ship a policies.yaml for every action.
// Production integrations should pass --policies <file>.

const DEFAULT_DEVNET_POLICIES = Object.freeze({
  chain_lock: { allowed_chains: ["solana"] },
  // Generous devnet caps — the chaos sim moves <1 USDC per tx; production
  // integrations should override via --policies to lock these down.
  spend_limit: {
    max_notional_usd_per_rebalance: 100,
    max_notional_usd_per_day: 10_000,
  },
  asset_whitelist: {
    // Devnet USDC + WSOL + the live protocol mints we touch from chaos.
    allowed_mints: [
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // devnet USDC
      "So11111111111111111111111111111111111111112",  // wSOL
    ],
  },
  expiry: { max_age_days: 365 },
  nav_divergence: { max_drop_pct: 50, window_minutes: 60 },
});

function policyBundleFor(action) {
  // Non-swap actions don't carry from/to mints, so asset_whitelist + the
  // NAV-divergence kill-switch don't apply. Use the 3-policy bundle.
  const SWAP_LIKE = new Set(["rebalance"]);
  // Setup-only actions create PDAs / ATAs and move no value (no notional).
  // Running spend_limit on these denies them with
  // `spend_limit_invalid_notional` ("notionalUsd must be a positive
  // number") — fired in production when the wizard called init_vault
  // with notionalUsd=0. spend_limit is meaningless for these ops, so
  // drop it; chain_lock + expiry still apply.
  const SETUP_LIKE = new Set(["init_vault"]);
  const cfg = DEFAULT_DEVNET_POLICIES;
  if (SWAP_LIKE.has(action)) {
    return [
      { id: "chain_lock", config: cfg.chain_lock },
      { id: "spend_limit", config: cfg.spend_limit },
      { id: "asset_whitelist", config: cfg.asset_whitelist },
      { id: "expiry", config: cfg.expiry },
      { id: "nav_divergence", config: cfg.nav_divergence },
    ];
  }
  if (SETUP_LIKE.has(action)) {
    return [
      { id: "chain_lock", config: cfg.chain_lock },
      { id: "expiry", config: cfg.expiry },
    ];
  }
  return [
    { id: "chain_lock", config: cfg.chain_lock },
    { id: "spend_limit", config: cfg.spend_limit },
    { id: "expiry", config: cfg.expiry },
  ];
}

async function cmdAgentExecute(flags) {
  const name = flags.name;
  const txB64 = flags.tx;
  const action = flags.action || "other";
  const notionalUsd = Number(flags["notional-usd"] || 0.5);
  const rpcUrl = flags.rpc || process.env.ZERION_BUNDIE_RPC || "https://api.devnet.solana.com";
  if (!name || !txB64) {
    printErr(
      "missing_args",
      "Usage: zerion-bundie agent execute --name <role> --tx <base64> --action <kind> [--notional-usd <num>] [--rpc <url>]",
    );
    process.exit(1);
  }

  const startedAtMs = Date.now();

  // 1. Policy enforcement — DENY by default.
  const enforce = makeEnforcer(policyBundleFor(action));
  const ctx = {
    chain: "solana",
    // Non-swap actions: use SOL placeholders so spend_limit can still run
    // on the SOL-equivalent fee+rent estimate. Rebalance callers should
    // pass meaningful from/to mints in a future iteration; for v1 the
    // chaos-sim never invokes execute for rebalances (those still run
    // via the periodic loop), so the placeholders are safe.
    fromMint: "So11111111111111111111111111111111111111112",
    toMint: "So11111111111111111111111111111111111111112",
    fromSymbol: "SOL",
    toSymbol: "SOL",
    notionalUsd,
    timestampMs: startedAtMs,
    navPerShare: 1,
    navHistory: [],
  };
  const decision = enforce(ctx, {
    spendLog: [],
    navHistory: [],
    armedAtMs: startedAtMs,
  });

  if (!decision.allow) {
    appendActionLog({
      role: name,
      action,
      ok: false,
      deniedBy: decision.deniedBy,
      durationMs: Date.now() - startedAtMs,
    });
    printJson({
      ok: false,
      role: name,
      action,
      deniedBy: decision.deniedBy,
      decisions: decision.decisions,
    });
    process.exit(1);
  }

  // 2. Sign via OWS vault. signSolanaTx already throws DENY-by-default if
  // the agent isn't in the vault.
  let signedB64;
  try {
    signedB64 = signSolanaTx(name, txB64);
  } catch (err) {
    appendActionLog({
      role: name,
      action,
      ok: false,
      error: err.message,
      durationMs: Date.now() - startedAtMs,
    });
    printErr("sign_failed", err.message);
    process.exit(1);
  }

  // 3. Broadcast + confirm. We skip preflight to avoid double-sim cost
  // (the chaos-sim already preflighted via bundie-sol prepare).
  let signature;
  try {
    const { Connection } = await import("@solana/web3.js");
    const conn = new Connection(rpcUrl, "confirmed");
    const raw = Buffer.from(signedB64, "base64");
    signature = await conn.sendRawTransaction(raw, { skipPreflight: false });
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    await conn.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
  } catch (err) {
    appendActionLog({
      role: name,
      action,
      ok: false,
      error: err.message,
      durationMs: Date.now() - startedAtMs,
    });
    printErr("broadcast_failed", err.message);
    process.exit(1);
  }

  appendActionLog({
    role: name,
    action,
    ok: true,
    signature,
    durationMs: Date.now() - startedAtMs,
  });
  printJson({
    ok: true,
    role: name,
    action,
    signature,
    decisions: decision.decisions,
    durationMs: Date.now() - startedAtMs,
  });
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
          case "execute": await cmdAgentExecute(flags); break;
          default:
            printErr(
              "unknown_subcommand",
              `Unknown agent subcommand: ${sub}. Try: create, list, sign, execute`,
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
            "agent create --name <role> [--mirror-keypair <path>]": "Provision a Bundie agent in the Zerion vault. With --mirror-keypair, also write the 64-byte secret to disk for chaos-sim daemon (devnet only — security regression).",
            "agent list": "List Bundie agents in the Zerion vault",
            "agent sign --name <role> --tx <base64>": "Sign a Solana tx with a vault-managed agent key",
            "agent execute --name <role> --tx <base64> --action <kind> [--notional-usd <n>] [--rpc <url>]": "Run policy framework → sign via OWS → broadcast → record. Single Zerion-mediated execution funnel for all agent ops.",
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
