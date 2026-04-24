/**
 * lib/sns-register.ts — client-side SNS registration helpers (devnet only).
 *
 * Mirrors the chaos-sim canonical path
 * (packages/programs/scripts/chaos-sim/src/sns.ts::registerNameOnDevnet) but
 * adapted for the browser:
 *   - Wallet Adapter signs (no server keypair).
 *   - Connection comes from NEXT_PUBLIC_RPC_URL (devnet by default).
 *   - All Bonfida SDK access happens behind a lazy dynamic import so the SSR
 *     bundle stays small.
 *
 * DENY-by-default: name validation runs BEFORE we ever touch the SDK.
 *
 * Why the SPL Name Service direct path
 * ────────────────────────────────────
 * Bonfida's high-level `registerDomainName` binding (mainnet + devnet) calls
 * into a Pyth oracle to convert the registrar's USDC fee for the buyer's
 * payment mint. On devnet there is no live Pyth feed for our payment mint,
 * so the binding throws "The Pyth account for the provided mint was not
 * found" before any tx is constructed. That is a Bonfida-monetization-layer
 * limitation, NOT an SNS limitation — the underlying on-chain identity is
 * just an SPL Name Service `Create` ix (discriminator 0x00) that allocates
 * the name account, no payment required, just rent.
 *
 * We bypass Bonfida's USDC pricing layer and invoke the lower-level
 * `createNameRegistry` binding from `@bonfida/spl-name-service`, which wraps
 * the SPL Name Service `createInstruction` with rent calc + PDA derivation.
 * Same NameRegistry PDA as Bonfida produces (sha256("SPL Name Service" +
 * name)), same reverse-lookup behavior, no Pyth dependency.
 *
 * Devnet cost: rent for a 1kB name account (~0.011 SOL) + tx fee. NO USDC
 * required. Failures here are surfaced — never silently fall back to the
 * Bonfida USDC path (DENY by default).
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const DEVNET_RPC =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

// SPL Name Service program ID — identical on mainnet and devnet (the
// underlying identity registry is the same on-chain program; Bonfida's
// pricing layer is what differs by cluster).
//   https://github.com/solana-labs/solana-program-library/tree/master/name-service
export const SPL_NAME_SERVICE_PROGRAM_ID = new PublicKey(
  "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX",
);

// `.sol` TLD root — identical on mainnet and devnet.
const ROOT_DOMAIN_ACCOUNT = new PublicKey(
  "58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx",
);

// Hash prefix the SPL Name Service program uses to derive name PDAs.
// hash = sha256("SPL Name Service" + name).
const HASH_PREFIX = "SPL Name Service";

// 1kB name account — matches the chaos-sim default. Larger spaces cost
// more rent without giving us anything extra for a profile-only use case.
const NAME_ACCOUNT_SPACE = 1_000;

// Approx devnet cost — surfaced so the UI can warn before the user signs.
// Rent for a 1kB account on devnet is ≈ 0.011 SOL (Solana rent schedule).
export const DEVNET_REGISTRATION_COST_SOL = 0.011;

// Name validity rules (kept narrow for v1 — Bonfida's protocol is more
// permissive but our UX surface is "lowercase alphanumeric + dashes",
// matches the chaos-pool naming style and avoids confusable unicode):
//   - 3–32 chars
//   - lowercase a-z, 0-9, single dashes
//   - no leading or trailing dash
//   - no consecutive dashes
const NAME_MIN_LEN = 3;
const NAME_MAX_LEN = 32;
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface NameValidation {
  ok: boolean;
  reason?: string;
}

/** Sync validator. Pure function — safe to call from any render. */
export function validateName(raw: string): NameValidation {
  const name = raw.trim().toLowerCase();
  if (!name) return { ok: false, reason: "Enter a name." };
  if (name.length < NAME_MIN_LEN)
    return { ok: false, reason: `Too short (min ${NAME_MIN_LEN}).` };
  if (name.length > NAME_MAX_LEN)
    return { ok: false, reason: `Too long (max ${NAME_MAX_LEN}).` };
  if (!NAME_RE.test(name))
    return {
      ok: false,
      reason: "Lowercase letters, numbers, and single dashes only.",
    };
  return { ok: true };
}

export type AvailabilityResult =
  | { state: "available"; name: string }
  | { state: "taken"; name: string; owner: string }
  | { state: "invalid"; name: string; reason: string }
  | { state: "error"; name: string; reason: string };

/**
 * checkAvailability — does the `<name>.sol` registry account already exist
 * on devnet? Three states:
 *   - 'invalid'  → fails our name regex (no RPC call)
 *   - 'taken'    → on-chain registry exists; surfaces owner pubkey
 *   - 'available'→ no registry, claim is open
 *   - 'error'    → RPC failure (caller should retry / show transient banner)
 */
export async function checkAvailability(
  raw: string,
): Promise<AvailabilityResult> {
  const v = validateName(raw);
  const name = raw.trim().toLowerCase();
  if (!v.ok) return { state: "invalid", name, reason: v.reason ?? "Invalid." };

  try {
    // Lazy-load the bonfida SDK — keeps the home-page bundle thin.
    const { getDomainKeySync, NameRegistryState } = await import(
      "@bonfida/spl-name-service"
    );
    const { pubkey } = getDomainKeySync(name);
    const conn = new Connection(DEVNET_RPC, "confirmed");
    try {
      const { registry, nftOwner } = await NameRegistryState.retrieve(
        conn,
        pubkey,
      );
      const owner = (nftOwner ?? registry.owner).toBase58();
      return { state: "taken", name, owner };
    } catch {
      // retrieve() throws when the account doesn't exist → free.
      return { state: "available", name };
    }
  } catch (err) {
    return {
      state: "error",
      name,
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export interface BuiltRegistration {
  /** The Transaction with the SPL Name Service create ix. Owner must sign + pay. */
  tx: Transaction;
  /** The deterministic PDA for `<name>.sol`. */
  namePda: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Inline SPL Name Service `Create` ix builder
// ───────────────────────────────────────────────────────────────────────────
//
// We build the ix bytes ourselves rather than calling
// `@bonfida/spl-name-service`'s `createNameRegistry` because the Bonfida
// package eagerly loads a borsh ESM build whose `serialize` named export
// doesn't exist under strict Node ESM resolution. Browsers + the Next.js
// bundler tolerate the mismatch, but it's brittle and we don't actually
// need any of Bonfida's logic for a top-level `<name>.sol` registration.
//
// The Create ix layout (from spl-name-service Rust source):
//   discriminator: u8 = 0x00 (NameRegistryInstruction::Create)
//   hashed_name:   Vec<u8> (length-prefixed by u32 LE)
//   lamports:      u64 LE
//   space:         u32 LE
//
// Accounts (in order):
//   0. system_program           [readonly]
//   1. payer                    [signer, writable]
//   2. name_account (PDA)       [writable]
//   3. name_owner               [readonly]
//   4. name_class               [readonly] — empty pubkey if absent
//   5. name_parent              [readonly] — ROOT_DOMAIN_ACCOUNT for .sol
//
// ROOT_DOMAIN_ACCOUNT does NOT need a signature for top-level `.sol`
// registrations because the parent's owner is the SPL Name Service program
// itself (no parent_owner account is appended).

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Browsers + modern Node both expose Web Crypto. We avoid importing
  // node:crypto so this file stays bundleable for the client.
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(buf);
  }
  // Fallback for old Node — dynamic import keeps the client bundle clean.
  const { createHash } = await import("node:crypto");
  return new Uint8Array(createHash("sha256").update(Buffer.from(data)).digest());
}

async function deriveNamePda(bare: string): Promise<{
  pda: PublicKey;
  hashed: Uint8Array;
}> {
  const enc = new TextEncoder();
  const hashed = await sha256(enc.encode(HASH_PREFIX + bare));
  const seeds = [
    hashed,
    new Uint8Array(32), // nameClass — empty for top-level domains
    ROOT_DOMAIN_ACCOUNT.toBuffer(),
  ];
  const [pda] = PublicKey.findProgramAddressSync(seeds, SPL_NAME_SERVICE_PROGRAM_ID);
  return { pda, hashed };
}

function buildCreateIxData(
  hashed: Uint8Array,
  lamports: bigint,
  space: number,
): Uint8Array {
  // 1 (disc) + 4 (hashed-name length) + hashed.length + 8 (lamports) + 4 (space)
  const buf = new Uint8Array(1 + 4 + hashed.length + 8 + 4);
  const view = new DataView(buf.buffer);
  let off = 0;
  buf[off] = 0x00; // CreateInstruction discriminator
  off += 1;
  view.setUint32(off, hashed.length, /* littleEndian */ true);
  off += 4;
  buf.set(hashed, off);
  off += hashed.length;
  view.setBigUint64(off, lamports, true);
  off += 8;
  view.setUint32(off, space, true);
  return buf;
}

/**
 * Build a registration transaction for `<name>.sol` owned by `owner`. The
 * caller is responsible for signing + sending. We DO NOT auto-send.
 *
 * Builds the SPL Name Service `Create` ix (discriminator 0x00) directly —
 * no Bonfida SDK in the call path, no Pyth, no USDC. Just rent for the
 * name account + tx fee.
 *
 * DENY-by-default: if RPC errors fetching rent exemption, we surface the
 * error directly. We never fall back to Bonfida's USDC path because that
 * path is exactly what we're working around (it requires a Pyth feed that
 * doesn't exist for our devnet payment mint).
 */
export async function buildRegisterTx(
  name: string,
  owner: PublicKey,
  conn?: Connection,
): Promise<BuiltRegistration> {
  const v = validateName(name);
  if (!v.ok) throw new Error(v.reason ?? "Invalid name");
  const bare = name.trim().toLowerCase();

  const c = conn ?? new Connection(DEVNET_RPC, "confirmed");

  const { pda: namePda, hashed } = await deriveNamePda(bare);

  // Rent for the name account — required so the account stays alive.
  // Throws on RPC failure (we let it propagate, DENY by default).
  const lamports = BigInt(
    await c.getMinimumBalanceForRentExemption(NAME_ACCOUNT_SPACE),
  );

  const data = buildCreateIxData(hashed, lamports, NAME_ACCOUNT_SPACE);

  // nameClass is absent for top-level domains → push the all-zero pubkey.
  // The on-chain program checks the key against PublicKey::default() to
  // skip the signer requirement.
  const EMPTY_PUBKEY = new PublicKey(new Uint8Array(32));

  const ix = new TransactionInstruction({
    programId: SPL_NAME_SERVICE_PROGRAM_ID,
    keys: [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true }, // payer
      { pubkey: namePda, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false }, // name_owner
      { pubkey: EMPTY_PUBKEY, isSigner: false, isWritable: false }, // name_class (absent)
      { pubkey: ROOT_DOMAIN_ACCOUNT, isSigner: false, isWritable: false }, // name_parent
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = owner;
  // recentBlockhash assigned at send-time by the wallet adapter helper. We
  // could pre-fill it here, but that adds a 30s expiry race that's painful
  // when the user lingers on the confirmation modal. Let the executor stamp
  // it just before signing.

  return {
    tx,
    namePda: namePda.toBase58(),
  };
}

/**
 * Minimal wallet adapter shape we need — keeps this module decoupled from
 * the exact `@solana/wallet-adapter-react` types so unit tests can pass a
 * plain stub.
 */
export interface SnsSigningWallet {
  publicKey: PublicKey | null;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  sendTransaction?: (
    tx: Transaction,
    connection: Connection,
  ) => Promise<string>;
}

export interface RegistrationOutcome {
  namePda: string;
  signature: string;
  domain: string; // "<name>.sol"
}

/**
 * executeRegistration — wires a connected wallet adapter to the build +
 * send path. The wallet's `sendTransaction` does the recent-blockhash +
 * sign + submit dance for us.
 *
 * Throws on:
 *   - wallet not connected
 *   - invalid name (validateName failure, before RPC)
 *   - already-registered name (we check and refuse to spend)
 *   - any RPC / send error (no fallback to the Bonfida USDC path — the
 *     whole point of this module is to NOT touch that path on devnet)
 */
export async function executeRegistration(
  wallet: SnsSigningWallet,
  name: string,
  conn?: Connection,
): Promise<RegistrationOutcome> {
  if (!wallet?.publicKey) throw new Error("Wallet not connected");
  if (!wallet.sendTransaction)
    throw new Error("Wallet does not support sendTransaction");

  const v = validateName(name);
  if (!v.ok) throw new Error(v.reason ?? "Invalid name");
  const bare = name.trim().toLowerCase();

  const c = conn ?? new Connection(DEVNET_RPC, "confirmed");

  // Refuse to register a taken name. The /identity UI also gates this with
  // its live availability check, but we belt-and-brace at the boundary in
  // case the user clicks fast or the cache is stale.
  const avail = await checkAvailability(bare);
  if (avail.state === "taken")
    throw new Error(`${bare}.sol is already taken (owner: ${avail.owner}).`);
  if (avail.state === "invalid") throw new Error(avail.reason);
  // 'error' state → keep going; build/send will surface the real RPC error.

  const { tx, namePda } = await buildRegisterTx(bare, wallet.publicKey, c);
  const signature = await wallet.sendTransaction(tx, c);
  await c.confirmTransaction(signature, "confirmed").catch(() => {
    /* don't throw — caller can poll if they care; tx is already submitted */
  });

  return { namePda, signature, domain: `${bare}.sol` };
}

// Test-only helpers — kept so the smoke test can probe internals without
// importing the bonfida SDK.
export const _internals = {
  NAME_RE,
  NAME_ACCOUNT_SPACE,
  validateName,
};
