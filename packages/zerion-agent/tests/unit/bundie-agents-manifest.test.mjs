import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { loadPoliciesFromFile } from "../../src/bundie/policy-loader.js";
import { makeEnforcer } from "../../src/bundie/policies.js";

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const ALICE = resolve(REPO_ROOT, "agents/alice.bundie.sol/policies.yaml");
const BOB = resolve(REPO_ROOT, "agents/bob.bundie.sol/policies.yaml");

describe("agent manifests", () => {
  test("alice.bundie.sol manifest parses + enforcer builds", () => {
    const { policies } = loadPoliciesFromFile(ALICE);
    assert.ok(policies.length >= 4, "alice should enable >= 4 predicates");
    const enforce = makeEnforcer(policies);
    assert.equal(typeof enforce, "function");
  });

  test("bob.bundie.sol manifest parses + enforcer builds", () => {
    const { policies } = loadPoliciesFromFile(BOB);
    assert.ok(policies.length >= 4, "bob should enable >= 4 predicates");
    const enforce = makeEnforcer(policies);
    assert.equal(typeof enforce, "function");
  });

  test("alice chain_lock rejects ethereum swap", () => {
    const { policies } = loadPoliciesFromFile(ALICE);
    // Swap-path: exclude program_allowlist (fast-path gate, not applicable to swaps)
    const enforce = makeEnforcer(policies.filter((p) => p.id !== "program_allowlist"));
    const ctx = {
      chain: "ethereum",
      fromMint: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC-ETH
      toMint: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
      fromSymbol: "USDC",
      toSymbol: "USDT",
      notionalUsd: 10,
      timestampMs: Date.now(),
      navPerShare: 1,
      navHistory: [],
    };
    const decision = enforce(ctx);
    assert.equal(decision.allow, false);
    assert.equal(decision.deniedBy, "chain_lock");
  });

  test("alice asset_whitelist rejects unknown mint", () => {
    const { policies } = loadPoliciesFromFile(ALICE);
    const enforce = makeEnforcer(policies.filter((p) => p.id !== "program_allowlist"));
    const ctx = {
      chain: "solana",
      fromMint: "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", // not in whitelist
      toMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      fromSymbol: "???",
      toSymbol: "USDC",
      notionalUsd: 5,
      timestampMs: Date.now(),
      navPerShare: 1,
      navHistory: [],
    };
    const decision = enforce(ctx);
    assert.equal(decision.allow, false);
    assert.equal(decision.deniedBy, "asset_whitelist");
  });

  test("alice allows usdc->mSOL within spend limit", () => {
    const { policies } = loadPoliciesFromFile(ALICE);
    const enforce = makeEnforcer(policies.filter((p) => p.id !== "program_allowlist"));
    const ctx = {
      chain: "solana",
      fromMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      toMint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
      fromSymbol: "USDC",
      toSymbol: "mSOL",
      notionalUsd: 5,
      timestampMs: Date.now(),
      navPerShare: 1,
      navHistory: [],
    };
    const runtime = { spendLog: [], navHistory: [], armedAtMs: Date.now() };
    const decision = enforce(ctx, runtime);
    assert.equal(decision.allow, true, JSON.stringify(decision));
  });
});
