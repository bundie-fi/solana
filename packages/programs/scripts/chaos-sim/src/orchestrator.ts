/**
 * orchestrator.ts — phased chaos run.
 *
 * Phase 1 — Compose: each creator picks a primary protocol, creates a
 *           strategy, then fires 2-4 rebalance txs into different
 *           protocols. End state: a real multi-protocol strategy.
 *
 * Phase 2 — Markets: each creator opens 2 prediction markets on its
 *           strategy.
 *
 * Phase 3 — Trade: each trader does 20 random YES/NO buys across the
 *           open markets, sized to fit within their USDC budget.
 *
 * Concurrency: phases run sequentially, but within each phase the
 * per-role actions parallel-fire via Promise.all. The CLI runner has
 * its own jitter so we don't wallop devnet RPC.
 */
import {
  KAMINO_DEVNET_RESERVE,
  PHASE,
  REBALANCE_PROTOCOLS,
  RebalanceProtocol,
} from "./config.js";

const { TRADE_USDC_MIN, TRADE_USDC_MAX } = PHASE;
import {
  CliResult,
  extractMarketAddress,
  extractStrategyAddress,
  extractSignature,
  runCli,
} from "./cli-runner.js";
import { Recorder } from "./recorder.js";
import { ChaosWallet } from "./wallets.js";

interface CreatedStrategy {
  creator: ChaosWallet;
  address: string;
  primaryProtocol: RebalanceProtocol;
  composition: RebalanceProtocol[];
}

interface CreatedMarket {
  strategy: CreatedStrategy;
  address: string;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: readonly T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function tail(s: string, n = 600): string {
  return s.length <= n ? s : "..." + s.slice(-n);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function runAndRecord(
  rec: Recorder,
  wallet: ChaosWallet,
  action: string,
  args: string[],
  meta: Record<string, unknown> = {},
): Promise<CliResult> {
  const r = await runCli(wallet, args);
  if (r.ok) {
    rec.event({
      ts: nowIso(),
      phase: action.startsWith("create-strategy") ? "create"
        : action.startsWith("rebalance") ? "rebalance"
        : action.startsWith("create-market") ? "market"
        : "trade",
      role: wallet.role,
      action,
      ok: true,
      durationMs: r.durationMs,
      signature: extractSignature(r.stdout) || undefined,
      strategy: extractStrategyAddress(r.stdout) || undefined,
      market: extractMarketAddress(r.stdout) || undefined,
      meta: { ...meta, stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr) },
    });
  } else {
    rec.event({
      ts: nowIso(),
      phase: action.startsWith("create-strategy") ? "create"
        : action.startsWith("rebalance") ? "rebalance"
        : action.startsWith("create-market") ? "market"
        : "trade",
      role: wallet.role,
      action,
      ok: false,
      durationMs: r.durationMs,
      error: `exit non-zero (${r.stderr.split("\n")[0] || "unknown"})`,
      stdoutTail: tail(r.stdout),
      stderrTail: tail(r.stderr),
    });
  }
  return r;
}

// ─── Phase 1 — Compose ────────────────────────────────────────────────────

async function phaseCompose(
  rec: Recorder,
  creators: ChaosWallet[],
): Promise<CreatedStrategy[]> {
  console.log(`\n=== PHASE 1: compose (${creators.length} multi-protocol strategies) ===`);
  const strategies: CreatedStrategy[] = [];

  for (const creator of creators) {
    const primary = pick(REBALANCE_PROTOCOLS);
    const compCount = PHASE.REBALANCES_PER_STRATEGY_MIN +
      Math.floor(Math.random() *
        (PHASE.REBALANCES_PER_STRATEGY_MAX - PHASE.REBALANCES_PER_STRATEGY_MIN + 1));
    const composition = pickN(REBALANCE_PROTOCOLS, compCount);
    const name = `chaos-${creator.role}-${Date.now() % 100000}`;

    // 1a. create as agent-type — funds sit in wallet PDA, rebalance txs
    // below move them into protocols. CLI's --protocol only maps
    // kamino/marginfi/jupiter as names; pass kamino as the label-only
    // primary regardless of the recipe (real composition is decided by
    // the rebalance legs, not the strategy's primary-protocol field).
    const cR = await runAndRecord(rec, creator, "create-strategy", [
      "create-strategy",
      "--name", name,
      "--type", "agent",
      "--protocol", "kamino",
      "--fee-bps", "1000",
      "--deposit", PHASE.STRATEGY_SEED_USDC,
      "--min-deposit", "0.05",
    ], { primary, composition });

    if (!cR.ok) continue;
    const addr = extractStrategyAddress(cR.stdout);
    if (!addr) {
      rec.anomaly({
        ts: nowIso(),
        kind: "cli-fail",
        role: creator.role,
        detail: "create-strategy succeeded but no address parseable from stdout",
      });
      continue;
    }
    const strat: CreatedStrategy = { creator, address: addr, primaryProtocol: primary, composition };
    strategies.push(strat);

    // 1b. init-position per protocol (one-shot per strategy per protocol).
    // Kamino REQUIRES this before any rebalance — sets up the per-strategy
    // UserMetadata + Obligation accounts. Drift and Marginfi follow the
    // same shape but with their own PDA derivations.
    const initialized = new Set<RebalanceProtocol>();
    for (const proto of composition) {
      if (initialized.has(proto)) continue;
      const initFlags: string[] = [];
      if (proto === "kamino") {
        // Falls back to devnet main lending market when --lending-market
        // is omitted; passing explicitly keeps the chaos run reproducible.
        initFlags.push("--lending-market", "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J");
      }
      const ir = await runAndRecord(rec, creator, `init-position-${proto}`, [
        "init-position",
        "--strategy", addr,
        "--protocol", proto,
        ...initFlags,
      ], { strategy: addr, leg: proto });
      if (ir.ok) initialized.add(proto);
    }

    // 1c. composition rebalances. Each protocol leg supplies its own
    // required CLI flags (Kamino needs --reserve; once more protocols
    // are wired in REBALANCE_PROTOCOLS, extend this map analogously.)
    for (const proto of composition) {
      const extraFlags: string[] = [];
      if (proto === "kamino") {
        extraFlags.push("--reserve", KAMINO_DEVNET_RESERVE);
      }
      await runAndRecord(rec, creator, `rebalance-${proto}`, [
        "rebalance",
        "--strategy", addr,
        "--protocol", proto,
        "--action", "deposit",
        "--amount", PHASE.REBALANCE_USDC,
        ...extraFlags,
      ], { strategy: addr, leg: proto });
    }
  }

  console.log(`-> ${strategies.length}/${creators.length} strategies composed`);
  return strategies;
}

// ─── Phase 2 — Markets ────────────────────────────────────────────────────

async function phaseMarkets(
  rec: Recorder,
  strategies: CreatedStrategy[],
  creators: ChaosWallet[],
): Promise<CreatedMarket[]> {
  // Program-level constraint: a strategy's creator CANNOT open a market on
  // their own strategy. We rotate: strategy[i]'s markets get opened by
  // creator[(i+1) % N]. Requires N >= 2 strategies/creators.
  console.log(`\n=== PHASE 2: markets (${PHASE.MARKETS_PER_STRATEGY} per strategy, opened by a different creator) ===`);
  const markets: CreatedMarket[] = [];

  if (strategies.length < 2) {
    console.log("-> need >=2 strategies to satisfy 'no self-market' rule. skipping.");
    return markets;
  }

  for (let s = 0; s < strategies.length; s++) {
    const strat = strategies[s];
    // Find a market-maker wallet that isn't this strategy's creator.
    // Prefer the next creator in the pool; fall back to any other.
    const maker = creators[(s + 1) % creators.length].pubkeyB58 === strat.creator.pubkeyB58
      ? creators[(s + 2) % creators.length]
      : creators[(s + 1) % creators.length];

    for (let i = 0; i < PHASE.MARKETS_PER_STRATEGY; i++) {
      const thresholdBps = PHASE.MARKET_THRESHOLD_BPS + Math.floor(Math.random() * 500); // 3–8%
      const question = `Will ${strat.address.slice(0, 6)}… APY > ${(thresholdBps / 100).toFixed(1)}% in ${PHASE.MARKET_RESOLUTION_DAYS}d?`;
      const r = await runAndRecord(rec, maker, "create-market", [
        "create-market",
        "--strategy", strat.address,
        "--question", question,
        "--threshold-bps", String(thresholdBps),
        "--resolution-days", String(PHASE.MARKET_RESOLUTION_DAYS),
        "--initial-subsidy", PHASE.MARKET_INITIAL_SUBSIDY_USDC,
      ], { strategy: strat.address, maker: maker.role, thresholdBps });
      if (!r.ok) continue;
      const addr = extractMarketAddress(r.stdout);
      if (addr) markets.push({ strategy: strat, address: addr });
    }
  }

  console.log(`-> ${markets.length} markets opened across ${strategies.length} strategies`);
  return markets;
}

// ─── Phase 3 — Trade ──────────────────────────────────────────────────────

async function phaseTrade(
  rec: Recorder,
  traders: ChaosWallet[],
  markets: CreatedMarket[],
): Promise<void> {
  if (markets.length === 0) {
    console.log("\n=== PHASE 3: SKIPPED (no markets to trade on) ===");
    return;
  }
  console.log(`\n=== PHASE 3: trade (${traders.length} traders × ${PHASE.TRADES_PER_TRADER} cycles) ===`);

  await Promise.all(traders.map(async (trader) => {
    for (let i = 0; i < PHASE.TRADES_PER_TRADER; i++) {
      const market = pick(markets);
      const outcome = Math.random() < 0.5 ? "yes" : "no";
      const amountBase = TRADE_USDC_MIN +
        Math.floor(Math.random() * (TRADE_USDC_MAX - TRADE_USDC_MIN));
      const amountUsdc = (amountBase / 1e6).toFixed(6);
      await runAndRecord(rec, trader, `predict-${outcome}`, [
        "predict",
        "--market", market.address,
        "--side", outcome,
        "--amount", amountUsdc,
      ], { market: market.address, outcome, amountUsdc });
    }
  }));

  console.log(`-> trade phase done`);
}

// ─── Run all ──────────────────────────────────────────────────────────────

export async function runChaos(wallets: ChaosWallet[]): Promise<void> {
  const rec = new Recorder();
  console.log(`logs -> ${rec.runDir}`);

  const creators = wallets.filter((w) => w.role.startsWith("creator-"));
  const traders = wallets.filter((w) => w.role.startsWith("trader-"));

  const strategies = await phaseCompose(rec, creators);
  const markets = await phaseMarkets(rec, strategies, creators);
  await phaseTrade(rec, traders, markets);

  const sum = rec.summary();
  console.log(`\n=== DONE ===`);
  console.log(`events:    ${sum.events}`);
  console.log(`anomalies: ${sum.anomalies}`);
  console.log(`logs:      ${sum.runDir}`);
  if (sum.anomalies > 0) {
    console.log(`\nreview: jq . ${sum.runDir}/anomalies.jsonl`);
  }
}

