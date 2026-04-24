/**
 * Unit tests for the fast-path enforceProgramPolicy gate.
 *
 * Covers:
 *   - loads alice's real policies.yaml, asserts the PM program's
 *     create_market_v2 passes the gate
 *   - asserts an unknown programId + ix throws with a "DENIED" message and
 *     carries structured err.code / err.reason / err.deniedBy fields
 *   - asserts a policies file that lacks program_allowlist is rejected
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { enforceProgramPolicy } from "../../src/bundie/program-enforcer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const ALICE_POLICIES = resolve(REPO_ROOT, "agents/alice.bundie.sol/policies.yaml");

const PM_PROGRAM = "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4";

test("enforceProgramPolicy passes for alice's real policies.yaml on create_market_v2", () => {
  assert.doesNotThrow(() =>
    enforceProgramPolicy({
      policyPath: ALICE_POLICIES,
      programId: PM_PROGRAM,
      instructionName: "create_market_v2",
    }),
  );
});

test("enforceProgramPolicy throws DENIED for an unknown program", () => {
  let caught;
  try {
    enforceProgramPolicy({
      policyPath: ALICE_POLICIES,
      programId: "SomeRandomPubkey111111111111111111111111111",
      instructionName: "swap",
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected enforceProgramPolicy to throw");
  assert.match(caught.message, /DENIED/);
  assert.equal(caught.deniedBy, "program_allowlist");
  assert.equal(caught.code, "program_allowlist_unknown_program");
  assert.ok(typeof caught.reason === "string" && caught.reason.length > 0);
});

test("enforceProgramPolicy throws DENIED for a listed program but disallowed ix", () => {
  let caught;
  try {
    enforceProgramPolicy({
      policyPath: ALICE_POLICIES,
      programId: PM_PROGRAM,
      instructionName: "nuke_the_world",
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught);
  assert.equal(caught.code, "program_allowlist_ix_not_permitted");
});

test("enforceProgramPolicy rejects a policy file that lacks program_allowlist", () => {
  const dir = mkdtempSync(join(tmpdir(), "bundie-enf-"));
  const p = join(dir, "swap-only.yaml");
  writeFileSync(
    p,
    [
      "policies:",
      "  - id: chain_lock",
      "    config:",
      "      allowed_chains: [solana]",
    ].join("\n"),
  );
  assert.throws(
    () =>
      enforceProgramPolicy({
        policyPath: p,
        programId: PM_PROGRAM,
        instructionName: "create_market_v2",
      }),
    /no program_allowlist predicate/,
  );
});

test("enforceProgramPolicy validates its own inputs", () => {
  assert.throws(
    () => enforceProgramPolicy({ policyPath: "", programId: PM_PROGRAM, instructionName: "x" }),
    /policyPath is required/,
  );
  assert.throws(
    () => enforceProgramPolicy({ policyPath: ALICE_POLICIES, programId: "", instructionName: "x" }),
    /programId is required/,
  );
  assert.throws(
    () => enforceProgramPolicy({ policyPath: ALICE_POLICIES, programId: PM_PROGRAM, instructionName: "" }),
    /instructionName is required/,
  );
});
