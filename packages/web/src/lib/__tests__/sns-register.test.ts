/**
 * Smoke tests for lib/sns-register.ts and lib/sns.ts.
 *
 * Runs under plain `node --import tsx --test` — no vitest in the repo yet,
 * so we use the built-in node:test runner. These tests are "no-RPC": every
 * Bonfida SDK call is dynamically imported INSIDE checkAvailability /
 * buildRegisterTx, which means we can probe the pure-validation paths
 * without hitting devnet.
 *
 * Run with:
 *   cd packages/web && npx tsx --test src/lib/__tests__/sns-register.test.ts
 *
 * This file is not part of the Next.js build — it lives under a test-only
 * folder name (`__tests__`) and isn't imported by any page.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { PublicKey } from "@solana/web3.js";
import {
  buildRegisterTx,
  checkAvailability,
  validateName,
} from "../sns-register";
import { _resetSnsCache, lookupSnsForAddress, truncatePubkey } from "../sns";

describe("validateName (pure regex)", () => {
  it("rejects empty", () => {
    assert.equal(validateName("").ok, false);
  });
  it("rejects too short", () => {
    assert.equal(validateName("ab").ok, false);
  });
  it("normalizes uppercase by lowercasing (so 'Alpha' is valid)", () => {
    // The UX coerces to lowercase before checking — this matches the input
    // field's onChange handler which also lowercases. The on-chain registry
    // is case-insensitive in practice (Bonfida hashes the lowercase form).
    assert.equal(validateName("Alpha").ok, true);
  });
  it("rejects special chars", () => {
    assert.equal(validateName("alpha!").ok, false);
    assert.equal(validateName("alpha.hunter").ok, false);
    assert.equal(validateName("alpha hunter").ok, false);
    assert.equal(validateName("alpha_hunter").ok, false);
  });
  it("rejects leading/trailing/double dashes", () => {
    assert.equal(validateName("-alpha").ok, false);
    assert.equal(validateName("alpha-").ok, false);
    assert.equal(validateName("al--pha").ok, false);
  });
  it("accepts canonical", () => {
    assert.equal(validateName("alpha").ok, true);
    assert.equal(validateName("alpha-hunter").ok, true);
    assert.equal(validateName("alpha-hunter-7").ok, true);
    assert.equal(validateName("a1b2c3").ok, true);
  });
  it("rejects too long (>32)", () => {
    assert.equal(validateName("a".repeat(33)).ok, false);
  });
});

describe("checkAvailability — invalid path is no-RPC", () => {
  it("returns 'invalid' for a name with special chars without hitting RPC", async () => {
    const result = await checkAvailability("not.a.name!");
    assert.equal(result.state, "invalid");
    if (result.state === "invalid") {
      assert.match(result.reason, /single dashes only|Invalid|short|long/i);
    }
  });
  it("returns 'invalid' for empty input", async () => {
    const result = await checkAvailability("");
    assert.equal(result.state, "invalid");
  });
});

describe("buildRegisterTx", () => {
  it("rejects invalid names before touching RPC", async () => {
    const owner = new PublicKey("11111111111111111111111111111111");
    await assert.rejects(() => buildRegisterTx("AB", owner));
    await assert.rejects(() => buildRegisterTx("bad name", owner));
  });
  // NOTE: We intentionally do not test the happy path here because
  // buildRegisterTx calls into Bonfida's devnet binding which performs an
  // RPC call to fetch rent exemption. That requires network access and
  // belongs in an integration test, not this no-RPC smoke suite.
});

describe("lookupSnsForAddress fallback behavior", () => {
  it("returns null for an empty input (no RPC)", async () => {
    _resetSnsCache();
    const r = await lookupSnsForAddress("");
    assert.equal(r, null);
  });
  it("returns null for an invalid base58 (negative-cached, no crash)", async () => {
    _resetSnsCache();
    const r = await lookupSnsForAddress("not-a-pubkey");
    assert.equal(r, null);
  });
});

describe("truncatePubkey", () => {
  it("preserves short addresses", () => {
    assert.equal(truncatePubkey("abc"), "abc");
  });
  it("truncates long addresses with ellipsis", () => {
    const out = truncatePubkey("11111111111111111111111111111111");
    assert.match(out, /…/);
    assert.ok(out.length < 32);
  });
});
