/**
 * sns-tree.ts — generalized SPL Name Service tree bootstrap.
 *
 * Extracted from setup-bundie-root.ts so the same idempotent machinery
 * can stand up either a root (parent = default) or a subdomain
 * (parent = another NameRegistry PDA, whose owner must co-sign).
 *
 * Key nuances preserved from the original script:
 *
 *   - PDA seeds: [hashed_name, class_pubkey, parent_pubkey]. Both class
 *     and parent default to the 32-byte zero address for a root.
 *   - Create ix account list (processor.rs:32-82):
 *       0. system program
 *       1. payer            [signer, writable]
 *       2. name PDA         [writable]
 *       3. name owner       [readonly]
 *       4. class            [readonly]  (default for our tree)
 *       5. parent           [readonly]  (default for root; parent PDA for sub)
 *       6. parent owner     [signer, readonly]  — ONLY when parent != default
 *   - Rent: we allocate `NAME_RECORD_HEADER_BYTES (96) + bodySpace` but pass
 *     only `bodySpace` to the ix — the on-chain program adds the 96B header
 *     itself in the allocate CPI (processor.rs:101). The previous bypass
 *     that forgot the +96 under-funded the account.
 *   - Idempotency: if the PDA already exists we verify (a) owner == SPL
 *     Name Service program, (b) data length >= 96, (c) on-chain owner
 *     pubkey (bytes [32..64]) matches our local `owner` keypair. Any
 *     mismatch throws — same as the original script.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";

/** SPL Name Service program. Same ID on mainnet and devnet. */
export const NAME_PROGRAM_ID = new PublicKey(
  "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX",
);

/** Default SPL Name Service hash prefix applied before sha256. */
export const DEFAULT_HASH_PREFIX = "SPL Name Service";

/**
 * 96-byte NameRecordHeader (state.rs:36). Added automatically by the
 * on-chain program inside the allocate CPI — we include it in the rent
 * calculation but NOT in the `space` field of the Create ix.
 */
export const NAME_RECORD_HEADER_BYTES = 96;

const EMPTY_PUBKEY = new PublicKey(new Uint8Array(32));

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Derive the deterministic NameRegistry PDA for (label, parent, programId).
 *
 * Pure — no IO. `parent` omitted/null treats this as a root (parent seed
 * = 32 zero bytes). Class is always default for our trees.
 */
export function deriveNameRecord(
  label: string,
  opts: {
    programId: PublicKey;
    parent?: PublicKey | null;
    hashPrefix?: string;
  },
): { pda: PublicKey; hashed: Buffer } {
  const prefix = opts.hashPrefix ?? DEFAULT_HASH_PREFIX;
  const hashed = createHash("sha256").update(prefix + label, "utf8").digest();
  const parentBytes = opts.parent ? opts.parent.toBytes() : new Uint8Array(32);
  const seeds = [
    Uint8Array.from(hashed),
    new Uint8Array(32), // class = default
    parentBytes,
  ];
  const [pda] = PublicKey.findProgramAddressSync(seeds, opts.programId);
  return { pda, hashed };
}

/**
 * Encode the SPL Name Service `Create` ix data.
 *
 * Borsh-encoded NameRegistryInstruction::Create:
 *   tag: u8 = 0x00
 *   hashed_name: Vec<u8> (u32 LE length prefix + bytes)
 *   lamports: u64 LE
 *   space: u32 LE
 *
 * `space` is the body-only size (no 96B header) — the on-chain program
 * adds the header itself.
 */
export function buildCreateData(
  hashed: Buffer,
  lamports: bigint,
  space: number,
): Buffer {
  const data = Buffer.alloc(1 + 4 + hashed.length + 8 + 4);
  let off = 0;
  data.writeUInt8(0x00, off);
  off += 1;
  data.writeUInt32LE(hashed.length, off);
  off += 4;
  hashed.copy(data, off);
  off += hashed.length;
  data.writeBigUInt64LE(lamports, off);
  off += 8;
  data.writeUInt32LE(space, off);
  return data;
}

// ───────────────────────────────────────────────────────────────────────────
// On-chain helper
// ───────────────────────────────────────────────────────────────────────────

export interface NameRecordCfg {
  /** SPL Name Service program ID. Same mainnet + devnet. */
  programId: PublicKey;
  /** Label for this record. ".bundie" label is "bundie"; "bundie.sol" is "bundie" with parent=sol-pda. */
  label: string;
  /** Parent name record. `null` = top-level (class + parent default). */
  parent: { pda: PublicKey; ownerKeypair: Keypair } | null;
  /** Who will own this record on-chain. */
  owner: Keypair;
  /** Account bytes to allocate beyond the 96B header. */
  bodySpace: number;
  /** Fee-paying keypair. */
  payer: Keypair;
  /** Optional override; default "SPL Name Service". */
  hashPrefix?: string;
}

export interface EnsureResult {
  pda: PublicKey;
  existed: boolean;
  signature: string | null;
}

/**
 * De-dup a list of Keypairs by base58 public key while preserving order.
 * web3.js tolerates duplicate signers but it makes the signature list ugly
 * and can surface as confusing "signature verification failed" errors if
 * one path mutates and another doesn't.
 */
function dedupSigners(...signers: Keypair[]): Keypair[] {
  const seen = new Set<string>();
  const out: Keypair[] = [];
  for (const kp of signers) {
    const k = kp.publicKey.toBase58();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(kp);
  }
  return out;
}

/**
 * Idempotent on-chain NameRegistry creation.
 *
 * If the PDA already exists with the expected owner, this is a no-op and
 * returns `{ existed: true, signature: null }`. Otherwise submits a
 * `Create` ix and returns the signature.
 *
 * Throws if the PDA exists but is owned by another program, has unusable
 * data, or has a different on-chain owner. Error messages are copied
 * verbatim from the original setup-bundie-root.ts so operator-facing
 * output doesn't regress.
 */
export async function ensureNameRecord(
  conn: Connection,
  cfg: NameRecordCfg,
): Promise<EnsureResult> {
  const { pda, hashed } = deriveNameRecord(cfg.label, {
    programId: cfg.programId,
    parent: cfg.parent?.pda ?? null,
    hashPrefix: cfg.hashPrefix,
  });

  const existing = await conn.getAccountInfo(pda, "confirmed");
  if (existing) {
    if (!existing.owner.equals(cfg.programId)) {
      throw new Error(
        `Root PDA ${pda.toBase58()} exists but is owned by ${existing.owner.toBase58()}, not the SPL Name Service program. Refusing to proceed.`,
      );
    }
    // Header layout (state.rs:11-37): parent_name(32) | owner(32) | class(32)
    if (existing.data.length < NAME_RECORD_HEADER_BYTES) {
      throw new Error(
        `Root PDA exists but data is shorter than NameRecordHeader (${existing.data.length} < ${NAME_RECORD_HEADER_BYTES}).`,
      );
    }
    const onchainOwner = new PublicKey(existing.data.subarray(32, 64));
    if (!onchainOwner.equals(cfg.owner.publicKey)) {
      throw new Error(
        `Root PDA exists but on-chain owner is ${onchainOwner.toBase58()}, not our local rootOwner ${cfg.owner.publicKey.toBase58()}. ` +
          `If you regenerated keys/bundie-root-owner.json, restore the original or pick a new ROOT_LABEL.`,
      );
    }
    return { pda, existed: true, signature: null };
  }

  const totalSpace = NAME_RECORD_HEADER_BYTES + cfg.bodySpace;
  const lamports = BigInt(
    await conn.getMinimumBalanceForRentExemption(totalSpace),
  );
  const data = buildCreateData(hashed, lamports, cfg.bodySpace);

  const parentPubkey = cfg.parent?.pda ?? EMPTY_PUBKEY;
  const keys = [
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: cfg.payer.publicKey, isSigner: true, isWritable: true }, // payer
    { pubkey: pda, isSigner: false, isWritable: true }, // name PDA
    { pubkey: cfg.owner.publicKey, isSigner: false, isWritable: false }, // name owner
    { pubkey: EMPTY_PUBKEY, isSigner: false, isWritable: false }, // class = default
    { pubkey: parentPubkey, isSigner: false, isWritable: false }, // parent
  ];

  if (cfg.parent) {
    // slot 6: parent_owner must sign for subdomain creates (processor.rs:66-78)
    keys.push({
      pubkey: cfg.parent.ownerKeypair.publicKey,
      isSigner: true,
      isWritable: false,
    });
  }

  const ix = new TransactionInstruction({
    programId: cfg.programId,
    keys,
    data,
  });

  // Signer list: payer is always required (slot 1). parent_owner is the
  // only other signer, required when parent != default (slot 6, processor.rs:66-78).
  // The name owner at slot 3 has isSigner=false so it does NOT sign.
  // De-dup by pubkey so the same Keypair isn't passed twice when roles
  // collapse (e.g. payer == parent_owner).
  const signers = cfg.parent
    ? dedupSigners(cfg.payer, cfg.parent.ownerKeypair)
    : [cfg.payer];

  const tx = new Transaction().add(ix);
  const signature = await sendAndConfirmTransaction(conn, tx, signers, {
    commitment: "confirmed",
  });

  return { pda, existed: false, signature };
}
