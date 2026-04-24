/**
 * sns-tree.test.ts — pure-function coverage for the SNS tree helpers.
 *
 * No RPC, no signers. Runs under `node --import tsx --test`.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  buildCreateData,
  deriveNameRecord,
  NAME_PROGRAM_ID,
} from "../src/sns-tree.js";

describe("sns-tree pure helpers", () => {
  it("derives stable PDA for a top-level label", () => {
    const a = deriveNameRecord("bundie", { programId: NAME_PROGRAM_ID });
    const b = deriveNameRecord("bundie", { programId: NAME_PROGRAM_ID });
    assert.equal(a.pda.toBase58(), b.pda.toBase58());
    assert.equal(a.hashed.length, 32);
  });

  it("different labels yield different PDAs", () => {
    const sol = deriveNameRecord("sol", { programId: NAME_PROGRAM_ID });
    const bundie = deriveNameRecord("bundie", { programId: NAME_PROGRAM_ID });
    assert.notEqual(sol.pda.toBase58(), bundie.pda.toBase58());
  });

  it("subdomain with parent differs from same-label root", () => {
    const parent = Keypair.generate().publicKey;
    const root = deriveNameRecord("bundie", { programId: NAME_PROGRAM_ID });
    const sub = deriveNameRecord("bundie", {
      programId: NAME_PROGRAM_ID,
      parent,
    });
    assert.notEqual(root.pda.toBase58(), sub.pda.toBase58());
  });

  it("null parent matches omitted parent (root form)", () => {
    const omitted = deriveNameRecord("sol", { programId: NAME_PROGRAM_ID });
    const nulled = deriveNameRecord("sol", {
      programId: NAME_PROGRAM_ID,
      parent: null,
    });
    assert.equal(omitted.pda.toBase58(), nulled.pda.toBase58());
  });

  it("custom hashPrefix alters the PDA", () => {
    const def = deriveNameRecord("bundie", { programId: NAME_PROGRAM_ID });
    const other = deriveNameRecord("bundie", {
      programId: NAME_PROGRAM_ID,
      hashPrefix: "Some Other Prefix",
    });
    assert.notEqual(def.pda.toBase58(), other.pda.toBase58());
  });

  it("buildCreateData produces the right length and tag", () => {
    const hashed = Buffer.from(new Uint8Array(32));
    const data = buildCreateData(hashed, 1000n, 256);
    assert.equal(data.length, 1 + 4 + 32 + 8 + 4);
    assert.equal(data[0], 0x00); // Create tag
    assert.equal(data.readUInt32LE(1), 32); // hashed length prefix
    assert.equal(data.readBigUInt64LE(1 + 4 + 32), 1000n);
    assert.equal(data.readUInt32LE(1 + 4 + 32 + 8), 256);
  });

  it("NAME_PROGRAM_ID is the canonical SPL Name Service pubkey", () => {
    assert.equal(
      NAME_PROGRAM_ID.toBase58(),
      "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX",
    );
    assert.ok(NAME_PROGRAM_ID instanceof PublicKey);
  });
});
