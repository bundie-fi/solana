/**
 * sns.ts — Solana Name Service helpers for chaos-sim agents.
 *
 * Why this exists
 * ───────────────
 * Each chaos-sim agent (creator-N, trader-N) is just a base58 pubkey today.
 * Hard to debug, harder to demo. SNS gives every agent a human-readable
 * `<name>.bundie` identity that is verifiable on-chain (the `.bundie` TLD is
 * a custom domain registry we own under the SPL Name Service program).
 *
 * Why a custom `.bundie` root and not `.sol`
 * ──────────────────────────────────────────
 * Bonfida's `.sol` registration on devnet requires a Pyth oracle for USDC
 * pricing that doesn't exist. Even bypassing Bonfida and calling SPL Name
 * Service `Create` directly fails: the `.sol` PDA seeds include
 * `ROOT_DOMAIN_ACCOUNT` (Bonfida-owned) and the on-chain processor (see
 * processor.rs:66-78) requires the parent's owner to sign for any
 * subdomain. We can't sign as Bonfida.
 *
 * Solution: we created a `.bundie` root via `pnpm chaos:setup-root` and
 * own its keypair (keys/bundie-root-owner.json). All subdomain creates
 * here co-sign with that keypair. Same SPL Name Service program, same
 * `NameRegistry` account layout, same reverse-lookup primitives.
 *
 * Authoritative source: `keys/agent-names.json` (role → label) and
 * `keys/bundie-root.json` (root PDA + owner pubkey, written by setup-root).
 *
 * Three surfaces:
 *   1) `getNameForAgent(role)` — pure file lookup, no RPC.
 *   2) `registerNameOnDevnet(wallet, name)` — pays SOL on devnet to mint
 *       the `<name>.bundie` registry account owned by the wallet. Requires
 *       BOTH the wallet AND the root-owner keypair to sign. ONLY called
 *       from the explicit `chaos:register-names` subcommand — never from
 *       a normal `chaos:run`. Devnet domain registration burns devnet SOL
 *       (small, but non-zero), so we never auto-spend.
 *   3) `resolveAgentByName(conn, name)` — reverse-lookup the .bundie record.
 *       Returns null if the domain isn't registered yet. Always falls back
 *       to the local agent-names.json so the chaos sim works offline and
 *       before any devnet registration ever happens.
 *
 * SPL Name Service: github.com/solana-labs/solana-program-library/tree/master/name-service
 * Program ID `namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX` is identical
 * mainnet/devnet — only the `.sol` Bonfida pricing layer differs by cluster.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ChaosWallet } from "./wallets.js";

// SPL Name Service program — same on mainnet and devnet. The on-chain
// registry primitives are agnostic to which TLD lives under them.
export const NAME_PROGRAM_ID = new PublicKey(
  "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX",
);
const HASH_PREFIX = "SPL Name Service";

// SPL Name Service `Create` is a Borsh-serialized enum variant (tag 0).
// See instruction.rs:13-48 + processor.rs:32-82 in the SPL repo.
const CREATE_INSTRUCTION_DISCRIMINATOR = 0x00;

// state.rs:36 — every name account starts with a 96-byte NameRecordHeader
// before user-controlled body bytes. The on-chain `Create` handler does
// NOT add this for us in the rent calc — we have to size the account as
// (header + body) and pre-fund accordingly. Forgetting this would
// under-fund the account and bug us at the next rent epoch.
const NAME_RECORD_HEADER_BYTES = 96;
const NAME_BODY_SPACE = 1_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");
const NAMES_FILE = join(KEYS_DIR, "agent-names.json");
const BUNDIE_ROOT_FILE = join(KEYS_DIR, "bundie-root.json");
const BUNDIE_ROOT_OWNER_FILE = join(KEYS_DIR, "bundie-root-owner.json");

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

interface AgentEntry {
  name: string;
  pubkey: string;
}

interface AgentNamesFile {
  domainSuffix: string; // ".bundie"
  agents: Record<string, AgentEntry>; // role → entry
}

interface BundieRootFile {
  label: string;
  domainSuffix: string; // ".bundie"
  rootPda: string;
  rootOwnerPubkey: string;
  programId: string;
  createdAt: string;
  createdSig: string | null;
}

let cachedNames: AgentNamesFile | null = null;
let cachedRoot: BundieRootFile | null = null;
let cachedRootPda: PublicKey | null = null;
let cachedRootOwnerKp: Keypair | null = null;

function loadFile(): AgentNamesFile {
  if (cachedNames) return cachedNames;
  if (!existsSync(NAMES_FILE)) {
    throw new Error(
      `agent-names.json not found at ${NAMES_FILE}. Re-create from the canonical roster.`,
    );
  }
  const raw = JSON.parse(readFileSync(NAMES_FILE, "utf8"));
  if (!raw.agents || typeof raw.agents !== "object") {
    throw new Error("agent-names.json malformed — missing `agents` map");
  }
  cachedNames = raw as AgentNamesFile;
  return cachedNames;
}

function loadRoot(): BundieRootFile {
  if (cachedRoot) return cachedRoot;
  if (!existsSync(BUNDIE_ROOT_FILE)) {
    throw new Error(
      `bundie-root.json not found at ${BUNDIE_ROOT_FILE}. Run \`pnpm chaos:setup-root\` first to create the .bundie root domain on devnet.`,
    );
  }
  cachedRoot = JSON.parse(readFileSync(BUNDIE_ROOT_FILE, "utf8")) as BundieRootFile;
  return cachedRoot;
}

function getRootPda(): PublicKey {
  if (cachedRootPda) return cachedRootPda;
  cachedRootPda = new PublicKey(loadRoot().rootPda);
  return cachedRootPda;
}

/**
 * Lazy-load the root-owner keypair from disk. Only used by code paths that
 * actually need to write a subdomain (registerNameOnDevnet); pure read paths
 * never touch this so chaos:doctor / chaos:run / unit tests stay free of
 * the keypair file dependency.
 */
function getRootOwnerKeypair(): Keypair {
  if (cachedRootOwnerKp) return cachedRootOwnerKp;
  if (!existsSync(BUNDIE_ROOT_OWNER_FILE)) {
    throw new Error(
      `bundie-root-owner.json not found at ${BUNDIE_ROOT_OWNER_FILE}. ` +
        `Run \`pnpm chaos:setup-root\` to create it (gitignored — never commit).`,
    );
  }
  const raw = JSON.parse(readFileSync(BUNDIE_ROOT_OWNER_FILE, "utf8")) as number[];
  cachedRootOwnerKp = Keypair.fromSecretKey(Uint8Array.from(raw));
  // Sanity: pubkey must match the value persisted in bundie-root.json.
  const expected = loadRoot().rootOwnerPubkey;
  if (cachedRootOwnerKp.publicKey.toBase58() !== expected) {
    throw new Error(
      `root owner keypair pubkey ${cachedRootOwnerKp.publicKey.toBase58()} does not match metadata ${expected}. Re-run setup-root or restore the original keypair.`,
    );
  }
  return cachedRootOwnerKp;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Pure local lookup — no RPC
// ───────────────────────────────────────────────────────────────────────────

/**
 * Look up the assigned `.bundie` name for a chaos role.
 * Returns the bare label (e.g. `"alpha-hunter"`), no `.bundie` suffix.
 * Throws if the role isn't in the manifest — fail loud, never invent names.
 */
export function getNameForAgent(role: string): string {
  const file = loadFile();
  const entry = file.agents[role];
  if (!entry) {
    throw new Error(
      `no SNS name assigned to role "${role}" (check keys/agent-names.json)`,
    );
  }
  return entry.name;
}

/** Returns the full `<name>.bundie` form (suffix from agent-names.json). */
export function getDomainForAgent(role: string): string {
  const file = loadFile();
  return `${getNameForAgent(role)}${file.domainSuffix}`;
}

/**
 * Reverse map: pubkey → role/name. Used by `resolveAgentByName` and by the
 * web app fallback path (chaos pool authority is the local mapping when the
 * on-chain reverse-lookup is missing or stale).
 */
export function lookupAgentByPubkey(
  pubkeyB58: string,
): { role: string; name: string } | null {
  const file = loadFile();
  for (const [role, entry] of Object.entries(file.agents)) {
    if (entry.pubkey === pubkeyB58) return { role, name: entry.name };
  }
  return null;
}

/** Lists all assigned (role, name, pubkey) triples. Stable ordering. */
export function listAllAgents(): Array<{
  role: string;
  name: string;
  pubkey: string;
}> {
  const file = loadFile();
  return Object.entries(file.agents)
    .map(([role, entry]) => ({ role, name: entry.name, pubkey: entry.pubkey }))
    .sort((a, b) => a.role.localeCompare(b.role));
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Devnet registration  (explicit subcommand only)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compute the SNS NamePDA for `<name>.bundie`.
 *
 * Derivation (state.rs:69-97 in the SPL repo):
 *
 *   hashed_name = sha256("SPL Name Service" + bare_label)
 *   seeds       = [hashed_name (32B),
 *                  Pubkey::default()  (no class)         (32B),
 *                  BUNDIE_ROOT_PDA.toBuffer()            (32B)]
 *   pda         = findProgramAddressSync(seeds, NAME_PROGRAM_ID)
 *
 * The hashed name is just the bare label — hierarchy is encoded purely
 * via the parent seed, NOT via "label.parent" string concatenation.
 */
export function deriveNamePda(name: string): PublicKey {
  // Strip our suffix if present — accept both "alpha-hunter" and
  // "alpha-hunter.bundie" forms. Also strip ".sol" for backwards compat
  // with any legacy callers.
  const bare = name.replace(/\.bundie$/i, "").replace(/\.sol$/i, "");
  const hashed = createHash("sha256")
    .update(HASH_PREFIX + bare, "utf8")
    .digest();
  const seeds = [
    Uint8Array.from(hashed),
    new Uint8Array(32), // class — empty
    getRootPda().toBuffer(), // parent — our owned .bundie root
  ];
  const [pda] = PublicKey.findProgramAddressSync(seeds, NAME_PROGRAM_ID);
  return pda;
}

/**
 * Check if a domain is already registered. Returns the registered owner
 * pubkey if so, or null if the registry account doesn't exist.
 *
 * Reads the NameRecordHeader off the raw account data — we don't need the
 * Bonfida SDK for a simple owner lookup, and avoiding it sidesteps the
 * SDK's transitive-deps loading bug under our pinned web3.js.
 *
 * Layout (state.rs:11-37): parent_name(32) | owner(32) | class(32).
 */
export async function isNameRegistered(
  conn: Connection,
  name: string,
): Promise<PublicKey | null> {
  const pda = deriveNamePda(name);
  const acc = await conn.getAccountInfo(pda, "confirmed");
  if (!acc) return null;
  if (!acc.owner.equals(NAME_PROGRAM_ID)) return null;
  if (acc.data.length < NAME_RECORD_HEADER_BYTES) return null;
  return new PublicKey(acc.data.subarray(32, 64));
}

export interface RegistrationResult {
  name: string;
  domain: string; // <name>.bundie
  namePda: string;
  signature: string;
  alreadyRegistered: boolean;
}

/**
 * Register `<name>.bundie` on devnet to the wallet.
 *
 * Implementation (research-verified against SPL Name Service `Create`,
 * processor.rs:32-82):
 *
 *   ix data: Borsh enum tag 0 (u8) | u32 LE hashed.length | hashed (32B)
 *            | u64 LE rent lamports | u32 LE body space
 *
 *   accounts:
 *     0. system program
 *     1. payer (the wallet)                  [signer, writable]
 *     2. name PDA                            [writable]
 *     3. name owner (= the wallet)           [readonly]
 *     4. Pubkey::default()                   [readonly] (no class)
 *     5. BUNDIE_ROOT_PDA                     [readonly] (parent)
 *     6. BUNDIE_ROOT_OWNER                   [signer]   (parent_owner — REQUIRED
 *                                                       when parent ≠ default)
 *
 * Slot 6 is what the previous bypass missed. Without it, the on-chain
 * processor calls `parent_name_owner.unwrap()` on a `None` and aborts —
 * exactly the "Program failed to complete" symptom we hit on every prior
 * register attempt.
 *
 * Two signers per tx: the wallet (vault-managed via Zerion or file-fallback)
 * AND the root owner (loaded from keys/bundie-root-owner.json). For
 * vault-managed wallets we partial-sign with the root owner first, hand
 * the still-incomplete tx to `zerion-bundie agent sign` for the wallet
 * signature, then submit the fully-signed bytes via plain RPC.
 *
 * Cost: rent for (96 header + 1000 body) ≈ 0.0079 SOL + tx fee.
 *
 * DENY-by-default: failures propagate to the caller. We never silently
 * fall back to the Bonfida USDC path (it doesn't exist on devnet anyway).
 */
export async function registerNameOnDevnet(
  conn: Connection,
  wallet: ChaosWallet,
  name: string,
): Promise<RegistrationResult> {
  const root = loadRoot();
  const bare = name.replace(/\.bundie$/i, "").replace(/\.sol$/i, "");
  const domain = `${bare}${root.domainSuffix}`;
  const namePda = deriveNamePda(bare);

  const existingOwner = await isNameRegistered(conn, bare);
  if (existingOwner) {
    return {
      name: bare,
      domain,
      namePda: namePda.toBase58(),
      signature: "",
      alreadyRegistered: true,
    };
  }

  const { Transaction, sendAndConfirmTransaction, PublicKey: PK } = await import(
    "@solana/web3.js"
  );

  const buyerPubkey = new PK(wallet.pubkeyB58);
  const rootPda = getRootPda();
  const rootOwnerKp = getRootOwnerKeypair();

  // Build ix data — see comment block on this function for layout.
  const hashed = createHash("sha256")
    .update(HASH_PREFIX + bare, "utf8")
    .digest();
  const totalSpace = NAME_RECORD_HEADER_BYTES + NAME_BODY_SPACE;
  const lamports = BigInt(
    await conn.getMinimumBalanceForRentExemption(totalSpace),
  );
  const data = Buffer.alloc(1 + 4 + hashed.length + 8 + 4);
  let off = 0;
  data.writeUInt8(CREATE_INSTRUCTION_DISCRIMINATOR, off);
  off += 1;
  data.writeUInt32LE(hashed.length, off);
  off += 4;
  hashed.copy(data, off);
  off += hashed.length;
  data.writeBigUInt64LE(lamports, off);
  off += 8;
  data.writeUInt32LE(NAME_BODY_SPACE, off);

  const EMPTY_PUBKEY = new PK(new Uint8Array(32));
  const ix = new TransactionInstruction({
    programId: NAME_PROGRAM_ID,
    keys: [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: buyerPubkey, isSigner: true, isWritable: true }, // payer
      { pubkey: namePda, isSigner: false, isWritable: true }, // name PDA
      { pubkey: buyerPubkey, isSigner: false, isWritable: false }, // name_owner
      { pubkey: EMPTY_PUBKEY, isSigner: false, isWritable: false }, // class = default
      { pubkey: rootPda, isSigner: false, isWritable: false }, // parent
      { pubkey: rootOwnerKp.publicKey, isSigner: true, isWritable: false }, // parent_owner
    ],
    data,
  });

  let sig: string;
  if (wallet.signWith === "file" && wallet.keypair) {
    // Backwards-compat path — both signers are local keypairs, send in one shot.
    const tx = new Transaction().add(ix);
    sig = await sendAndConfirmTransaction(
      conn,
      tx,
      [wallet.keypair, rootOwnerKp],
      { commitment: "confirmed" },
    );
  } else {
    // Vault-managed path. The Zerion vault only signs for the wallet's
    // pubkey; we partial-sign with the root owner here (locally), then
    // hand the partially-signed tx to the vault for the wallet signature.
    const { signWithVault } = await import("./vault-signer.js");
    const tx = new Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "confirmed",
    );
    tx.feePayer = buyerPubkey;
    tx.recentBlockhash = blockhash;
    // Partial-sign with the root owner first. `partialSign` does NOT
    // require all signers — it just adds the root owner's signature to
    // the signatures array, leaving the wallet's slot empty for the vault
    // to fill in.
    tx.partialSign(rootOwnerKp);
    const partial = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");
    const fullySignedB64 = signWithVault(wallet.role, partial);
    const raw = Buffer.from(fullySignedB64, "base64");
    sig = await conn.sendRawTransaction(raw);
    await conn.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed",
    );
  }

  return {
    name: bare,
    domain,
    namePda: namePda.toBase58(),
    signature: sig,
    alreadyRegistered: false,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Resolution — reverse lookup with local fallback
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve `<name>.bundie` → owner pubkey.
 *
 * Two-tier lookup:
 *   (a) On-chain: query the NameRegistry PDA owner field (devnet).
 *   (b) Fallback: scan agent-names.json (authoritative for the chaos pool).
 *
 * Returns null if neither path produces a hit. The on-chain owner takes
 * precedence over the local file if both exist, but the local file is the
 * source of truth for our pool while registrations are still pending.
 */
export async function resolveAgentByName(
  conn: Connection,
  name: string,
): Promise<PublicKey | null> {
  const bare = name.replace(/\.bundie$/i, "").replace(/\.sol$/i, "");

  const owner = await isNameRegistered(conn, bare);
  if (owner) return owner;

  const file = loadFile();
  for (const entry of Object.values(file.agents)) {
    if (entry.name === bare) {
      try {
        return new PublicKey(entry.pubkey);
      } catch {
        return null;
      }
    }
  }
  return null;
}
