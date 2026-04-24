/**
 * agent-vault.js — Bundie agent wallet primitives on top of OWS.
 *
 * Bundie agents (chaos-sim creators/traders, future autonomous agents, etc.)
 * are NOT raw `Keypair.generate()` outputs — every agent is a Zerion-managed
 * vault wallet. This module wraps the OWS (`@open-wallet-standard/core`)
 * Solana primitives so the rest of the codebase (chaos-sim, future agents)
 * sees a Bundie-shaped API:
 *
 *   - createAgent(role)          → vault wallet (returns pubkey only — NO secret)
 *   - listAgents()               → all agents currently in the vault
 *   - getAgent(role)             → metadata for one agent (NO secret)
 *   - signSolanaTx(role, b64Tx)  → Zerion-signed tx, base64-encoded
 *   - importAgentFromKey(role, secretBytes)
 *                                → migrate an existing keys/<role>.json into the vault
 *
 * Naming convention: every agent's vault wallet is named `bundie/<role>`
 * (e.g. `bundie/creator-0`, `bundie/trader-3`). The prefix lets us filter
 * `ows.listWallets()` cleanly without depending on a metadata-tag feature
 * the OWS Rust core does not currently expose.
 *
 * --- Vault location ---
 * OWS keeps wallets under `~/.ows/wallets/` by default (one encrypted file
 * per wallet). For tests we override via the `BUNDIE_AGENT_VAULT_PATH`
 * env var — when set, every OWS call is routed through that path so tests
 * never touch the user's real vault. The OWS Rust core supports this via
 * the trailing `vaultPathOpt` argument on every public function.
 *
 * --- Passphrase ---
 * Bundie agent wallets are unattended (chaos-sim runs in CI). We use the
 * `BUNDIE_AGENT_PASSPHRASE` env var as the single passphrase for every
 * agent in the vault — that's safe-enough for devnet automation but
 * documented loud-and-clear in the README. NEVER hard-code or log the
 * passphrase value.
 *
 * --- Hard rules ---
 * 1. Never write secret material to stdout/stderr.
 * 2. DENY-by-default: if a requested agent is not in the vault, throw —
 *    never silently create one. Callers must explicitly call createAgent.
 * 3. Idempotency: createAgent returns the existing entry if the role is
 *    already in the vault (vs throwing "wallet exists").
 */

import * as ows from "@open-wallet-standard/core";
import { Transaction, PublicKey } from "@solana/web3.js";

/** Prefix every Bundie agent wallet name with this so listAgents() can
 *  filter the vault without a metadata-tag feature. */
export const BUNDIE_PREFIX = "bundie/";

/** Default env var for the unattended-signing passphrase. */
export const PASSPHRASE_ENV = "BUNDIE_AGENT_PASSPHRASE";

/** Optional env var to override the OWS vault path (used by tests). */
export const VAULT_PATH_ENV = "BUNDIE_AGENT_VAULT_PATH";

function vaultPath() {
  return process.env[VAULT_PATH_ENV] || undefined;
}

function passphrase() {
  // Empty string is allowed for ZERO-passphrase wallets (e.g. CI). null tells
  // OWS to skip passphrase encryption entirely. We pass through what's set.
  return process.env[PASSPHRASE_ENV] ?? "";
}

function vaultName(role) {
  if (typeof role !== "string" || !role.length) {
    throw new Error("Role must be a non-empty string");
  }
  return role.startsWith(BUNDIE_PREFIX) ? role : `${BUNDIE_PREFIX}${role}`;
}

function unprefix(name) {
  return name.startsWith(BUNDIE_PREFIX) ? name.slice(BUNDIE_PREFIX.length) : name;
}

function extractSolAddress(wallet) {
  const acc = wallet.accounts.find((a) => a.chainId.startsWith("solana:"));
  if (!acc) {
    throw new Error(
      `Wallet "${wallet.name}" has no solana account — vault may be misconfigured`,
    );
  }
  return acc.address;
}

function shape(wallet) {
  return {
    role: unprefix(wallet.name),
    vaultName: wallet.name,
    pubkey: extractSolAddress(wallet),
    walletId: wallet.id,
    createdAt: wallet.createdAt,
  };
}

/**
 * Look up a single agent in the vault by role. Returns null when missing —
 * callers MUST decide whether to throw, fall back to a file, or create.
 */
export function findAgent(role) {
  const name = vaultName(role);
  try {
    const w = ows.getWallet(name, vaultPath());
    return shape(w);
  } catch (err) {
    if (/not found|no such/i.test(err.message)) return null;
    throw err;
  }
}

/**
 * DENY-by-default lookup — throws if missing.
 */
export function getAgent(role) {
  const found = findAgent(role);
  if (!found) {
    throw new Error(
      `Bundie agent "${role}" is not in the Zerion vault. Run \`zerion-bundie agent create --name ${role}\` first.`,
    );
  }
  return found;
}

/**
 * Create a new Bundie agent in the vault.
 *
 * Idempotent: if an agent with the same role already exists, returns the
 * existing record instead of throwing.
 */
export function createAgent(role) {
  const existing = findAgent(role);
  if (existing) return existing;
  const name = vaultName(role);
  const w = ows.createWallet(name, passphrase(), undefined, vaultPath());
  return shape(w);
}

/**
 * Import an existing keypair into the vault under the given role.
 *
 * `secretBytes` must be the 64-byte Solana secret-key array (the format
 * `Keypair.fromSecretKey` expects, AND the format chaos-sim's keys/*.json
 * files store). We extract the first 32 bytes (the ed25519 seed) and hand
 * them to OWS as hex. OWS derives the matching public key.
 *
 * If the role already exists in the vault, returns the existing record
 * (idempotent) — does NOT overwrite. To replace, delete first via
 * `zerion wallet delete <name>`.
 */
export function importAgentFromKey(role, secretBytes) {
  const existing = findAgent(role);
  if (existing) return existing;
  if (!Array.isArray(secretBytes) && !(secretBytes instanceof Uint8Array)) {
    throw new Error("secretBytes must be a Uint8Array or number[] of length 64 or 32");
  }
  const arr = Array.from(secretBytes);
  if (arr.length !== 64 && arr.length !== 32) {
    throw new Error(`secretBytes length must be 32 or 64; got ${arr.length}`);
  }
  const seed = arr.length === 64 ? arr.slice(0, 32) : arr;
  const hex = Buffer.from(seed).toString("hex");
  const name = vaultName(role);
  const w = ows.importWalletPrivateKey(
    name,
    hex,
    passphrase(),
    vaultPath(),
    "solana",
  );
  return shape(w);
}

/**
 * List all Bundie agents currently in the vault. Filters by name prefix.
 */
export function listAgents() {
  const all = ows.listWallets(vaultPath());
  return all
    .filter((w) => w.name.startsWith(BUNDIE_PREFIX))
    .map(shape)
    .sort((a, b) => a.role.localeCompare(b.role));
}

/**
 * Sign a base64-encoded Solana transaction with the named agent's vault key.
 *
 * Returns the fully signed tx, base64-encoded, ready for
 * `Connection.sendRawTransaction(Buffer.from(out, 'base64'))`.
 *
 * --- Why the merge step ---
 * OWS's `signTransaction(wallet, "solana", txHex, ...)` returns ONLY the
 * detached 64-byte ed25519 signature (hex), NOT the full signed tx — even
 * though for some chains it returns the complete signed payload. For
 * Solana we have to splice the signature back into the right positional
 * slot of the original Transaction ourselves, preserving any embedded
 * partial sigs (e.g. ephemeral mint keypairs from `create-strategy`).
 *
 * (The upstream Zerion CLI's `cli/lib/chain/solana.js:39-42` comment claims
 * OWS returns the full signed bytes; that is incorrect for the Rust core
 * shipped in @open-wallet-standard/core@^1.2.4 — verified by probe.)
 */
export function signSolanaTx(role, base64Tx) {
  const found = getAgent(role); // throws if missing — DENY-by-default
  if (typeof base64Tx !== "string" || !base64Tx.length) {
    throw new Error("base64Tx must be a non-empty base64 string");
  }
  const txHex = Buffer.from(base64Tx, "base64").toString("hex");
  const result = ows.signTransaction(
    found.vaultName,
    "solana",
    txHex,
    passphrase(),
    undefined,
    vaultPath(),
  );
  if (!result || typeof result.signature !== "string") {
    throw new Error("OWS sign returned no signature");
  }
  const sigBytes = Buffer.from(result.signature, "hex");
  if (sigBytes.length !== 64) {
    throw new Error(
      `OWS Solana signature length unexpected: ${sigBytes.length} bytes (expected 64)`,
    );
  }
  // Splice the detached sig back into the tx at the agent's positional slot.
  return mergeSolanaSignature(base64Tx, found.pubkey, sigBytes);
}

/**
 * Inject `sigBytes` into a base64-encoded legacy Solana transaction at the
 * positional slot for `signerPubkeyB58`. Other positional sigs (e.g.
 * embedded ephemeral signers) are preserved.
 *
 * Returns base64 of the resulting fully-signed tx.
 */
function mergeSolanaSignature(base64Tx, signerPubkeyB58, sigBytes) {
  const tx = Transaction.from(Buffer.from(base64Tx, "base64"));
  tx.addSignature(new PublicKey(signerPubkeyB58), Buffer.from(sigBytes));
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return raw.toString("base64");
}

/**
 * Quick "does the vault know about this agent?" probe — used by chaos-sim
 * to decide whether to fall back to the keys/<role>.json file. Never throws.
 */
export function hasAgent(role) {
  return findAgent(role) !== null;
}
