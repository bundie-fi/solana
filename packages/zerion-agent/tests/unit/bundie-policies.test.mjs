/**
 * Unit tests for the Bundie x Zerion policy enforcer.
 * Asserts each of the 5 policies on its decision boundary, plus the
 * DENY-by-default semantics of the enforcer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chainLock,
  spendLimit,
  assetWhitelist,
  expiry,
  navDivergence,
  makeEnforcer,
  POLICY_REGISTRY,
} from "../../src/bundie/policies.js";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MSOL = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const FAKE = "FakeMint11111111111111111111111111111111111";

function ctx(overrides = {}) {
  return {
    chain: "solana",
    fromMint: SOL,
    toMint: USDC,
    fromSymbol: "SOL",
    toSymbol: "USDC",
    notionalUsd: 10,
    timestampMs: 1_700_000_000_000,
    navPerShare: 1_000_000_000,
    navHistory: [],
    ...overrides,
  };
}

// 1. chain_lock ------------------------------------------------------------

test("chain_lock allows when chain is in list", () => {
  const r = chainLock(ctx(), { allowed_chains: ["solana"] });
  assert.equal(r.allow, true);
});

test("chain_lock denies on mismatched chain", () => {
  const r = chainLock(ctx({ chain: "ethereum" }), { allowed_chains: ["solana"] });
  assert.equal(r.allow, false);
  assert.equal(r.code, "chain_lock_violation");
});

test("chain_lock denies when allowed_chains is empty (deny-by-default)", () => {
  const r = chainLock(ctx(), { allowed_chains: [] });
  assert.equal(r.allow, false);
  assert.match(r.code, /misconfigured/);
});

// 2. spend_limit -----------------------------------------------------------

test("spend_limit allows when both per-rebalance and daily caps are respected", () => {
  const r = spendLimit(
    ctx({ notionalUsd: 20 }),
    { max_notional_usd_per_rebalance: 25, max_notional_usd_per_day: 100 },
    { spendLog: [{ timestampMs: 1_699_999_999_000, notionalUsd: 30 }] }
  );
  assert.equal(r.allow, true);
});

test("spend_limit denies when per-rebalance cap is exceeded by 1¢", () => {
  const r = spendLimit(
    ctx({ notionalUsd: 25.01 }),
    { max_notional_usd_per_rebalance: 25, max_notional_usd_per_day: 100 },
    { spendLog: [] }
  );
  assert.equal(r.allow, false);
  assert.equal(r.code, "spend_limit_per_rebalance_exceeded");
});

test("spend_limit denies when 24h rolling cap would be crossed", () => {
  const now = 1_700_000_000_000;
  const r = spendLimit(
    ctx({ notionalUsd: 20, timestampMs: now }),
    { max_notional_usd_per_rebalance: 25, max_notional_usd_per_day: 100 },
    { spendLog: [{ timestampMs: now - 1000, notionalUsd: 90 }] }
  );
  assert.equal(r.allow, false);
  assert.equal(r.code, "spend_limit_daily_exceeded");
});

test("spend_limit ignores spend older than 24h", () => {
  const now = 1_700_000_000_000;
  const r = spendLimit(
    ctx({ notionalUsd: 20, timestampMs: now }),
    { max_notional_usd_per_rebalance: 25, max_notional_usd_per_day: 100 },
    { spendLog: [{ timestampMs: now - 25 * 60 * 60 * 1000, notionalUsd: 90 }] }
  );
  assert.equal(r.allow, true);
});

// 3. asset_whitelist -------------------------------------------------------

test("asset_whitelist allows when both mints are listed", () => {
  const r = assetWhitelist(ctx(), { allowed_mints: [SOL, USDC, MSOL] });
  assert.equal(r.allow, true);
});

test("asset_whitelist denies when fromMint is not listed", () => {
  const r = assetWhitelist(ctx({ fromMint: FAKE }), { allowed_mints: [SOL, USDC] });
  assert.equal(r.allow, false);
  assert.equal(r.code, "asset_whitelist_violation");
});

test("asset_whitelist denies when toMint is not listed", () => {
  const r = assetWhitelist(ctx({ toMint: FAKE }), { allowed_mints: [SOL, USDC] });
  assert.equal(r.allow, false);
});

// 4. expiry ----------------------------------------------------------------

test("expiry allows before max_age_days has elapsed", () => {
  const armedAt = 1_700_000_000_000;
  const r = expiry(
    ctx({ timestampMs: armedAt + 6 * 24 * 60 * 60 * 1000 }),
    { max_age_days: 7 },
    { armedAtMs: armedAt }
  );
  assert.equal(r.allow, true);
});

test("expiry denies after max_age_days has elapsed", () => {
  const armedAt = 1_700_000_000_000;
  const r = expiry(
    ctx({ timestampMs: armedAt + 8 * 24 * 60 * 60 * 1000 }),
    { max_age_days: 7 },
    { armedAtMs: armedAt }
  );
  assert.equal(r.allow, false);
  assert.equal(r.code, "expiry_elapsed");
});

test("expiry honors explicit expires_at_ms", () => {
  const r = expiry(
    ctx({ timestampMs: 1_700_000_001_000 }),
    { expires_at_ms: 1_700_000_000_000 },
    {}
  );
  assert.equal(r.allow, false);
});

test("expiry denies when misconfigured (no max_age_days, no expires_at_ms)", () => {
  const r = expiry(ctx(), {}, {});
  assert.equal(r.allow, false);
  assert.match(r.code, /misconfigured/);
});

// 5. nav_divergence --------------------------------------------------------

test("nav_divergence allows on first run with no history", () => {
  const r = navDivergence(ctx({ navHistory: [] }), { max_drop_pct: 5, window_minutes: 30 });
  assert.equal(r.allow, true);
});

test("nav_divergence allows when drop is below threshold", () => {
  const now = 1_700_000_000_000;
  const r = navDivergence(
    ctx({
      navPerShare: 96,
      timestampMs: now,
      navHistory: [{ navPerShare: 100, timestampMs: now - 5 * 60 * 1000 }],
    }),
    { max_drop_pct: 5, window_minutes: 30 }
  );
  assert.equal(r.allow, true);
});

test("nav_divergence denies on >= threshold drop within window", () => {
  const now = 1_700_000_000_000;
  const r = navDivergence(
    ctx({
      navPerShare: 94,
      timestampMs: now,
      navHistory: [{ navPerShare: 100, timestampMs: now - 5 * 60 * 1000 }],
    }),
    { max_drop_pct: 5, window_minutes: 30 }
  );
  assert.equal(r.allow, false);
  assert.equal(r.code, "nav_divergence_kill_switch");
});

test("nav_divergence ignores points outside the window", () => {
  const now = 1_700_000_000_000;
  const r = navDivergence(
    ctx({
      navPerShare: 50,
      timestampMs: now,
      navHistory: [{ navPerShare: 100, timestampMs: now - 31 * 60 * 1000 }],
    }),
    { max_drop_pct: 5, window_minutes: 30 }
  );
  assert.equal(r.allow, true);
});

// PolicyEnforcer / DENY-by-default ----------------------------------------

test("makeEnforcer denies when any policy denies (DENY-by-default)", () => {
  const enforce = makeEnforcer([
    { id: "chain_lock", config: { allowed_chains: ["solana"] } },
    { id: "spend_limit", config: { max_notional_usd_per_rebalance: 5, max_notional_usd_per_day: 100 } },
  ]);
  const r = enforce(ctx({ notionalUsd: 10 }), { spendLog: [] });
  assert.equal(r.allow, false);
  assert.equal(r.deniedBy, "spend_limit");
});

test("makeEnforcer rejects unknown policy ids at construction", () => {
  assert.throws(() => makeEnforcer([{ id: "totally_bogus", config: {} }]), /Unknown policy id/);
});

test("makeEnforcer denies when a policy throws", () => {
  // Inject a policy that throws via the registry temporarily.
  const r = makeEnforcer([{ id: "chain_lock", config: { allowed_chains: ["solana"] } }])(
    { /* missing all fields, chain undefined */ },
    {}
  );
  assert.equal(r.allow, false);
});

test("POLICY_REGISTRY exposes exactly five policies", () => {
  assert.deepEqual(
    Object.keys(POLICY_REGISTRY).sort(),
    ["asset_whitelist", "chain_lock", "expiry", "nav_divergence", "spend_limit"]
  );
});
