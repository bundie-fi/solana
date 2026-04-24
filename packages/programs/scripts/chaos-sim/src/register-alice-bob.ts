// Registers alice.bundie and bob.bundie as subdomains under the protocol-
// owned .bundie root. Writes keys/alice-bob-sns.json with the two PDAs +
// vault pubkeys so the agent policies.yaml can be updated to real values.

import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNameRecord, NAME_PROGRAM_ID } from "./sns-tree.js";
import { RPC_URL } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadDeployer(): Keypair {
  const path = process.env.SOLANA_KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;
  return loadKeypair(path);
}

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const deployer = loadDeployer();
  const rootOwner = loadKeypair(join(KEYS_DIR, "bundie-root-owner.json"));
  const rootMeta = JSON.parse(
    readFileSync(join(KEYS_DIR, "bundie-root.json"), "utf8"),
  );
  const alice = loadKeypair(join(KEYS_DIR, "alice-vault.json"));
  const bob = loadKeypair(join(KEYS_DIR, "bob-vault.json"));

  const rootPda = new (await import("@solana/web3.js")).PublicKey(rootMeta.rootPda);
  console.log(`RPC:        ${RPC_URL}`);
  console.log(`Deployer:   ${deployer.publicKey.toBase58()}`);
  console.log(`.bundie root owner: ${rootOwner.publicKey.toBase58()}`);
  console.log(`.bundie root PDA:   ${rootPda.toBase58()}`);
  console.log(`alice vault: ${alice.publicKey.toBase58()}`);
  console.log(`bob   vault: ${bob.publicKey.toBase58()}`);
  console.log("");

  console.log("==> alice.bundie");
  const aliceRes = await ensureNameRecord(conn, {
    programId: NAME_PROGRAM_ID,
    label: "alice",
    parent: { pda: rootPda, ownerKeypair: rootOwner },
    owner: alice,
    bodySpace: 256,
    payer: deployer,
  });
  console.log(`    PDA: ${aliceRes.pda.toBase58()} (existed=${aliceRes.existed}${aliceRes.signature ? ` sig=${aliceRes.signature}` : ""})`);

  console.log("==> bob.bundie");
  const bobRes = await ensureNameRecord(conn, {
    programId: NAME_PROGRAM_ID,
    label: "bob",
    parent: { pda: rootPda, ownerKeypair: rootOwner },
    owner: bob,
    bodySpace: 256,
    payer: deployer,
  });
  console.log(`    PDA: ${bobRes.pda.toBase58()} (existed=${bobRes.existed}${bobRes.signature ? ` sig=${bobRes.signature}` : ""})`);

  const metaPath = join(KEYS_DIR, "alice-bob-sns.json");
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        cluster: "devnet",
        rootPda: rootPda.toBase58(),
        alice: {
          vaultPubkey: alice.publicKey.toBase58(),
          snsPda: aliceRes.pda.toBase58(),
          name: "alice.bundie",
          signature: aliceRes.signature,
        },
        bob: {
          vaultPubkey: bob.publicKey.toBase58(),
          snsPda: bobRes.pda.toBase58(),
          name: "bob.bundie",
          signature: bobRes.signature,
        },
      },
      null,
      2,
    ),
  );
  console.log(`\nmetadata: ${metaPath}`);
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
