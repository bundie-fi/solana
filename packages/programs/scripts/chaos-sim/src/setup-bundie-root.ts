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
 *
 * REFACTOR NOTE (Phase 4.1): the low-level encoding + submit lives in
 * sns-tree.ts now. This entrypoint is a thin wrapper that keeps the
 * `chaos:setup-root` pnpm script + the `keys/bundie-root.json` metadata
 * contract unchanged.
 */
import {
  Connection,
  Keypair,
} from "@solana/web3.js";
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
import {
  deriveNameRecord,
  ensureNameRecord,
  NAME_PROGRAM_ID,
} from "./sns-tree.js";

// 96-byte NameRecordHeader (state.rs:36) + 256B body. The body holds
// arbitrary data the owner can write later via `Update` — for the root we
// don't actually use it, but the SPL program won't accept space=0.
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
  const { pda } = deriveNameRecord(ROOT_LABEL, { programId: NAME_PROGRAM_ID });

  console.log(`SPL Name Service program: ${NAME_PROGRAM_ID.toBase58()}`);
  console.log(`Root label:               ${ROOT_LABEL}`);
  console.log(`Root PDA:                 ${pda.toBase58()}`);
  console.log(`Root owner:               ${rootOwner.publicKey.toBase58()}`);
  console.log(`Deployer (payer):         ${deployer.publicKey.toBase58()}`);
  console.log(`RPC:                      ${RPC_URL}`);
  console.log("");

  const result = await ensureNameRecord(conn, {
    programId: NAME_PROGRAM_ID,
    label: ROOT_LABEL,
    parent: null,
    owner: rootOwner,
    bodySpace: ROOT_BODY_SPACE,
    payer: deployer,
  });

  if (result.existed) {
    console.log("Root already exists and is owned by our local rootOwner. Persisting metadata.");
  } else {
    console.log(`root created: ${result.signature}`);
  }

  writeMetadata({
    label: ROOT_LABEL,
    domainSuffix: `.${ROOT_LABEL}`,
    rootPda: result.pda.toBase58(),
    rootOwnerPubkey: rootOwner.publicKey.toBase58(),
    programId: NAME_PROGRAM_ID.toBase58(),
    createdAt: new Date().toISOString(),
    createdSig: result.signature,
  });
  console.log(`metadata: ${ROOT_METADATA_PATH}`);
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
