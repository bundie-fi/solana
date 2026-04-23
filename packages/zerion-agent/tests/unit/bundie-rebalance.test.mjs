/**
 * End-to-end smoke test for the rebalance loop with a mocked RPC + mocked
 * Zerion executor. Verifies the three task-mandated assertions:
 *
 *   - when composition drifts > 5%, the policy-enforced swap params are
 *     computed correctly
 *   - when spend_limit denies, no Zerion API call is attempted
 *   - when expiry has passed, no Zerion API call is attempted
 *
 * NO real RPC, NO real Zerion API call — the executor is a spy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  computeComposition,
  proposeRebalance,
  decodeStrategy,
  decodeNavOracle,
  STRATEGY_DISCRIMINATOR,
  NAV_ORACLE_DISCRIMINATOR,
  NAV_ORACLE_LEN,
} from "../../src/bundie/strategy-monitor.js";
import { runOnce, buildZerionSwapParams } from "../../src/bundie/rebalance-loop.js";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MSOL = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";

// Helpers — encode minimal Strategy + NavOracle byte buffers we can decode.
function encodeStrategy({ wallet, nameStr = "test-strat" }) {
  const buf = Buffer.alloc(330);
  STRATEGY_DISCRIMINATOR.copy(buf, 0);
  // authority (32) - all zeros is fine
  // mint (32) at 40
  Buffer.from(new PublicKey("11111111111111111111111111111112").toBytes()).copy(buf, 40);
  // wallet (32) at 72
  Buffer.from(new PublicKey(wallet).toBytes()).copy(buf, 72);
  // deposit_mint, protocol, reserve at 104, 136, 168 — leave zeros
  // name at 200
  Buffer.from(nameStr.padEnd(32, "\0")).copy(buf, 200);
  buf.writeUInt8(0, 232); // strategy_type
  buf.writeUInt8(0, 233); // status
  buf.writeUInt16LE(1000, 234); // fee_bps = 10%
  buf.writeBigUInt64LE(1_000_000n, 236); // total_deposits
  buf.writeBigUInt64LE(1_000_000n, 244); // current_nav
  buf.writeBigUInt64LE(1_000n, 252); // total_shares
  return buf;
}

function encodeNavOracle({ navPerShare = 1_000_000_000n }) {
  const buf = Buffer.alloc(NAV_ORACLE_LEN);
  NAV_ORACLE_DISCRIMINATOR.copy(buf, 0);
  // strategy field (zeros)
  buf.writeBigUInt64LE(navPerShare, 40);
  buf.writeBigUInt64LE(0n, 48);
  buf.writeBigUInt64LE(1n, 56);
  buf.writeBigUInt64LE(123n, 64);
  buf.writeBigUInt64LE(300n, 72);
  buf.writeBigUInt64LE(9000n, 80);
  buf.writeUInt8(255, 88);
  return buf;
}

// Make a connection mock that returns one Buffer per requested account.
function fakeConnection({ strategyBuf, navBuf, strategyPk, navPk }) {
  return {
    async getAccountInfo(pk) {
      const k = pk.toBase58();
      if (k === strategyPk) return { data: strategyBuf };
      if (k === navPk) return { data: navBuf };
      throw new Error(`Unexpected account ${k}`);
    },
  };
}

// --------------------------------------------------------------------------
// Decode round-trips
// --------------------------------------------------------------------------

test("decodeStrategy round-trips a manually encoded buffer", () => {
  const wallet = "11111111111111111111111111111113";
  const buf = encodeStrategy({ wallet });
  const s = decodeStrategy(buf);
  assert.equal(s.wallet, wallet);
  assert.equal(s.feeBps, 1000);
  assert.equal(s.totalDeposits, 1_000_000n);
  assert.equal(s.totalShares, 1_000n);
});

test("decodeNavOracle round-trips", () => {
  const buf = encodeNavOracle({ navPerShare: 1_234_567n });
  const n = decodeNavOracle(buf);
  assert.equal(n.navPerShare, 1_234_567n);
  assert.equal(n.bump, 255);
});

// --------------------------------------------------------------------------
// Composition + proposals
// --------------------------------------------------------------------------

test("computeComposition + proposeRebalance flag a drift > 5%", () => {
  const balances = {
    [SOL]:  { amount: 100 * 1e9, decimals: 9, usdPrice: 1, symbol: "SOL"  },  // $100 (50%)
    [USDC]: { amount:  20 * 1e6, decimals: 6, usdPrice: 1, symbol: "USDC" },  // $20  (10%)
    [MSOL]: { amount:  80 * 1e9, decimals: 9, usdPrice: 1, symbol: "mSOL" },  // $80  (40%)
  };
  // Target was 40/30/30 — SOL is over by 10pp, USDC is under by 20pp, mSOL is over by 10pp.
  const target = { [SOL]: 40, [USDC]: 30, [MSOL]: 30 };
  const composition = computeComposition(balances, target);
  assert.equal(composition.totalUsd, 200);
  assert.ok(composition.drift[USDC] < -5);
  const proposals = proposeRebalance(composition, { driftThresholdPct: 5, mintMeta: {} });
  assert.equal(proposals.length, 1);
  // Biggest over (SOL +10pp = $20), biggest under (USDC -20pp = $40) → notional = min = $20
  assert.equal(proposals[0].fromMint, SOL);
  assert.equal(proposals[0].toMint, USDC);
  assert.equal(proposals[0].notionalUsd, 20);
});

test("proposeRebalance returns nothing when within drift threshold", () => {
  const balances = {
    [SOL]:  { amount: 41 * 1e9, decimals: 9, usdPrice: 1 },
    [USDC]: { amount: 29 * 1e6, decimals: 6, usdPrice: 1 },
    [MSOL]: { amount: 30 * 1e9, decimals: 9, usdPrice: 1 },
  };
  const target = { [SOL]: 40, [USDC]: 30, [MSOL]: 30 };
  const proposals = proposeRebalance(computeComposition(balances, target), {
    driftThresholdPct: 5,
    mintMeta: {},
  });
  assert.equal(proposals.length, 0);
});

test("buildZerionSwapParams shape matches the Zerion CLI getSwapQuote signature", () => {
  const p = buildZerionSwapParams(
    { fromMint: SOL, toMint: USDC, fromSymbol: "SOL", toSymbol: "USDC", notionalUsd: 12.5 },
    { walletAddress: "WALLETPDA111", slippage: 1.5, chain: "solana" }
  );
  assert.equal(p.fromToken, "SOL");
  assert.equal(p.toToken, "USDC");
  assert.equal(p.fromChain, "solana");
  assert.equal(p.toChain, "solana");
  assert.equal(p.walletAddress, "WALLETPDA111");
  assert.equal(p.notionalUsd, 12.5);
  assert.equal(p.slippage, 1.5);
});

// --------------------------------------------------------------------------
// runOnce — full pipeline with mocked deps
// --------------------------------------------------------------------------

const STRATEGY_PK = "11111111111111111111111111111114";
const NAV_PK = "11111111111111111111111111111115";
const WALLET_PDA = "11111111111111111111111111111116";

function baseDeps({ executeSwap, navPerShare = 1_000_000_000n } = {}) {
  const calls = { swap: 0 };
  const logs = [];
  return {
    calls,
    logs,
    deps: {
      now: () => 1_700_000_000_000,
      connection: fakeConnection({
        strategyBuf: encodeStrategy({ wallet: WALLET_PDA }),
        navBuf: encodeNavOracle({ navPerShare }),
        strategyPk: STRATEGY_PK,
        navPk: NAV_PK,
      }),
      balanceProvider: async () => ({
        [SOL]:  { amount: 100 * 1e9, decimals: 9, usdPrice: 1, symbol: "SOL"  },
        [USDC]: { amount:  20 * 1e6, decimals: 6, usdPrice: 1, symbol: "USDC" },
        [MSOL]: { amount:  80 * 1e9, decimals: 9, usdPrice: 1, symbol: "mSOL" },
      }),
      executeSwap: executeSwap || (async (params) => {
        calls.swap++;
        return { hash: "TX_FAKE_HASH", status: "success", params };
      }),
      appendLog: (line) => logs.push(JSON.parse(line)),
    },
  };
}

function baseConfig(overrides = {}) {
  return {
    strategyPk: STRATEGY_PK,
    navOraclePk: NAV_PK,
    target: { [SOL]: 40, [USDC]: 30, [MSOL]: 30 },
    driftThresholdPct: 5,
    armedAtMs: 1_700_000_000_000 - 1 * 24 * 60 * 60 * 1000, // armed 1 day before now
    policies: [
      { id: "chain_lock",    config: { allowed_chains: ["solana"] } },
      { id: "spend_limit",   config: { max_notional_usd_per_rebalance: 100, max_notional_usd_per_day: 1000 } },
      { id: "asset_whitelist", config: { allowed_mints: [SOL, USDC, MSOL] } },
      { id: "expiry",        config: { max_age_days: 7 } },
      { id: "nav_divergence", config: { max_drop_pct: 5, window_minutes: 30 } },
    ],
    ...overrides,
  };
}

test("ASSERT-1: drift > 5% computes correct policy-enforced swap params and executes", async () => {
  const { deps, calls, logs } = baseDeps();
  const result = await runOnce(baseConfig(), deps);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].fromMint, SOL);
  assert.equal(result.proposals[0].toMint, USDC);
  assert.equal(result.proposals[0].notionalUsd, 20);
  assert.equal(calls.swap, 1, "executeSwap should be called exactly once when all policies allow");
  const exec = result.actions.find((a) => a.kind === "executed");
  assert.ok(exec, "expected an executed action record");
  assert.equal(exec.swapParams.walletAddress, WALLET_PDA);
  assert.equal(exec.swapParams.fromChain, "solana");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].kind, "executed");
});

test("ASSERT-2: spend_limit denial blocks any Zerion API call", async () => {
  const { deps, calls, logs } = baseDeps();
  const cfg = baseConfig({
    policies: [
      { id: "chain_lock",    config: { allowed_chains: ["solana"] } },
      { id: "spend_limit",   config: { max_notional_usd_per_rebalance: 5, max_notional_usd_per_day: 1000 } },
      { id: "asset_whitelist", config: { allowed_mints: [SOL, USDC, MSOL] } },
      { id: "expiry",        config: { max_age_days: 7 } },
      { id: "nav_divergence", config: { max_drop_pct: 5, window_minutes: 30 } },
    ],
  });
  const result = await runOnce(cfg, deps);
  assert.equal(calls.swap, 0, "executeSwap MUST NOT be called when spend_limit denies");
  const denied = result.actions.find((a) => a.kind === "denied");
  assert.ok(denied);
  assert.equal(denied.deniedBy, "spend_limit");
  assert.equal(logs[0].kind, "denied");
  assert.equal(logs[0].deniedBy, "spend_limit");
});

test("ASSERT-3: expired agent blocks any Zerion API call", async () => {
  const { deps, calls } = baseDeps();
  const cfg = baseConfig({
    armedAtMs: 1_700_000_000_000 - 8 * 24 * 60 * 60 * 1000, // 8 days ago
    policies: baseConfig().policies, // includes expiry max_age_days: 7
  });
  const result = await runOnce(cfg, deps);
  assert.equal(calls.swap, 0, "executeSwap MUST NOT be called when expiry has elapsed");
  const denied = result.actions.find((a) => a.kind === "denied");
  assert.ok(denied);
  assert.equal(denied.deniedBy, "expiry");
});

test("Within-threshold composition produces no proposals and no executions", async () => {
  const { calls, deps } = baseDeps();
  // Override balances to something close to target.
  const customDeps = {
    ...deps,
    balanceProvider: async () => ({
      [SOL]:  { amount: 41 * 1e9, decimals: 9, usdPrice: 1, symbol: "SOL"  },
      [USDC]: { amount: 30 * 1e6, decimals: 6, usdPrice: 1, symbol: "USDC" },
      [MSOL]: { amount: 29 * 1e9, decimals: 9, usdPrice: 1, symbol: "mSOL" },
    }),
  };
  const result = await runOnce(baseConfig(), customDeps);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.actions.length, 0);
  assert.equal(calls.swap, 0);
});

test("nav_divergence kill-switch blocks even when other policies pass", async () => {
  const { deps, calls } = baseDeps({ navPerShare: 800_000_000n });
  // Pre-load runtime navHistory so the divergence policy has a peak to compare to.
  const cfg = baseConfig();
  const runtimeIn = {
    spendLog: [],
    navHistory: [{ navPerShare: 1_000_000_000, timestampMs: 1_700_000_000_000 - 5 * 60 * 1000 }],
    armedAtMs: 1_699_999_000_000,
  };
  const result = await runOnce(cfg, deps, runtimeIn);
  assert.equal(calls.swap, 0);
  const denied = result.actions.find((a) => a.kind === "denied");
  assert.ok(denied);
  assert.equal(denied.deniedBy, "nav_divergence");
});
