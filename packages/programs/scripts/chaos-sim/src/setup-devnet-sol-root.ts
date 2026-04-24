/**
 * setup-devnet-sol-root.ts — idempotent devnet bootstrap for the mock
 * `.sol` tree.
 *
 * Why mock `.sol` on devnet
 * ─────────────────────────
 * Bonfida's real `.sol` root only exists on mainnet — their registration
 * wrapper relies on a Pyth USDC price feed that isn't deployed to devnet.
 * For chaos-sim + integration tests we want `bundie.sol`-style names to
 * resolve via plain SPL Name Service lookup. Since the `.sol` PDA derivation
 * is `hash("SPL Name Service" + "sol")` with default parent + class, and
 * devnet has no such account, we're free to stand up our own and sign as
 * its owner — the exact same trick we use for `.bundie`.
 *
 * This script creates, if they don't already exist:
 *   1. `.sol` root owned by the protocol-authority keypair.
 *   2. `bundie` subdomain under `.sol`, owned by the same protocol-authority.
 *
 * Metadata is written to `keys/devnet-sol-tree.json` capturing both PDAs
 * so downstream code can resolve `bundie.sol` without re-deriving.
 *
 * PHASE 4.2 NOTE: the user runs this against devnet themselves once the
 * mainnet-fork surfpool is ready. This module is pure TypeScript — no
 * RPC side effects happen at import time.
 */
import { Connection, Keypair } from "@solana/web3.js";
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
import { ensureNameRecord, NAME_PROGRAM_ID } from "./sns-tree.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");
const PROTOCOL_AUTHORITY_PATH = join(KEYS_DIR, "protocol-authority.json");
const METADATA_PATH = join(KEYS_DIR, "devnet-sol-tree.json");

function loadOrCreate(path: string): Keypair {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

function loadDeployer(): Keypair {
  const path = process.env.SOLANA_KEYPAIR || join(homedir(), ".config/solana/id.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main(): Promise<void> {
  const conn = new Connection(RPC_URL, "confirmed");
  const deployer = loadDeployer();
  const protocolAuthority = loadOrCreate(PROTOCOL_AUTHORITY_PATH);

  console.log(`RPC:              ${RPC_URL}`);
  console.log(`Deployer (payer): ${deployer.publicKey.toBase58()}`);
  console.log(`Protocol auth:    ${protocolAuthority.publicKey.toBase58()}`);
  console.log("");

  // 1. .sol root
  console.log("==> ensuring .sol root");
  const dotSol = await ensureNameRecord(conn, {
    programId: NAME_PROGRAM_ID,
    label: "sol",
    parent: null,
    owner: protocolAuthority,
    bodySpace: 256,
    payer: deployer,
  });
  console.log(
    `    .sol PDA: ${dotSol.pda.toBase58()}  (existed=${dotSol.existed}${
      dotSol.signature ? ` sig=${dotSol.signature}` : ""
    })`,
  );

  // 2. bundie subdomain under .sol
  console.log("==> ensuring bundie.sol subdomain");
  const bundieSol = await ensureNameRecord(conn, {
    programId: NAME_PROGRAM_ID,
    label: "bundie",
    parent: { pda: dotSol.pda, ownerKeypair: protocolAuthority },
    owner: protocolAuthority,
    bodySpace: 256,
    payer: deployer,
  });
  console.log(
    `    bundie.sol PDA: ${bundieSol.pda.toBase58()}  (existed=${bundieSol.existed}${
      bundieSol.signature ? ` sig=${bundieSol.signature}` : ""
    })`,
  );

  writeFileSync(
    METADATA_PATH,
    JSON.stringify(
      {
        cluster: "devnet",
        programId: NAME_PROGRAM_ID.toBase58(),
        dotSolPda: dotSol.pda.toBase58(),
        bundieSolPda: bundieSol.pda.toBase58(),
        protocolAuthorityPubkey: protocolAuthority.publicKey.toBase58(),
        createdAt: new Date().toISOString(),
        signatures: { dotSol: dotSol.signature, bundieSol: bundieSol.signature },
      },
      null,
      2,
    ),
  );
  console.log(`\nmetadata: ${METADATA_PATH}`);
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
