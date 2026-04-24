// Registers alice.bundie, bob.bundie, and charlie.bundie as subdomains
// under the protocol-owned .bundie root. Writes keys/agent-subdomains.json
// with the three PDAs + vault pubkeys so each agent's policies.yaml can be
// updated to real values.
//
// Idempotent — safe to re-run. `ensureNameRecord` no-ops if the subdomain
// already exists and its on-chain owner matches the local vault keypair.
//
// Replaces the previous two-agent `register-alice-bob.ts` script. The old
// `keys/alice-bob-sns.json` output is preserved for backwards-compat but
// new runs also emit `keys/agent-subdomains.json`.

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
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
  const path =
    process.env.SOLANA_KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;
  return loadKeypair(path);
}

interface AgentSpec {
  label: string;
  name: string;
  vaultKeyPath: string;
}

const AGENTS: AgentSpec[] = [
  { label: "alice", name: "alice.bundie", vaultKeyPath: "alice-vault.json" },
  { label: "bob", name: "bob.bundie", vaultKeyPath: "bob-vault.json" },
  { label: "charlie", name: "charlie.bundie", vaultKeyPath: "charlie-vault.json" },
];

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const deployer = loadDeployer();
  const rootOwner = loadKeypair(join(KEYS_DIR, "bundie-root-owner.json"));
  const rootMeta = JSON.parse(
    readFileSync(join(KEYS_DIR, "bundie-root.json"), "utf8"),
  );
  const rootPda = new PublicKey(rootMeta.rootPda);

  console.log(`RPC:                ${RPC_URL}`);
  console.log(`Deployer:           ${deployer.publicKey.toBase58()}`);
  console.log(`.bundie root owner: ${rootOwner.publicKey.toBase58()}`);
  console.log(`.bundie root PDA:   ${rootPda.toBase58()}`);
  console.log("");

  const results: Record<string, unknown> = {};

  for (const spec of AGENTS) {
    const vault = loadKeypair(join(KEYS_DIR, spec.vaultKeyPath));
    console.log(`==> ${spec.name}`);
    console.log(`    vault: ${vault.publicKey.toBase58()}`);

    const res = await ensureNameRecord(conn, {
      programId: NAME_PROGRAM_ID,
      label: spec.label,
      parent: { pda: rootPda, ownerKeypair: rootOwner },
      owner: vault,
      bodySpace: 256,
      payer: deployer,
    });
    console.log(
      `    PDA:   ${res.pda.toBase58()} (existed=${res.existed}${
        res.signature ? ` sig=${res.signature}` : ""
      })`,
    );
    results[spec.label] = {
      vaultPubkey: vault.publicKey.toBase58(),
      snsPda: res.pda.toBase58(),
      name: spec.name,
      signature: res.signature,
    };
  }

  const metaPath = join(KEYS_DIR, "agent-subdomains.json");
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        cluster: "devnet",
        rootPda: rootPda.toBase58(),
        agents: results,
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
