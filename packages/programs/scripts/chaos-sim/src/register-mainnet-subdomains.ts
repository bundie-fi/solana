// Registers alice.bundie.sol and bob.bundie.sol on MAINNET under
// bundie.sol (which we bought via Bonfida at tx
// 579dCD8xETYUkU9rjZ3ytbZioLnaKvZ9AYs7fsgTpnBjngL2andGivtqj3P7qw597TvCMJNDHtXFhE1dycRaBfi1).
//
// Parent: C9TC8NQvyXMHUU6vDhJAEdntoUVbjYVAuWVFR6M3xZec (bundie.sol)
//   owned by 6CtXsS3j6UnrFJpap3jxR5X4yULZsazVTQRJa9CLwksk
//   (keys/bundie-sol-authority.json)
// Owners of the two subdomains: the same alice/bob vault keypairs we
// use on devnet — ed25519 keys work on any cluster.
//
// Writes keys/mainnet-bundie-sol-subdomains.json as the SNS bounty
// evidence artifact.

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNameRecord, NAME_PROGRAM_ID } from "./sns-tree.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");

// Hard-coded mainnet RPC — this script writes to mainnet and mainnet only.
const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

// bundie.sol PDA + owner captured at purchase time.
const BUNDIE_SOL_PDA = new PublicKey("C9TC8NQvyXMHUU6vDhJAEdntoUVbjYVAuWVFR6M3xZec");

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const conn = new Connection(MAINNET_RPC, "confirmed");

  const authority = loadKeypair(join(KEYS_DIR, "bundie-sol-authority.json"));
  const alice = loadKeypair(join(KEYS_DIR, "alice-vault.json"));
  const bob = loadKeypair(join(KEYS_DIR, "bob-vault.json"));

  console.log(`RPC:            ${MAINNET_RPC}`);
  console.log(`bundie.sol PDA: ${BUNDIE_SOL_PDA.toBase58()}`);
  console.log(`Authority:      ${authority.publicKey.toBase58()}`);
  console.log(`Alice vault:    ${alice.publicKey.toBase58()}`);
  console.log(`Bob vault:      ${bob.publicKey.toBase58()}`);
  console.log("");

  // Sanity check: authority keypair must match on-chain owner.
  const info = await conn.getAccountInfo(BUNDIE_SOL_PDA, "confirmed");
  if (!info) throw new Error(`bundie.sol not found at ${BUNDIE_SOL_PDA.toBase58()} — are we on mainnet?`);
  const onchainOwner = new PublicKey(info.data.subarray(32, 64));
  if (!onchainOwner.equals(authority.publicKey)) {
    throw new Error(
      `bundie.sol is owned by ${onchainOwner.toBase58()}, not by our authority ${authority.publicKey.toBase58()}.`,
    );
  }

  console.log("==> alice.bundie.sol");
  const aliceRes = await ensureNameRecord(conn, {
    programId: NAME_PROGRAM_ID,
    label: "alice",
    parent: { pda: BUNDIE_SOL_PDA, ownerKeypair: authority },
    owner: alice,
    bodySpace: 256,
    payer: authority, // authority pays; alice's devnet-funded vault stays clean
  });
  console.log(`    PDA: ${aliceRes.pda.toBase58()} (existed=${aliceRes.existed}${aliceRes.signature ? ` sig=${aliceRes.signature}` : ""})`);

  console.log("==> bob.bundie.sol");
  const bobRes = await ensureNameRecord(conn, {
    programId: NAME_PROGRAM_ID,
    label: "bob",
    parent: { pda: BUNDIE_SOL_PDA, ownerKeypair: authority },
    owner: bob,
    bodySpace: 256,
    payer: authority,
  });
  console.log(`    PDA: ${bobRes.pda.toBase58()} (existed=${bobRes.existed}${bobRes.signature ? ` sig=${bobRes.signature}` : ""})`);

  const meta = {
    cluster: "mainnet-beta",
    programId: NAME_PROGRAM_ID.toBase58(),
    bundieSolPda: BUNDIE_SOL_PDA.toBase58(),
    bundieSolOwner: authority.publicKey.toBase58(),
    bundieSolPurchaseSignature:
      "579dCD8xETYUkU9rjZ3ytbZioLnaKvZ9AYs7fsgTpnBjngL2andGivtqj3P7qw597TvCMJNDHtXFhE1dycRaBfi1",
    alice: {
      vaultPubkey: alice.publicKey.toBase58(),
      snsPda: aliceRes.pda.toBase58(),
      name: "alice.bundie.sol",
      signature: aliceRes.signature,
    },
    bob: {
      vaultPubkey: bob.publicKey.toBase58(),
      snsPda: bobRes.pda.toBase58(),
      name: "bob.bundie.sol",
      signature: bobRes.signature,
    },
    createdAt: new Date().toISOString(),
  };
  const metaPath = join(KEYS_DIR, "mainnet-bundie-sol-subdomains.json");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`\nmetadata: ${metaPath}`);
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
