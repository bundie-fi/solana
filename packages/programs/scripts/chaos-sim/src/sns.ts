/**
 * sns.ts — Solana Name Service helpers for chaos-sim agents.
 *
 * Why this exists
 * ───────────────
 * Each chaos-sim agent (creator-N, trader-N) is just a base58 pubkey today.
 * Hard to debug, harder to demo. SNS gives every agent a human-readable
 * `<name>.sol` identity that is verifiable on-chain (the .sol TLD is a
 * Bonfida domain registry under NAME_PROGRAM_ID).
 *
 * Authoritative source: `keys/agent-names.json`. The file is generated once
 * (committed) and treated as the canonical name → role/pubkey map for the
 * chaos pool. We never invent names at runtime.
 *
 * Two surfaces:
 *   1) `getNameForAgent(role)` — pure file lookup, no RPC.
 *   2) `registerNameOnDevnet(wallet, name)` — pays SOL on devnet to mint the
 *       Bonfida `<name>.sol` registry account owned by the wallet. ONLY
 *       called from the explicit `chaos:register-names` subcommand — never
 *       from a normal `chaos:run`. Devnet domain registration burns real
 *       devnet SOL (small, but non-zero), so we never auto-spend.
 *   3) `resolveAgentByName(conn, name)` — reverse-lookup the .sol record.
 *       Returns null if the domain isn't registered yet. Always falls back
 *       to the local agent-names.json so the chaos sim works offline and
 *       before any devnet registration ever happens.
 *
 * Bonfida SDK: https://sns.guide/  (npm: @bonfida/spl-name-service@^3.0.21)
 * Key entry: `getDomainKeySync(domain)` derives the deterministic
 * NameRegistry PDA: hash("SPL Name Service" + domain) → seed → PDA under
 * the Solana Name Service program (`namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkx`
 * on mainnet/devnet alike).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// IMPORTANT: do NOT import from "@bonfida/spl-name-service" at the top
// level. The package transitively pulls a different `@solana/spl-token`
// build whose buffer-layout struct definition crashes at load time under
// our pinned web3.js. We dynamic-import it only inside the functions
// that actually need a network round-trip (registerNameOnDevnet,
// isNameRegistered). The pure derivation `deriveNamePda` is implemented
// inline below so it stays synchronous + dependency-light, which keeps
// the smoke tests RPC-free and fast.

import { ChaosWallet } from "./wallets.js";

// SNS constants — copied from @bonfida/spl-name-service@3.0.21 constants.js
// so we don't have to load the package at module-init.
//   https://sns.guide/  (canonical SNS docs)
// Identical on mainnet and devnet — name service program IDs match.
const NAME_PROGRAM_ID = new PublicKey(
  "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX",
);
const ROOT_DOMAIN_ACCOUNT = new PublicKey(
  "58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx",
);
const HASH_PREFIX = "SPL Name Service";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NAMES_FILE = join(__dirname, "..", "keys", "agent-names.json");

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

interface AgentEntry {
  name: string;
  pubkey: string;
}

interface AgentNamesFile {
  domainSuffix: string; // ".sol"
  agents: Record<string, AgentEntry>; // role → entry
}

let cached: AgentNamesFile | null = null;

function loadFile(): AgentNamesFile {
  if (cached) return cached;
  if (!existsSync(NAMES_FILE)) {
    throw new Error(
      `agent-names.json not found at ${NAMES_FILE}. Re-create from the canonical roster.`,
    );
  }
  const raw = JSON.parse(readFileSync(NAMES_FILE, "utf8"));
  if (!raw.agents || typeof raw.agents !== "object") {
    throw new Error("agent-names.json malformed — missing `agents` map");
  }
  cached = raw as AgentNamesFile;
  return cached;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Pure local lookup — no RPC
// ───────────────────────────────────────────────────────────────────────────

/**
 * Look up the assigned `.sol` name for a chaos role.
 * Returns the bare label (e.g. `"alpha-hunter"`), no `.sol` suffix.
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

/** Returns the full `<name>.sol` form. */
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
 * Compute the SNS NamePDA for a top-level `<name>.sol` domain.
 *
 * Derivation matches @bonfida/spl-name-service::getDomainKeySync for the
 * non-subdomain case:
 *
 *   hashed_name = sha256("SPL Name Service" + name)
 *   seeds       = [hashed_name, alloc(32), ROOT_DOMAIN_ACCOUNT.toBuffer()]
 *   pda         = findProgramAddressSync(seeds, NAME_PROGRAM_ID)
 *
 * Inline so the function stays synchronous and free of the heavy Bonfida
 * package load (see file header). Subdomains are out of scope — chaos-sim
 * agents only ever register top-level `.sol` names.
 */
export function deriveNamePda(name: string): PublicKey {
  const bare = name.replace(/\.sol$/i, "");
  const hashed = createHash("sha256")
    .update(HASH_PREFIX + bare, "utf8")
    .digest();
  const seeds = [
    Uint8Array.from(hashed),
    new Uint8Array(32), // nameClass — empty for top-level domains
    ROOT_DOMAIN_ACCOUNT.toBuffer(),
  ];
  const [pda] = PublicKey.findProgramAddressSync(seeds, NAME_PROGRAM_ID);
  return pda;
}

/**
 * Check if a domain is already registered. Returns the registered owner
 * pubkey if so, or null if the registry account doesn't exist.
 *
 * This is the ONLY way `registerNameOnDevnet` decides whether to skip —
 * never re-register an already-claimed name.
 */
export async function isNameRegistered(
  conn: Connection,
  name: string,
): Promise<PublicKey | null> {
  const pda = deriveNamePda(name);
  try {
    // Lazy import — Bonfida's package eagerly loads its bundled spl-token
    // build, which crashes under our pinned web3.js. Loading it only when
    // we actually need to talk to RPC contains the blast radius.
    const { NameRegistryState } = await import("@bonfida/spl-name-service");
    // Bonfida v3 returns { registry, nftOwner } — nftOwner overrides if the
    // domain has been wrapped as an NFT and transferred. Prefer nftOwner
    // when present so we honor the true on-chain holder.
    const { registry, nftOwner } = await NameRegistryState.retrieve(conn, pda);
    return nftOwner ?? registry.owner ?? null;
  } catch {
    return null;
  }
}

export interface RegistrationResult {
  name: string;
  domain: string; // <name>.sol
  namePda: string;
  signature: string;
  alreadyRegistered: boolean;
}

/**
 * Register `<name>.sol` on devnet to the wallet.
 *
 * Implementation note: Bonfida ships a `devnet` namespace with the same
 * binding API but pointing at devnet program IDs. We use
 * `bonfidaDevnet.bindings.registerDomainName` which mirrors the V1 mainnet
 * path. Cost: ~0.011 SOL of rent for a 1kB name account + tx fee. We pass
 * `space=1000` (1kB, the SDK's typical small default).
 *
 * Caveats:
 *  - Bonfida's devnet registrar still requires the buyer's USDC ATA. We
 *    pass the wallet's devnet USDC ATA — funded by the same `chaos:fund`
 *    that funds the rest of the pool. If unfunded, registration will
 *    revert and we surface the error as `alreadyRegistered=false` +
 *    rethrow.
 *  - The Bonfida registrar program on devnet is sometimes flaky (the
 *    upstream team primarily maintains mainnet). The caller should wrap
 *    in try/catch and treat failures as non-fatal.
 *
 * Returns the tx signature on success, or a sentinel result if the name is
 * already taken (idempotent re-runs).
 */
export async function registerNameOnDevnet(
  conn: Connection,
  wallet: ChaosWallet,
  name: string,
  buyerUsdcAta: PublicKey,
  usdcMint: PublicKey,
): Promise<RegistrationResult> {
  const bare = name.replace(/\.sol$/i, "");
  const domain = `${bare}.sol`;
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

  // Lazy imports — see file-header note about Bonfida's transitive
  // spl-token version pin.
  const { Transaction, sendAndConfirmTransaction, PublicKey: PK } = await import(
    "@solana/web3.js"
  );
  const bonfida = await import("@bonfida/spl-name-service");

  // 1kB name account (typical small storage for a profile).
  const SPACE = 1_000;

  const buyerPubkey = new PK(wallet.pubkeyB58);

  // Bonfida devnet binding: returns nested ix arrays, one per "step" of
  // the registration. We flatten into a single tx because all steps share
  // the buyer signature.
  const ixGroups = await bonfida.devnet.bindings.registerDomainName(
    conn,
    bare,
    SPACE,
    buyerPubkey,
    buyerUsdcAta,
    usdcMint,
  );
  const ixs = ixGroups.flat();

  let sig: string;
  if (wallet.signWith === "file" && wallet.keypair) {
    // Backwards-compat path: sign locally with the on-disk keypair.
    const tx = new Transaction().add(...ixs);
    sig = await sendAndConfirmTransaction(conn, tx, [wallet.keypair], {
      commitment: "confirmed",
    });
  } else {
    // Vault-managed path: prepare → hand to `zerion-bundie agent sign` →
    // broadcast the signed bytes via plain RPC. We import lazily to keep
    // the smoke tests dependency-light.
    const { signWithVault } = await import("./vault-signer.js");
    const tx = new Transaction().add(...ixs);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "confirmed",
    );
    tx.feePayer = buyerPubkey;
    tx.recentBlockhash = blockhash;
    const unsigned = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");
    const signedB64 = signWithVault(wallet.role, unsigned);
    const raw = Buffer.from(signedB64, "base64");
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
 * Resolve `<name>.sol` → owner pubkey.
 *
 * Two-tier lookup:
 *   (a) On-chain: query the NameRegistry PDA owner field (devnet).
 *   (b) Fallback: scan agent-names.json (authoritative for the chaos pool).
 *
 * Returns null if neither path produces a hit. We never silently return a
 * wrong owner — the on-chain owner takes precedence over the local file
 * if both exist, but the local file is the source of truth for our pool.
 */
export async function resolveAgentByName(
  conn: Connection,
  name: string,
): Promise<PublicKey | null> {
  const bare = name.replace(/\.sol$/i, "");

  // (a) on-chain
  const owner = await isNameRegistered(conn, bare);
  if (owner) return owner;

  // (b) local agent-names.json fallback
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
