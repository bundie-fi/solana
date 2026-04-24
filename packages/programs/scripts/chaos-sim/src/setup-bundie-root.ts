/**
 * setup-bundie-root.ts — one-time creation of the `.bundie` root domain
 * on devnet under the SPL Name Service program.
 *
 * Why a custom root
 * ─────────────────
 * Bonfida's `.sol` registration requires a Pyth oracle for USDC pricing
 * that doesn't exist on devnet. Even if we bypass Bonfida's wrapper and
 * call SPL Name Service `Create` directly, the `.sol` PDA seeds include
 * `ROOT_DOMAIN_ACCOUNT` (Bonfida-owned) — the on-chain processor requires
 * the parent's owner to sign for any subdomain create. We can't sign as
 * Bonfida.
 *
 * Solution: stand up our own root domain on devnet. We own its keypair,
 * so we can co-sign every subdomain create. Same SPL Name Service program,
 * same `NameRegistry` PDAs, same reverse-lookup primitives — just a
 * different parent.
 *
 * This script:
 *   1. Loads or generates `keys/bundie-root-owner.json` (the keypair that
 *      will own the root and sign all subdomain creates).
 *   2. Derives the deterministic root PDA: hash("SPL Name Service" +
 *      "bundie") with parent + class = `Pubkey::default()`.
 *   3. If the PDA is already initialised, persists metadata and exits
 *      (idempotent — safe to re-run).
 *   4. Else builds the SPL Name Service `Create` ix and submits, signed
 *      by the deployer (~/.config/solana/id.json) as payer.
 *   5. Writes `keys/bundie-root.json` with the root PDA + owner pubkey
 *      so other modules can load it without re-deriving.
 *
 * Account list for root creation (research-verified against
 * solana-program-library/name-service/program/src/processor.rs:32-82):
 *   0. system program
 *   1. payer (deployer)                     [signer, writable]
 *   2. root PDA                             [writable]
 *   3. root owner pubkey                    [readonly]
 *   4. Pubkey::default() (no class)         [readonly]
 *   5. Pubkey::default() (no parent)        [readonly]
 *   (slot 6 omitted — only present when parent ≠ default)
 *
 * Rent: getMinimumBalanceForRentExemption(SPACE + 96). The 96 covers the
 * NameRecordHeader (state.rs:36); the previous bypass forgot it and would
 * have under-funded the account even if the parent slot had been correct.
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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RPC_URL } from "./config.js";

const NAME_PROGRAM_ID = new PublicKey(
  "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX",
);
const HASH_PREFIX = "SPL Name Service";

// 96-byte NameRecordHeader (state.rs:36) + 256B body. The body holds
// arbitrary data the owner can write later via `Update` — for the root we
// don't actually use it, but the SPL program won't accept space=0.
const NAME_RECORD_HEADER_BYTES = 96;
const ROOT_BODY_SPACE = 256;

const ROOT_LABEL = "bundie";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");
const ROOT_OWNER_PATH = join(KEYS_DIR, "bundie-root-owner.json");
const ROOT_METADATA_PATH = join(KEYS_DIR, "bundie-root.json");

function loadDeployer(): Keypair {
  const path = process.env.SOLANA_KEYPAIR || join(homedir(), ".config/solana/id.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadOrCreateRootOwner(): Keypair {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
  if (existsSync(ROOT_OWNER_PATH)) {
    const raw = JSON.parse(readFileSync(ROOT_OWNER_PATH, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  writeFileSync(
    ROOT_OWNER_PATH,
    JSON.stringify(Array.from(kp.secretKey)),
    { mode: 0o600 },
  );
  return kp;
}

function deriveRootPda(label: string): { pda: PublicKey; hashed: Buffer } {
  const hashed = createHash("sha256")
    .update(HASH_PREFIX + label, "utf8")
    .digest();
  const seeds = [
    Uint8Array.from(hashed),
    new Uint8Array(32), // class = default
    new Uint8Array(32), // parent = default
  ];
  const [pda] = PublicKey.findProgramAddressSync(seeds, NAME_PROGRAM_ID);
  return { pda, hashed };
}

function buildCreateData(hashed: Buffer, lamports: bigint, space: number): Buffer {
  // Borsh-encoded NameRegistryInstruction::Create
  //   tag: u8 = 0x00
  //   hashed_name: Vec<u8> (u32 LE length + bytes)
  //   lamports: u64 LE
  //   space: u32 LE
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

interface RootMetadata {
  label: string;
  domainSuffix: string; // ".bundie"
  rootPda: string;
  rootOwnerPubkey: string;
  programId: string;
  createdAt: string;
  createdSig: string | null; // null if pre-existing (idempotent re-run)
}

function writeMetadata(meta: RootMetadata): void {
  writeFileSync(ROOT_METADATA_PATH, JSON.stringify(meta, null, 2));
}

async function main(): Promise<void> {
  const conn = new Connection(RPC_URL, "confirmed");
  const deployer = loadDeployer();
  const rootOwner = loadOrCreateRootOwner();
  const { pda, hashed } = deriveRootPda(ROOT_LABEL);

  console.log(`SPL Name Service program: ${NAME_PROGRAM_ID.toBase58()}`);
  console.log(`Root label:               ${ROOT_LABEL}`);
  console.log(`Root PDA:                 ${pda.toBase58()}`);
  console.log(`Root owner:               ${rootOwner.publicKey.toBase58()}`);
  console.log(`Deployer (payer):         ${deployer.publicKey.toBase58()}`);
  console.log(`RPC:                      ${RPC_URL}`);
  console.log("");

  const existing = await conn.getAccountInfo(pda, "confirmed");
  if (existing) {
    if (!existing.owner.equals(NAME_PROGRAM_ID)) {
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
    if (!onchainOwner.equals(rootOwner.publicKey)) {
      throw new Error(
        `Root PDA exists but on-chain owner is ${onchainOwner.toBase58()}, not our local rootOwner ${rootOwner.publicKey.toBase58()}. ` +
          `If you regenerated keys/bundie-root-owner.json, restore the original or pick a new ROOT_LABEL.`,
      );
    }
    console.log("Root already exists and is owned by our local rootOwner. Persisting metadata.");
    writeMetadata({
      label: ROOT_LABEL,
      domainSuffix: `.${ROOT_LABEL}`,
      rootPda: pda.toBase58(),
      rootOwnerPubkey: rootOwner.publicKey.toBase58(),
      programId: NAME_PROGRAM_ID.toBase58(),
      createdAt: new Date().toISOString(),
      createdSig: null,
    });
    console.log(`metadata: ${ROOT_METADATA_PATH}`);
    return;
  }

  const totalSpace = NAME_RECORD_HEADER_BYTES + ROOT_BODY_SPACE;
  const lamports = BigInt(
    await conn.getMinimumBalanceForRentExemption(totalSpace),
  );
  console.log(
    `Creating root account: ${totalSpace} bytes (${NAME_RECORD_HEADER_BYTES} header + ${ROOT_BODY_SPACE} body), rent ${lamports} lamports`,
  );

  // Body field of the on-chain Create ix is `space` — the program adds the
  // 96B header itself in the allocate CPI (processor.rs:101). So we pass
  // ROOT_BODY_SPACE as `space`, but compute rent for the full size.
  const data = buildCreateData(hashed, lamports, ROOT_BODY_SPACE);

  const EMPTY_PUBKEY = new PublicKey(new Uint8Array(32));
  const ix = new TransactionInstruction({
    programId: NAME_PROGRAM_ID,
    keys: [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: deployer.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: pda, isSigner: false, isWritable: true }, // name PDA
      { pubkey: rootOwner.publicKey, isSigner: false, isWritable: false }, // name owner
      { pubkey: EMPTY_PUBKEY, isSigner: false, isWritable: false }, // class = default
      { pubkey: EMPTY_PUBKEY, isSigner: false, isWritable: false }, // parent = default
      // slot 6 (parent_owner) intentionally omitted — only required when
      // parent ≠ default (processor.rs:66-78)
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, tx, [deployer], {
    commitment: "confirmed",
  });
  console.log(`root created: ${sig}`);

  writeMetadata({
    label: ROOT_LABEL,
    domainSuffix: `.${ROOT_LABEL}`,
    rootPda: pda.toBase58(),
    rootOwnerPubkey: rootOwner.publicKey.toBase58(),
    programId: NAME_PROGRAM_ID.toBase58(),
    createdAt: new Date().toISOString(),
    createdSig: sig,
  });
  console.log(`metadata: ${ROOT_METADATA_PATH}`);
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
