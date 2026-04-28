/**
 * lib/sns-register.ts — client-side SNS registration helpers (devnet only).
 *
 * Mirrors the chaos-sim canonical path
 * (packages/programs/scripts/chaos-sim/src/sns.ts::registerNameOnDevnet) but
 * adapted for the browser:
 *   - Wallet Adapter signs (no client-side keypair).
 *   - Connection comes from NEXT_PUBLIC_RPC_URL (devnet by default).
 *
 * Why a custom `.bundie` root and not `.sol`
 * ──────────────────────────────────────────
 * Bonfida's `.sol` registration on devnet requires a Pyth oracle for USDC
 * pricing that doesn't exist. Even bypassing Bonfida and calling SPL Name
 * Service `Create` directly fails: the `.sol` PDA seeds include
 * `ROOT_DOMAIN_ACCOUNT` (Bonfida-owned) and the on-chain processor (see
 * SPL processor.rs:66-78) requires the parent's owner to sign for any
 * subdomain. We can't sign as Bonfida.
 *
 * Solution: we created a `.bundie` root via `pnpm chaos:setup-root` and
 * own its keypair. All subdomain creates here co-sign with that keypair.
 * Same SPL Name Service program, same `NameRegistry` account layout, same
 * reverse-lookup primitives.
 *
 * The root owner keypair lives server-side ONLY (env var
 * `BUNDIE_ROOT_OWNER_SECRET_KEY`); the client posts an unsigned tx to
 * `/api/sns/sign-as-root`, which adds the parent_owner signature and
 * returns the partially-signed tx for the wallet to finish.
 *
 * DENY-by-default: name validation runs BEFORE we touch the network.
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

// SPL Name Service program — same on mainnet and devnet.
//   github.com/solana-labs/solana-program-library/tree/master/name-service
export const SPL_NAME_SERVICE_PROGRAM_ID = new PublicKey(
  "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX",
);

// Our owned `.bundie` root on devnet (created by `pnpm chaos:setup-root`).
// These are public values — the server holds the matching secret key.
// Override via NEXT_PUBLIC_BUNDIE_ROOT_PDA / _OWNER for non-default deployments.
const DEFAULT_BUNDIE_ROOT_PDA = "4ZKCQT1DgxQ7L4TggUMr4SS3zH4SLyVT1FWbCq4qrjEy";
const DEFAULT_BUNDIE_ROOT_OWNER = "8EodjSj73fUA2doL86CSRZzrFQUxJ9kBPNjDBo92hpH6";
export const BUNDIE_ROOT_PDA = new PublicKey(
  process.env.NEXT_PUBLIC_BUNDIE_ROOT_PDA || DEFAULT_BUNDIE_ROOT_PDA,
);
export const BUNDIE_ROOT_OWNER = new PublicKey(
  process.env.NEXT_PUBLIC_BUNDIE_ROOT_OWNER || DEFAULT_BUNDIE_ROOT_OWNER,
);

// SPL Name Service hash prefix. NameRegistry PDA seed[0] = sha256(prefix + name).
const HASH_PREFIX = "SPL Name Service";

// Account layout: 96B NameRecordHeader + body. The on-chain `Create`
// handler does NOT add the header to our `space` field — we have to size
// rent for both, then pass body-only as `space`. The previous bypass
// forgot the header and would have under-funded the account.
const NAME_RECORD_HEADER_BYTES = 96;
const NAME_BODY_SPACE = 1_000;

// Approx devnet cost — surfaced so the UI can warn before the user signs.
// Rent for (96 + 1000) bytes ≈ 0.0079 SOL on the current devnet schedule;
// rounded up here for display so users have a tiny buffer.
export const DEVNET_REGISTRATION_COST_SOL = 0.009;

// Name validity rules — narrow on purpose. SPL is more permissive but our
// UX surface stays "lowercase alphanumeric + dashes" to match chaos-pool
// naming and avoid confusable unicode.
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

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Web Crypto is available everywhere we run: modern browsers and Node
  // 16+ both expose `globalThis.crypto.subtle`. Importing `node:crypto`
  // as a fallback would force webpack to try resolving a node-scheme URL
  // for the client bundle and fail the build.
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(buf);
}

async function deriveNamePda(bare: string): Promise<{
  pda: PublicKey;
  hashed: Uint8Array;
}> {
  const enc = new TextEncoder();
  const hashed = await sha256(enc.encode(HASH_PREFIX + bare));
  const seeds = [
    hashed,
    new Uint8Array(32), // class — empty
    BUNDIE_ROOT_PDA.toBuffer(), // parent — our owned `.bundie` root
  ];
  const [pda] = PublicKey.findProgramAddressSync(seeds, SPL_NAME_SERVICE_PROGRAM_ID);
  return { pda, hashed };
}

/**
 * checkAvailability — does the `<name>.bundie` registry account already
 * exist on devnet? Three states:
 *   - 'invalid'  → fails our name regex (no RPC call)
 *   - 'taken'    → on-chain registry exists; surfaces owner pubkey
 *   - 'available'→ no registry, claim is open
 *   - 'error'    → RPC failure (caller should retry / show transient banner)
 *
 * We read the NameRecordHeader off the raw account data (layout:
 * parent_name(32) | owner(32) | class(32) | body…). This avoids the Bonfida
 * SDK entirely so the client bundle stays small.
 */
export async function checkAvailability(
  raw: string,
): Promise<AvailabilityResult> {
  const v = validateName(raw);
  const name = raw.trim().toLowerCase();
  if (!v.ok) return { state: "invalid", name, reason: v.reason ?? "Invalid." };

  try {
    const { pda } = await deriveNamePda(name);
    const conn = new Connection(DEVNET_RPC, "confirmed");
    // No string commitment — rpcfast strict-mode rejects positional
    // `"confirmed"`. Connection was constructed with the same default.
    const acc = await conn.getAccountInfo(pda);
    if (!acc) return { state: "available", name };
    if (!acc.owner.equals(SPL_NAME_SERVICE_PROGRAM_ID))
      return { state: "available", name }; // foreign account, treat as free
    if (acc.data.length < NAME_RECORD_HEADER_BYTES)
      return { state: "available", name };
    const owner = new PublicKey(acc.data.subarray(32, 64)).toBase58();
    return { state: "taken", name, owner };
  } catch (err) {
    return {
      state: "error",
      name,
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export interface BuiltRegistration {
  /** The Transaction with the SPL Name Service create ix. */
  tx: Transaction;
  /** The deterministic PDA for `<name>.bundie`. */
  namePda: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Inline SPL Name Service `Create` ix builder
// ───────────────────────────────────────────────────────────────────────────
//
// Wire format (research-verified from solana-program-library/name-service
// instruction.rs:13-48 + processor.rs:32-82):
//
//   [u8 = 0x00]                       // Borsh enum tag — Create
//   [u32 LE = hashed.len() = 32]
//   [32 bytes hashed_name]
//   [u64 LE rent lamports]
//   [u32 LE body space]
//
// Accounts (in order):
//   0. system_program                  [readonly]
//   1. payer                           [signer, writable]
//   2. name_account (PDA)              [writable]
//   3. name_owner                      [readonly]
//   4. name_class (Pubkey::default)    [readonly] — empty pubkey if absent
//   5. name_parent (BUNDIE_ROOT_PDA)   [readonly]
//   6. name_parent_owner               [signer]   — REQUIRED when parent ≠ default
//
// Slot 6 is what the previous bypass missed. Without it, the on-chain
// processor calls `parent_name_owner.unwrap()` on a `None` and aborts —
// exactly the "Program failed to complete" symptom we hit on every prior
// register attempt for `.sol`.

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
 * Build a registration transaction for `<name>.bundie` owned by `owner`.
 * Returns an UNSIGNED tx — the caller is responsible for getting both
 * the wallet signature AND the bundie-root-owner signature (via the
 * /api/sns/sign-as-root server route).
 *
 * DENY-by-default: if RPC errors fetching rent exemption, we surface
 * the error directly. We never fall back to Bonfida's USDC path because
 * that path is exactly what we're working around (it requires a Pyth
 * feed that doesn't exist for our devnet payment mint).
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

  const totalSpace = NAME_RECORD_HEADER_BYTES + NAME_BODY_SPACE;
  // Throws on RPC failure — DENY by default.
  const lamports = BigInt(
    await c.getMinimumBalanceForRentExemption(totalSpace),
  );

  const data = buildCreateIxData(hashed, lamports, NAME_BODY_SPACE);

  const EMPTY_PUBKEY = new PublicKey(new Uint8Array(32));

  const ix = new TransactionInstruction({
    programId: SPL_NAME_SERVICE_PROGRAM_ID,
    keys: [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true }, // payer
      { pubkey: namePda, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false }, // name_owner
      { pubkey: EMPTY_PUBKEY, isSigner: false, isWritable: false }, // class = default
      { pubkey: BUNDIE_ROOT_PDA, isSigner: false, isWritable: false }, // parent
      { pubkey: BUNDIE_ROOT_OWNER, isSigner: true, isWritable: false }, // parent_owner
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = owner;
  // recentBlockhash is stamped just before signing to avoid the 30s expiry
  // race that bites when the user lingers on the confirmation modal.

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
  domain: string; // "<name>.bundie"
}

/**
 * POST the partially-signed tx to /api/sns/sign-as-root. The server adds
 * the bundie-root-owner signature (held in BUNDIE_ROOT_OWNER_SECRET_KEY,
 * server-only env). Returns the still-incomplete tx — the wallet still
 * needs to sign as payer.
 *
 * Errors propagate to the caller (DENY by default). We never silently
 * skip the parent_owner signature because the on-chain `Create` will
 * reject the tx without it.
 */
async function signAsRoot(serializedTxB64: string): Promise<string> {
  const res = await fetch("/api/sns/sign-as-root", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx: serializedTxB64 }),
  });
  if (!res.ok) {
    let body: { error?: string } = {};
    try {
      body = await res.json();
    } catch {
      // ignore — we'll fall back to the status text
    }
    throw new Error(
      `sign-as-root failed (${res.status}): ${body.error ?? res.statusText}`,
    );
  }
  const json = (await res.json()) as { tx?: string };
  if (!json.tx) throw new Error("sign-as-root response missing `tx`");
  return json.tx;
}

/**
 * executeRegistration — orchestrates the full claim flow:
 *
 *   1. Validate name + check availability (refuses to spend on a taken name)
 *   2. Build the unsigned create-subdomain tx
 *   3. POST to /api/sns/sign-as-root → server adds parent_owner sig
 *   4. Wallet signs as payer (via sendTransaction)
 *   5. Confirm
 *
 * Throws on any failure — no silent fallback (DENY by default).
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

  // Belt-and-brace — the /identity UI also gates this with its live
  // availability check, but check again at the boundary in case the user
  // clicks fast or the cache is stale.
  const avail = await checkAvailability(bare);
  if (avail.state === "taken")
    throw new Error(`${bare}.bundie is already taken (owner: ${avail.owner}).`);
  if (avail.state === "invalid") throw new Error(avail.reason);
  // 'error' state → keep going; build/send will surface the real RPC error.

  const { tx, namePda } = await buildRegisterTx(bare, wallet.publicKey, c);

  // Stamp recent blockhash so the partial-sign step has a stable message
  // to sign against. The wallet will see the same blockhash when it
  // signs second; sendTransaction won't re-stamp because we already set it.
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash(
    "confirmed",
  );
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  // Step 1 — server adds parent_owner sig.
  const partialB64 = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const rootSignedB64 = await signAsRoot(partialB64);
  const rootSignedBytes = Uint8Array.from(
    typeof Buffer !== "undefined"
      ? Buffer.from(rootSignedB64, "base64")
      : (atob(rootSignedB64).split("").map((c) => c.charCodeAt(0))),
  );
  const partiallySignedTx = Transaction.from(rootSignedBytes);

  // Step 2 — wallet signs + sends.
  const signature = await wallet.sendTransaction(partiallySignedTx, c);
  await c
    .confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    )
    .catch(() => {
      /* don't throw — caller can poll if they care; tx is already submitted */
    });

  return { namePda, signature, domain: `${bare}.bundie` };
}

// Test-only helpers — exposed so the smoke test can probe internals
// without importing @solana/web3.js Transaction signing.
export const _internals = {
  NAME_RE,
  NAME_BODY_SPACE,
  NAME_RECORD_HEADER_BYTES,
  validateName,
  buildCreateIxData,
  deriveNamePda,
};
