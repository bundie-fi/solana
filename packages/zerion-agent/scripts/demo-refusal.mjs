#!/usr/bin/env node
/**
 * demo-refusal.mjs — Zerion bounty video script.
 *
 * Loads alice.bundie.sol's scoped policy manifest and runs three rebalance
 * proposals through the DENY-by-default enforcer:
 *
 *   1. solana usdc->mSOL, $5   — ALLOWED
 *   2. ethereum usdc->usdt, $5 — DENIED by chain_lock
 *   3. solana weird->usdc, $5  — DENIED by asset_whitelist
 *
 * Run:  node packages/zerion-agent/scripts/demo-refusal.mjs
 * Or:   pnpm --filter @bundie/zerion-agent demo:refusal
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPoliciesFromFile } from "../src/bundie/policy-loader.js";
import { makeEnforcer } from "../src/bundie/policies.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const ALICE_POLICIES = resolve(REPO_ROOT, "agents/alice.bundie.sol/policies.yaml");

function hr(label) {
  console.log("");
  console.log("─".repeat(72));
  console.log(`▸ ${label}`);
  console.log("─".repeat(72));
}

function printDecision(decision) {
  if (decision.allow) {
    console.log("✔ ALLOWED — Zerion vault would sign");
  } else {
    console.log(`✘ DENIED by policy: ${decision.deniedBy}`);
    const failed = decision.decisions.find((d) => !d.allow);
    if (failed) {
      console.log(`   code:   ${failed.code}`);
      console.log(`   reason: ${failed.reason}`);
    }
  }
}

const NOW = Date.now();

function ctx(overrides) {
  return {
    chain: "solana",
    fromMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    toMint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    fromSymbol: "USDC",
    toSymbol: "mSOL",
    notionalUsd: 5,
    timestampMs: NOW,
    navPerShare: 1,
    navHistory: [],
    ...overrides,
  };
}

function runtime() {
  return { spendLog: [], navHistory: [], armedAtMs: NOW };
}

async function main() {
  console.log(`\nLoading policies from ${ALICE_POLICIES}`);
  const { policies } = loadPoliciesFromFile(ALICE_POLICIES);
  // Swap-only predicates for the refusal demo. program_allowlist is a
  // non-swap gate (guards create_market_v2 etc) enforced via the
  // enforceProgramPolicy() fast-path; running it here against swap
  // contexts would incorrectly deny every swap.
  const swapPolicies = policies.filter((p) => p.id !== "program_allowlist");
  console.log(`Enabled predicates (swap path): ${swapPolicies.map((p) => p.id).join(", ")}`);
  console.log(`Non-swap predicates (fast-path): ${policies.filter((p) => p.id === "program_allowlist").map((p) => p.id).join(", ") || "(none)"}`);
  const enforce = makeEnforcer(swapPolicies);

  hr("Attempt 1 — solana usdc->mSOL, $5 (in-scope)");
  printDecision(enforce(ctx(), runtime()));

  hr("Attempt 2 — ethereum usdc->usdt, $5 (wrong chain)");
  printDecision(
    enforce(
      ctx({
        chain: "ethereum",
        fromMint: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        toMint: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        fromSymbol: "USDC",
        toSymbol: "USDT",
      }),
      runtime()
    )
  );

  hr("Attempt 3 — solana unknown->usdc, $5 (unlisted mint)");
  printDecision(
    enforce(
      ctx({
        fromMint: "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
        fromSymbol: "???",
        toMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        toSymbol: "USDC",
      }),
      runtime()
    )
  );

  console.log("\nRefusal demo complete.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
