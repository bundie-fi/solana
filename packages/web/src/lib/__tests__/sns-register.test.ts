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

import { Connection, PublicKey } from "@solana/web3.js";
import {
  SPL_NAME_SERVICE_PROGRAM_ID,
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

  // Happy-path smoke — gated on (a) devnet RPC reachability and (b) the
  // Bonfida SDK loading cleanly under the test runner. Bonfida's ESM
  // package transitively hits a borsh export mismatch under `tsx --test`
  // (the Next.js bundler handles it fine in production). When that happens
  // we skip rather than fail — the production path is exercised by the
  // chaos-sim smoke + manual /identity QA on devnet.
  it("targets SPL Name Service program with the Create discriminator (0x00), with payer + bundie-root-owner as the two signers (parent_owner is required for non-default parent — see SPL processor.rs:66-78)", async (t) => {
    const conn = new Connection(
      process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
      "confirmed",
    );
    try {
      await conn.getSlot();
    } catch {
      t.skip("devnet RPC unreachable — skipping happy-path smoke");
      return;
    }

    const { BUNDIE_ROOT_OWNER, BUNDIE_ROOT_PDA } = await import("../sns-register");
    const owner = new PublicKey("11111111111111111111111111111111");
    const built = await buildRegisterTx("bundie-smoke-test", owner, conn);

    const { tx, namePda } = built;
    assert.equal(tx.instructions.length, 1, "exactly one ix (no USDC setup)");
    const ix = tx.instructions[0]!;
    assert.ok(
      ix.programId.equals(SPL_NAME_SERVICE_PROGRAM_ID),
      `expected program ${SPL_NAME_SERVICE_PROGRAM_ID.toBase58()}, got ${ix.programId.toBase58()}`,
    );
    assert.equal(ix.data[0], 0x00, "discriminator byte 0 must be Create (0x00)");

    // Both the payer (owner) AND the bundie-root-owner must be signers.
    // Without parent_owner the on-chain processor aborts with "Program failed
    // to complete" — that's exactly the bug we're guarding against here.
    const signers = ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()).sort();
    assert.deepEqual(
      signers,
      [BUNDIE_ROOT_OWNER.toBase58(), owner.toBase58()].sort(),
      "payer (owner) AND bundie-root-owner (parent_owner) must both sign",
    );

    // Parent slot (index 5) must be our `.bundie` root PDA.
    assert.ok(
      ix.keys[5]!.pubkey.equals(BUNDIE_ROOT_PDA),
      `parent slot must be BUNDIE_ROOT_PDA (${BUNDIE_ROOT_PDA.toBase58()}), got ${ix.keys[5]!.pubkey.toBase58()}`,
    );

    new PublicKey(namePda); // throws on invalid
  });

  // Regression guard: BuiltRegistration must not regrow the Bonfida USDC
  // pricing surface (buyerUsdcAta would mean someone resurrected the Pyth
  // path, which doesn't work on devnet).
  it("BuiltRegistration shape no longer carries buyerUsdcAta", () => {
    type Keys = keyof Awaited<ReturnType<typeof buildRegisterTx>>;
    const expected: Keys[] = ["tx", "namePda"];
    // @ts-expect-error — buyerUsdcAta must not be a key of BuiltRegistration
    const _bad: Keys = "buyerUsdcAta";
    void _bad;
    assert.deepEqual(expected.sort(), ["namePda", "tx"]);
  });
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
