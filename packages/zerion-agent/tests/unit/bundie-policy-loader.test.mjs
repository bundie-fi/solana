import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePolicyFile, loadPoliciesFromFile } from "../../src/bundie/policy-loader.js";

test("parsePolicyFile parses the example YAML structure", () => {
  const yaml = [
    "policies:",
    "  - id: chain_lock",
    "    config:",
    "      allowed_chains: [solana]",
    "  - id: spend_limit",
    "    config:",
    "      max_notional_usd_per_rebalance: 25",
    "      max_notional_usd_per_day: 100",
    "armed_at_ms: 1700000000000",
  ].join("\n");
  const parsed = parsePolicyFile(yaml, "policies.yaml");
  assert.ok(Array.isArray(parsed.policies));
  assert.equal(parsed.policies.length, 2);
  assert.equal(parsed.policies[0].id, "chain_lock");
  assert.deepEqual(parsed.policies[0].config.allowed_chains, ["solana"]);
  assert.equal(parsed.policies[1].config.max_notional_usd_per_day, 100);
  assert.equal(parsed.armed_at_ms, 1700000000000);
});

test("parsePolicyFile parses JSON when the filename ends in .json", () => {
  const json = JSON.stringify({
    policies: [{ id: "chain_lock", config: { allowed_chains: ["solana"] } }],
    armed_at_ms: 1,
  });
  const parsed = parsePolicyFile(json, "policies.json");
  assert.equal(parsed.policies[0].id, "chain_lock");
});

test("loadPoliciesFromFile rejects unknown policy ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "bundie-pol-"));
  const p = join(dir, "bad.yaml");
  writeFileSync(p, "policies:\n  - id: not_a_policy\n    config: {}\n");
  assert.throws(() => loadPoliciesFromFile(p), /Unknown policy id/);
});

test("loadPoliciesFromFile loads a complete file from disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "bundie-pol-"));
  const p = join(dir, "good.yaml");
  writeFileSync(
    p,
    [
      "policies:",
      "  - id: chain_lock",
      "    config:",
      "      allowed_chains: [solana]",
      "  - id: expiry",
      "    config:",
      "      max_age_days: 7",
      "armed_at_ms: 1700000000000",
    ].join("\n")
  );
  const { policies, armedAtMs } = loadPoliciesFromFile(p);
  assert.equal(policies.length, 2);
  assert.equal(armedAtMs, 1700000000000);
});
