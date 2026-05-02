/**
 * seed-bootstrap-agents.ts — Seed six "named strategy" bootstrap agents.
 *
 * Bundie's chicken-and-egg problem: bettors need quality agents to bet on,
 * but external creators are slow to onboard. This script bootstraps the
 * agent supply with six strategies that mimic proven Solana DeFi patterns
 * (Kamino USDC stacking, APY rotation, funding-rate carry, stablecoin
 * yield aggregation, barbell allocation, LST shopping).
 *
 * Usage:
 *   BACKEND_URL=http://localhost:3001 \
 *   BOOTSTRAP_OWNER_WALLET=<base58 pubkey> \
 *   tsx packages/programs/scripts/seed-bootstrap-agents.ts
 *
 * Idempotent: re-running skips agents whose SNS already exists.
 *
 * The `customBrainMd` field of POST /api/agents replaces the auto-generated
 * brain.md entirely (see packages/backend/src/routes/agents.ts:464). To honor
 * the user-spec phrasing of "an addendum that gets appended" while still
 * shipping a working brain (the daemon's redpill-brain.ts substitutes
 * {{STATE_JSON}} / {{ALLOWLIST}} / {{HISTORY_JSON}} placeholders, which a
 * standalone paragraph would lack), this script composes the full brain
 * client-side via the same `generateBrainMd` the backend uses, with the
 * strategy paragraph injected as `customAddition`.
 */

import { generateBrainMd, type AgentPreset, type AllowedProtocol } from "../../backend/src/lib/agent-templates";

// ── Config ─────────────────────────────────────────────────────────────────

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
const OWNER_WALLET = process.env.BOOTSTRAP_OWNER_WALLET;

if (!OWNER_WALLET || OWNER_WALLET.trim() === "") {
  console.error(
    "BOOTSTRAP_OWNER_WALLET env var is required (base58 pubkey of the wallet that will own all six bootstrap agents).",
  );
  process.exit(1);
}

const SEED_AMOUNT_BUSD = 100;

// ── Strategy specs ─────────────────────────────────────────────────────────

interface AgentSpec {
  sns: string;
  displayName: string;
  tagline: string;
  emoji: string;
  preset: AgentPreset;
  allowedProtocols: AllowedProtocol[];
  /** Strategy paragraph appended to the framework brain.md as the addendum. */
  strategyParagraph: string;
}

const STRATEGIES: Record<string, AgentSpec> = {
  "kamino-stacker": {
    sns: "kamino-stacker",
    displayName: "Kamino USDC Stacker",
    tagline: "Maximally simple Kamino USDC reserve passive",
    emoji: "🏦",
    preset: "conservative",
    allowedProtocols: ["kamino"],
    strategyParagraph: [
      "Strategy: Kamino USDC Stacker. Approach inspired by Kamino's main market USDC reserve buy-and-hold pattern.",
      "Each tick: if state.self.usdc > 0.5, emit a single lend_deposit on kamino for the FULL state.self.usdc balance. Do not split, do not hold idle USDC.",
      "If state.self.usdc <= 0.5, emit noop — do NOT withdraw. Capital is already deployed in Kamino and earning supply APY.",
      "Never withdraw on a normal tick. Only withdraw when explicitly winding down (kill-switch / NAV drop > 5%).",
      "Never touch LSTs, perps, or Solend. Never swap. The whole thesis is staying maximally deposited in one reserve.",
      "Skip create_market — this agent is the underlying yield surface that other agents predict against, not a market author.",
    ].join("\n"),
  },

  "apy-rotator": {
    sns: "apy-rotator",
    displayName: "APY Rotator",
    tagline: "Yield-shopping between Kamino and Solend USDC reserves",
    emoji: "🔄",
    preset: "yield-hunter",
    allowedProtocols: ["kamino", "solend"],
    strategyParagraph: [
      "Strategy: APY Rotator. Approach inspired by yield-aggregator vaults that hop between USDC lending venues for the best supply APY.",
      "Each tick, compare Kamino vs Solend USDC supply APY (proxy via state.rates.kaminoUsdcUtilizationBps and the Solend equivalent if surfaced — higher utilization implies higher APY).",
      "If the better venue's utilization exceeds the worse venue's by more than 50bps AND you currently hold a position on the worse venue, emit lend_withdraw from the worse venue first. Next tick, lend_deposit the freed USDC into the winner.",
      "If state.self.usdc > 0.5 and you have NO existing position, deposit the full balance into whichever venue has higher utilization right now.",
      "If the delta is < 50bps, emit noop. Do not churn — withdraw fees and slippage will eat the edge.",
      "Never touch LSTs or perps. Never create_market.",
    ].join("\n"),
  },

  "funding-shorter": {
    sns: "funding-shorter",
    displayName: "Funding Shorter",
    tagline: "Funding-rate carry on Jupiter Perps",
    emoji: "📉",
    preset: "perp-trader",
    allowedProtocols: ["jupiter-perps", "kamino"],
    strategyParagraph: [
      "Strategy: Funding Shorter. Approach inspired by delta-neutral funding-rate carry desks that short perps when longs are paying funding.",
      "Each tick: if state.rates.jupSolPerpFundingBps > 30 (longs paying shorts ≥ 30bps annualized) AND you do NOT already have an open SOL-PERP short, emit a perp_open short on jupiter-perps SOL-PERP sized to ~50% of current vault NAV.",
      "If state.rates.jupSolPerpFundingBps < 0 (funding has flipped negative, shorts now pay longs) AND you have an open short, emit perp_close to exit.",
      "While funding is between 0 and 30bps, hold whatever position you already have — do not flip-flop on small oscillations.",
      "Idle USDC (state.self.usdc) that is NOT earmarked for perp collateral can be parked in kamino USDC to earn baseline yield. Withdraw before redepositing — the ATA does not auto-refill.",
      "Skip create_market unless you have a strong directional read worth exposing to bettors.",
    ].join("\n"),
  },

  "stable-arber": {
    sns: "stable-arber",
    displayName: "Stable Arber",
    tagline: "Stablecoin yield aggregator across protocols",
    emoji: "💵",
    preset: "yield-hunter",
    allowedProtocols: ["kamino", "solend"],
    strategyParagraph: [
      "Strategy: Stable Arber. Approach inspired by stablecoin-only yield aggregators (think Yearn-style USDC vaults) that park capital in whichever lending pool wins on APY.",
      "Each tick, identify the higher-yielding USDC venue between kamino and solend (use state.rates.kaminoUsdcUtilizationBps and the Solend counterpart as the APY proxy).",
      "If state.self.usdc > 0.5, deposit the full balance into the current winner. The USDC ATA does NOT auto-refill, so remember any USDC you see is the only USDC you have until you withdraw a position.",
      "Rebalance (withdraw from loser, redeposit into winner on the next tick) ONLY when the utilization delta exceeds 100bps. Below that threshold, hold — round-trip costs dominate marginal APY pickup.",
      "Never touch LSTs, perps, or swaps. Never go below the 100bps rebalance threshold or you'll churn the principal.",
      "Skip create_market — this agent is a yield-surface bench, not a predictor.",
    ].join("\n"),
  },

  barbell: {
    sns: "barbell",
    displayName: "Barbell Portfolio",
    tagline: "Permanent-portfolio archetype: 50% safe / 50% risky",
    emoji: "⚖️",
    preset: "balanced",
    allowedProtocols: ["kamino", "jupiter-perps"],
    strategyParagraph: [
      "Strategy: Barbell Portfolio. Approach inspired by Taleb's permanent-portfolio idea: pair a maximally safe leg with a maximally risky leg, no middle.",
      "Target weights: 50% NAV in kamino USDC (safe leg) and 50% NAV in a jupiter-perps SOL-PERP LONG (risky leg). Compute weights from current vault NAV each tick.",
      "If the live weight on either leg drifts more than 10 percentage points from 50% (i.e. <40% or >60%), rebalance by ONE leg this tick — withdraw or trim the over-weighted leg, OR deposit / increase the under-weighted leg, whichever closes the gap. The USDC ATA is finite, so withdraw before redepositing.",
      "If both legs are within the 40-60% band, emit noop. Do not micro-rebalance.",
      "If state.self.usdc is the only thing that exists (cold start), put 50% of it into kamino and use the other 50% as collateral to perp_open a SOL-PERP long.",
      "Skip create_market unless a strong rate-surface divergence appears.",
    ].join("\n"),
  },

  "lst-shopper": {
    sns: "lst-shopper",
    displayName: "LST Shopper",
    tagline: "Compares Marinade vs Jito staking yields",
    emoji: "🛒",
    preset: "balanced",
    allowedProtocols: ["marinade", "jito"],
    strategyParagraph: [
      "Strategy: LST Shopper. Approach inspired by LST-comparison dashboards (Sanctum, Stakewiz) that pick the highest rate-above-par each epoch.",
      "Each tick, compare state.rates.marinadeMsolAboveBps (Marinade mSOL premium over 1.0 SOL) vs state.rates.splStakePoolAboveBps (Jito/SPL pool rate above par).",
      "If state.self.sol > 0.05, lst_stake the full available SOL (minus a 0.02 SOL fee buffer) into whichever LST has the higher above-par rate THIS tick.",
      "If you already hold mSOL or jitoSOL on the losing side AND the winner's lead exceeds 100bps, emit lst_unstake on the loser this tick. Next tick the freed SOL will land in state.self.sol and you can lst_stake into the winner. Do not unstake on smaller deltas — the unstake fee + epoch lag wipes the edge.",
      "If the delta is < 100bps and your existing stake is already on the leader, emit noop.",
      "Never touch USDC lending or perps. Skip create_market — this agent is the LST yield bench.",
    ].join("\n"),
  },
};

// ── Posting helpers ────────────────────────────────────────────────────────

interface CreateAgentBody {
  sns: string;
  displayName: string;
  tagline: string;
  emoji: string;
  ownerWallet: string;
  preset: AgentPreset;
  allowedProtocols: AllowedProtocol[];
  seedAmountBusd: number;
  customBrainMd: string;
}

function buildBody(spec: AgentSpec, ownerWallet: string): CreateAgentBody {
  // Compose the full brain.md with the strategy paragraph as the addendum.
  // generateBrainMd appends customAddition under "Owner-supplied addendum:"
  // and preserves the {{STATE_JSON}} / {{ALLOWLIST}} / {{HISTORY_JSON}}
  // placeholders the daemon depends on.
  const brainMd = generateBrainMd({
    preset: spec.preset,
    displayName: spec.displayName,
    allowedProtocols: spec.allowedProtocols,
    customAddition: spec.strategyParagraph,
  });
  return {
    sns: spec.sns,
    displayName: spec.displayName,
    tagline: spec.tagline,
    emoji: spec.emoji,
    ownerWallet,
    preset: spec.preset,
    allowedProtocols: spec.allowedProtocols,
    seedAmountBusd: SEED_AMOUNT_BUSD,
    customBrainMd: brainMd,
  };
}

interface SeedResult {
  sns: string;
  status: "created" | "exists" | "error";
  message?: string;
}

async function postAgent(spec: AgentSpec): Promise<SeedResult> {
  const body = buildBody(spec, OWNER_WALLET as string);
  const url = `${BACKEND_URL.replace(/\/+$/, "")}/api/agents`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { sns: spec.sns, status: "error", message: `network: ${(err as Error).message}` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = { error: `non-JSON response (status ${res.status})` };
  }

  if (res.ok) {
    return { sns: spec.sns, status: "created" };
  }

  const errMsg =
    typeof json === "object" && json !== null && "error" in json
      ? String((json as { error: unknown }).error)
      : `status ${res.status}`;

  // Idempotency: 409 with "sns taken" message means the agent already exists.
  if (res.status === 409 && /sns/i.test(errMsg) && /taken|exists/i.test(errMsg)) {
    return { sns: spec.sns, status: "exists", message: errMsg };
  }
  // Some validation paths return 400 with a sns-related error worth treating
  // as "already exists" too — but we only treat exact 409 as exists. Anything
  // else surfaces as an error so the operator notices.
  return { sns: spec.sns, status: "error", message: `${res.status}: ${errMsg}` };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[seed-bootstrap-agents] backend=${BACKEND_URL}`);
  console.log(`[seed-bootstrap-agents] owner=${OWNER_WALLET}`);
  console.log(`[seed-bootstrap-agents] seeding ${Object.keys(STRATEGIES).length} agents…\n`);

  const results: SeedResult[] = [];
  for (const spec of Object.values(STRATEGIES)) {
    process.stdout.write(`  → ${spec.sns} (${spec.displayName})… `);
    const r = await postAgent(spec);
    if (r.status === "created") console.log("CREATED");
    else if (r.status === "exists") console.log(`EXISTS (skipped)`);
    else console.log(`ERROR — ${r.message ?? "unknown"}`);
    results.push(r);
  }

  // Summary
  const created = results.filter((r) => r.status === "created").map((r) => r.sns);
  const existed = results.filter((r) => r.status === "exists").map((r) => r.sns);
  const errored = results.filter((r) => r.status === "error");

  console.log("\n[seed-bootstrap-agents] Summary:");
  console.log(`  created: ${created.length ? created.join(", ") : "(none)"}`);
  console.log(`  already existed: ${existed.length ? existed.join(", ") : "(none)"}`);
  console.log(`  errored: ${errored.length ? errored.map((e) => `${e.sns} (${e.message})`).join("; ") : "(none)"}`);

  if (errored.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[seed-bootstrap-agents] fatal:", err);
  process.exit(1);
});
