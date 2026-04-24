/**
 * Unit tests for the Bundie agent vault primitives + the CLI surface
 * that wraps them (`agent create`, `agent list`, `agent sign`,
 * `chaos-sim-migrate`).
 *
 * Strategy:
 *   - Mock the OWS vault filesystem by pointing OWS at a tmpdir via the
 *     `BUNDIE_AGENT_VAULT_PATH` env var (OWS supports `vaultPathOpt` on
 *     every public function — see node_modules/@open-wallet-standard/core/
 *     index.d.ts:48).
 *   - Use a fixed `BUNDIE_AGENT_PASSPHRASE` so unattended sign works.
 *   - Each test uses its own tmpdir so they're hermetic + parallel-safe.
 *
 * What we assert:
 *   1. `createAgent(role)` produces a vault entry with a Solana pubkey.
 *   2. `listAgents()` returns it (filters by `bundie/` prefix).
 *   3. `getAgent(role)` throws when missing (DENY-by-default).
 *   4. `signSolanaTx(role, b64)` returns a base64 string of the same length
 *      class as a signed Solana tx (>= 64 bytes / 88 base64 chars).
 *   5. `importAgentFromKey(role, secretBytes)` is idempotent — re-importing
 *      the same role doesn't duplicate or overwrite.
 *   6. CLI `agent create` + `agent list` round-trip via stdout JSON.
 *   7. CLI `chaos-sim-migrate` is idempotent across runs and skips files
 *      whose roles already exist in the vault.
 *   8. CLI `agent sign` for a missing role raises (DENY-by-default).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Keypair, Transaction, SystemProgram, PublicKey } from "@solana/web3.js";

const execFileP = promisify(execFile);

const CLI_BIN = fileURLToPath(import.meta.resolve("../../src/cli.js"));
const VAULT_MODULE = "../../src/bundie/agent-vault.js";

function freshVaultEnv() {
  const dir = mkdtempSync(join(tmpdir(), "bundie-vault-"));
  return {
    BUNDIE_AGENT_VAULT_PATH: dir,
    BUNDIE_AGENT_PASSPHRASE: "",
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

/**
 * Re-import the agent-vault module fresh after setting env vars. Node's
 * module cache means a single import can't see different env values
 * across tests; using `?cb=<n>` on the URL bypasses the cache. (We also
 * set process.env BEFORE calling, since the module reads env eagerly on
 * each call — but caching also matters for the OWS native binding's
 * behaviour at first-call time.)
 */
async function loadVault() {
  // The vault module reads env vars per-call (see vaultPath() / passphrase()
  // helpers), so a single import suffices. We add a cache buster to avoid
  // OWS state from a previous test polluting this one if Node ever decides
  // to reuse a transient binding.
  const url = new URL(VAULT_MODULE, import.meta.url);
  url.search = `?cb=${Date.now()}_${Math.random()}`;
  return import(url.href);
}

function buildDummyTx(payerPubkeyB58) {
  // Minimal Solana tx: a single SystemProgram.transfer to itself, with a
  // fake blockhash. We only care that it serializes; OWS will sign it.
  const payer = new PublicKey(payerPubkeyB58);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: payer,
      lamports: 1,
    }),
  );
  tx.feePayer = payer;
  // Any 32-byte base58 string works as a blockhash for the serializer.
  tx.recentBlockhash = "11111111111111111111111111111111";
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

// ---- 1. createAgent / listAgents / getAgent / hasAgent --------------------

test("createAgent provisions a vault entry with a Solana pubkey", async () => {
  const env = freshVaultEnv();
  Object.assign(process.env, {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  });
  try {
    const { createAgent, listAgents, hasAgent } = await loadVault();
    const before = listAgents();
    assert.equal(before.length, 0, "vault starts empty");

    const created = createAgent("creator-0");
    assert.equal(created.role, "creator-0");
    assert.equal(created.vaultName, "bundie/creator-0");
    assert.match(created.pubkey, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

    assert.equal(hasAgent("creator-0"), true);

    const after = listAgents();
    assert.equal(after.length, 1);
    assert.equal(after[0].role, "creator-0");
  } finally {
    env.cleanup();
  }
});

test("createAgent is idempotent — re-creating returns the existing pubkey", async () => {
  const env = freshVaultEnv();
  Object.assign(process.env, {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  });
  try {
    const { createAgent } = await loadVault();
    const first = createAgent("trader-7");
    const second = createAgent("trader-7");
    assert.equal(first.pubkey, second.pubkey);
    assert.equal(first.vaultName, second.vaultName);
  } finally {
    env.cleanup();
  }
});

test("getAgent throws for a missing role (DENY-by-default)", async () => {
  const env = freshVaultEnv();
  Object.assign(process.env, {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  });
  try {
    const { getAgent, hasAgent } = await loadVault();
    assert.equal(hasAgent("nonexistent"), false);
    assert.throws(() => getAgent("nonexistent"), /not in the Zerion vault/i);
  } finally {
    env.cleanup();
  }
});

test("listAgents filters by bundie/ prefix", async () => {
  const env = freshVaultEnv();
  Object.assign(process.env, {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  });
  try {
    const { createAgent, listAgents } = await loadVault();
    // Create a Bundie agent and a non-Bundie wallet via direct OWS.
    createAgent("trader-0");
    const ows = await import("@open-wallet-standard/core");
    ows.createWallet("not-bundie", "", undefined, env.BUNDIE_AGENT_VAULT_PATH);
    const list = listAgents();
    assert.equal(list.length, 1);
    assert.equal(list[0].role, "trader-0");
  } finally {
    env.cleanup();
  }
});

// ---- 2. signSolanaTx ------------------------------------------------------

test("signSolanaTx returns base64 signed tx bytes for a valid agent + tx", async () => {
  const env = freshVaultEnv();
  Object.assign(process.env, {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  });
  try {
    const { createAgent, signSolanaTx } = await loadVault();
    const a = createAgent("signer-test");
    const dummyB64 = buildDummyTx(a.pubkey);
    const signedB64 = signSolanaTx("signer-test", dummyB64);
    assert.equal(typeof signedB64, "string");
    // A signed Solana tx is at minimum 64 (sig) + serialized message bytes;
    // base64-encoded that's at least 88 chars and longer than the unsigned
    // tx since the sig slot is no longer zero-filled (still same length but
    // bytes change). Verify it's parsable back into a Transaction.
    const raw = Buffer.from(signedB64, "base64");
    assert.ok(raw.length >= 64, "signed tx should be at least one signature long");
    const tx = Transaction.from(raw);
    assert.equal(tx.signatures.length, 1);
    assert.ok(
      tx.signatures[0].signature && tx.signatures[0].signature.length === 64,
      "agent's positional signature should be filled in",
    );
  } finally {
    env.cleanup();
  }
});

test("signSolanaTx throws (DENY-by-default) when role is not in the vault", async () => {
  const env = freshVaultEnv();
  Object.assign(process.env, {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  });
  try {
    const { signSolanaTx } = await loadVault();
    // Build a tx with a random pubkey — but there's no agent in the vault.
    const dummyB58 = Keypair.generate().publicKey.toBase58();
    const b64 = buildDummyTx(dummyB58);
    assert.throws(() => signSolanaTx("ghost", b64), /not in the Zerion vault/i);
  } finally {
    env.cleanup();
  }
});

// ---- 3. importAgentFromKey ------------------------------------------------

test("importAgentFromKey is idempotent and matches Keypair.fromSecretKey pubkey", async () => {
  const env = freshVaultEnv();
  Object.assign(process.env, {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  });
  try {
    const { importAgentFromKey, listAgents } = await loadVault();
    const kp = Keypair.generate();
    const expectedPub = kp.publicKey.toBase58();
    const bytes = Array.from(kp.secretKey);

    const first = importAgentFromKey("legacy-creator-0", bytes);
    assert.equal(first.pubkey, expectedPub, "imported pubkey must match the original keypair");

    const second = importAgentFromKey("legacy-creator-0", bytes);
    assert.equal(second.pubkey, expectedPub, "re-import should not change the pubkey");

    const list = listAgents();
    assert.equal(list.length, 1, "re-import should not duplicate the entry");
  } finally {
    env.cleanup();
  }
});

// ---- 4. CLI: agent create + agent list ------------------------------------

function runCli(args, env) {
  return execFileP("node", [CLI_BIN, ...args], { env: { ...process.env, ...env } });
}

test("CLI: `agent create` then `agent list` round-trips a vault entry", async () => {
  const env = freshVaultEnv();
  const e = {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  };
  try {
    const { stdout: createOut } = await runCli(
      ["agent", "create", "--name", "creator-3"],
      e,
    );
    const created = JSON.parse(createOut);
    assert.equal(created.ok, true);
    assert.equal(created.role, "creator-3");
    assert.match(created.pubkey, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

    const { stdout: listOut } = await runCli(["agent", "list"], e);
    const listed = JSON.parse(listOut);
    assert.equal(listed.ok, true);
    assert.equal(listed.count, 1);
    assert.equal(listed.agents[0].role, "creator-3");
    assert.equal(listed.agents[0].pubkey, created.pubkey);
  } finally {
    env.cleanup();
  }
});

test("CLI: `agent sign` for an unknown role exits non-zero with a DENY error", async () => {
  const env = freshVaultEnv();
  const e = {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  };
  try {
    const dummyB58 = Keypair.generate().publicKey.toBase58();
    const b64 = buildDummyTx(dummyB58);
    let threw = false;
    try {
      await runCli(["agent", "sign", "--name", "missing", "--tx", b64], e);
    } catch (err) {
      threw = true;
      // error.stderr is JSON envelope from printErr
      const parsed = JSON.parse(err.stderr);
      assert.equal(parsed.error.code, "cli_error");
      assert.match(parsed.error.message, /not in the Zerion vault/i);
    }
    assert.equal(threw, true, "agent sign for unknown role must exit non-zero");
  } finally {
    env.cleanup();
  }
});

// ---- 5. chaos-sim-migrate -------------------------------------------------

test("CLI: `chaos-sim-migrate` imports keys/*.json into the vault and is idempotent", async () => {
  const env = freshVaultEnv();
  const e = {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  };
  // Build a tmp keys dir with two role files + an agent-names.json.
  const keysDir = mkdtempSync(join(tmpdir(), "bundie-keys-"));
  try {
    const k0 = Keypair.generate();
    const k1 = Keypair.generate();
    writeFileSync(join(keysDir, "creator-0.json"), JSON.stringify(Array.from(k0.secretKey)));
    writeFileSync(join(keysDir, "trader-0.json"), JSON.stringify(Array.from(k1.secretKey)));
    writeFileSync(
      join(keysDir, "agent-names.json"),
      JSON.stringify({
        agents: {
          "creator-0": { name: "alpha", pubkey: k0.publicKey.toBase58() },
          "trader-0": { name: "beta", pubkey: k1.publicKey.toBase58() },
        },
      }),
    );

    const { stdout: first } = await runCli(
      ["chaos-sim-migrate", "--keys-dir", keysDir],
      e,
    );
    const r1 = JSON.parse(first);
    assert.equal(r1.ok, true);
    assert.equal(r1.migrated, 2);
    assert.equal(r1.alreadyInVault, 0);
    assert.equal(r1.failed, 0);
    // Pubkeys must round-trip: imported pubkey == Keypair.fromSecretKey pubkey.
    const c0 = r1.results.find((x) => x.role === "creator-0");
    assert.equal(c0.pubkey, k0.publicKey.toBase58());

    // Files left on disk (the spec REQUIRES they're not auto-deleted).
    assert.ok(existsSync(join(keysDir, "creator-0.json")), "creator-0.json must remain on disk");
    assert.ok(existsSync(join(keysDir, "trader-0.json")), "trader-0.json must remain on disk");

    // Re-run: idempotent.
    const { stdout: second } = await runCli(
      ["chaos-sim-migrate", "--keys-dir", keysDir],
      e,
    );
    const r2 = JSON.parse(second);
    assert.equal(r2.ok, true);
    assert.equal(r2.migrated, 0, "second run must not import anything new");
    assert.equal(r2.alreadyInVault, 2, "second run reports both as already in vault");
    assert.equal(r2.failed, 0);
  } finally {
    env.cleanup();
    rmSync(keysDir, { recursive: true, force: true });
  }
});

// ---- 6. setupPool() shape (chaos-sim integration smoke) -------------------
//
// We can't import the chaos-sim TS source here without spinning up tsx, but
// we CAN assert that the wallet vault exposes a stable shape that matches
// the ChaosWallet contract. The integration spec for `signWith: 'zerion-vault'`
// is asserted indirectly: every vault entry returned by listAgents() carries
// a role + pubkey, which is exactly what the chaos-sim wallets.ts maps to
// `{ role, pubkeyB58, signWith: 'zerion-vault' }`.

test("listAgents returns the shape that chaos-sim setupPool() expects", async () => {
  const env = freshVaultEnv();
  Object.assign(process.env, {
    BUNDIE_AGENT_VAULT_PATH: env.BUNDIE_AGENT_VAULT_PATH,
    BUNDIE_AGENT_PASSPHRASE: env.BUNDIE_AGENT_PASSPHRASE,
  });
  try {
    const { createAgent, listAgents } = await loadVault();
    createAgent("creator-0");
    createAgent("trader-2");
    const list = listAgents();
    // Sorted by role name.
    assert.deepEqual(list.map((a) => a.role).sort(), ["creator-0", "trader-2"]);
    for (const a of list) {
      assert.equal(typeof a.role, "string");
      assert.equal(typeof a.pubkey, "string");
      assert.match(a.pubkey, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      assert.equal(typeof a.vaultName, "string");
      assert.ok(a.vaultName.startsWith("bundie/"));
    }
  } finally {
    env.cleanup();
  }
});
