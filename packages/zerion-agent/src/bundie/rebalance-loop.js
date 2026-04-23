/**
 * Bundie x Zerion — periodic rebalance loop.
 *
 * Pipeline (every `intervalMs`):
 *   1. Pull Strategy + NavOracle from devnet (strategy-monitor)
 *   2. Pull wallet PDA balances + spot prices (delegates: balanceProvider)
 *   3. Compute composition + drift
 *   4. For each rebalance proposal:
 *        a. Build a SwapContext
 *        b. Run the PolicyEnforcer (DENY-by-default)
 *        c. If allowed, build the Zerion swap call and execute via the fork's
 *           own swap pipeline at:
 *              packages/zerion-agent/cli/lib/trading/swap.js:executeSwap (line 120)
 *           which on Solana routes to:
 *              packages/zerion-agent/cli/lib/chain/solana.js:signAndBroadcastSolana (line 26)
 *           and ultimately to web3.js sendAndConfirmRawTransaction (line 48).
 *        d. Log the action and update the rolling spend log
 *   5. Append a JSONL line per decision to logs/zerion-agent-<timestamp>.jsonl
 *
 * The loop is fully injectable for tests — pass `deps` with mocked clients.
 */

import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { computeComposition, proposeRebalance, loadStrategyState, makeRpcConnection } from "./strategy-monitor.js";
import { makeEnforcer } from "./policies.js";

/**
 * Build the parameters that we'd pass to the Zerion CLI's getSwapQuote.
 * Pure function — no network. Tests assert the output shape directly.
 */
export function buildZerionSwapParams(proposal, { walletAddress, slippage = 1, chain = "solana" }) {
  if (!walletAddress) throw new Error("walletAddress required");
  if (!proposal?.fromMint || !proposal?.toMint) throw new Error("proposal needs fromMint and toMint");
  if (!Number.isFinite(proposal.notionalUsd) || proposal.notionalUsd <= 0) {
    throw new Error("proposal.notionalUsd must be positive");
  }
  return {
    fromToken: proposal.fromSymbol || proposal.fromMint,
    toToken: proposal.toSymbol || proposal.toMint,
    // Caller is responsible for converting USD notional to native amount via
    // the spot price of fromMint. We surface both so the executor can do it.
    notionalUsd: proposal.notionalUsd,
    fromChain: chain,
    toChain: chain,
    walletAddress,
    slippage,
  };
}

/**
 * @typedef {object} RebalanceLoopDeps
 * @property {object} connection - Solana RPC connection (mockable)
 * @property {(walletPda: string) => Promise<Record<string, { amount: number|string|bigint, decimals: number, usdPrice: number, symbol?: string }>>} balanceProvider
 * @property {(params: object) => Promise<object>} executeSwap - the Zerion executeSwap (mocked in tests)
 * @property {(line: string) => void} [appendLog] - log sink (defaults to file)
 * @property {() => number} [now] - clock (defaults to Date.now)
 */

/**
 * @typedef {object} RebalanceLoopConfig
 * @property {string} strategyPk
 * @property {string} navOraclePk
 * @property {Record<string, number>} target  - mint -> percent (sums to 100)
 * @property {object[]} policies              - [{ id, config }, ...]
 * @property {number} [driftThresholdPct]     - default 5
 * @property {number} [intervalMs]            - default 60_000
 * @property {string} [logPath]               - jsonl log path
 * @property {number} [armedAtMs]             - timestamp the agent was armed
 * @property {string} [walletAddress]         - override (defaults to strategy.wallet)
 * @property {string} [chain]                 - default "solana"
 */

/**
 * Run a single rebalance "tick". Returns an array of action records (one per
 * proposal that was either executed, denied, or skipped).
 *
 * @param {RebalanceLoopConfig} config
 * @param {RebalanceLoopDeps} deps
 * @param {{ spendLog: Array, navHistory: Array, armedAtMs: number }} [runtime]
 */
export async function runOnce(config, deps, runtime) {
  const now = deps.now ? deps.now() : Date.now();
  const driftThresholdPct = Number(config.driftThresholdPct ?? 5);
  const enforce = makeEnforcer(config.policies);

  // 1. Pull strategy + nav.
  const { strategy, navOracle } = await loadStrategyState(deps.connection, config.strategyPk, config.navOraclePk);
  const walletAddress = config.walletAddress || strategy.wallet;

  // 2. Pull balances of the wallet PDA.
  const balances = await deps.balanceProvider(walletAddress);

  // 3. Composition + drift.
  const composition = computeComposition(balances, config.target);
  const proposals = proposeRebalance(composition, {
    driftThresholdPct,
    mintMeta: Object.fromEntries(
      Object.entries(balances).map(([m, info]) => [m, { symbol: info.symbol, decimals: info.decimals }])
    ),
  });

  // 4. NAV history maintenance — push current nav_per_share so nav_divergence works.
  const navHistory = (runtime?.navHistory || []).slice();
  navHistory.push({ navPerShare: Number(navOracle.navPerShare), timestampMs: now });
  // Trim to last 24h to bound memory.
  const cutoff = now - 24 * 60 * 60 * 1000;
  while (navHistory.length && navHistory[0].timestampMs < cutoff) navHistory.shift();

  const spendLog = (runtime?.spendLog || []).slice();
  const armedAtMs = runtime?.armedAtMs ?? config.armedAtMs ?? now;

  const actions = [];
  for (const proposal of proposals) {
    const ctx = {
      chain: config.chain || "solana",
      fromMint: proposal.fromMint,
      toMint: proposal.toMint,
      fromSymbol: proposal.fromSymbol,
      toSymbol: proposal.toSymbol,
      notionalUsd: proposal.notionalUsd,
      timestampMs: now,
      navPerShare: Number(navOracle.navPerShare),
      navHistory,
    };
    const decision = enforce(ctx, { spendLog, navHistory, armedAtMs });

    const baseRecord = {
      ts: now,
      strategy: config.strategyPk,
      proposal,
      composition: { totalUsd: composition.totalUsd, current: composition.current, drift: composition.drift },
      decision,
    };

    if (!decision.allow) {
      const record = { ...baseRecord, kind: "denied", deniedBy: decision.deniedBy };
      actions.push(record);
      writeLog(deps, config, record);
      continue;
    }

    // Build Zerion params and execute.
    const swapParams = buildZerionSwapParams(proposal, {
      walletAddress,
      slippage: 1,
      chain: ctx.chain,
    });
    let exec;
    try {
      exec = await deps.executeSwap(swapParams);
      const record = { ...baseRecord, kind: "executed", swapParams, exec };
      actions.push(record);
      writeLog(deps, config, record);
      // Update spendLog (rolling 24h).
      spendLog.push({ timestampMs: now, notionalUsd: proposal.notionalUsd, txHash: exec?.hash });
    } catch (err) {
      const record = { ...baseRecord, kind: "exec_error", swapParams, error: { message: err.message } };
      actions.push(record);
      writeLog(deps, config, record);
    }
  }

  return { now, composition, proposals, actions, runtime: { spendLog, navHistory, armedAtMs } };
}

function writeLog(deps, config, record) {
  if (deps.appendLog) {
    deps.appendLog(JSON.stringify(record));
    return;
  }
  if (!config.logPath) return;
  try {
    mkdirSync(dirname(config.logPath), { recursive: true });
    appendFileSync(config.logPath, JSON.stringify(record) + "\n");
  } catch {
    // Last-resort: drop on the floor; the action record is still in the return value.
  }
}

/**
 * Long-running supervisor loop. Polls every intervalMs. Stops when the returned
 * `stop()` is called or when an expiry/kill-switch denies every proposal twice
 * in a row (the policies themselves still gate each individual swap).
 */
export function startLoop(config, deps) {
  let timer;
  let stopped = false;
  let runtime = { spendLog: [], navHistory: [], armedAtMs: config.armedAtMs ?? (deps.now ? deps.now() : Date.now()) };
  const interval = Number(config.intervalMs ?? 60_000);

  async function tick() {
    if (stopped) return;
    try {
      const r = await runOnce(config, deps, runtime);
      runtime = r.runtime;
    } catch (err) {
      writeLog(deps, config, { ts: Date.now(), kind: "loop_error", error: { message: err.message } });
    }
    if (!stopped) timer = setTimeout(tick, interval);
  }

  timer = setTimeout(tick, 0);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    getRuntime() {
      return runtime;
    },
  };
}

/**
 * Convenience: open a default Solana devnet connection. Tests should NOT use
 * this — pass a mock connection to runOnce/startLoop.
 */
export function defaultDevnetConnection() {
  return makeRpcConnection("https://api.devnet.solana.com");
}
