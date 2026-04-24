import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Keypair, Transaction, SystemProgram, Connection } from "@solana/web3.js";

// Build the simplest legal Solana tx (transfer 1 lamport to self) so we
// can exercise `agent execute` end-to-end. It's a real tx that will
// confirm on devnet — no swap, no policy-meaningful payload, just enough
// to prove the policy → sign → broadcast → record path works.
const VAULT_AGENT_ROLE = "creator-0";

// 1) Get the agent's pubkey from the vault.
const list = JSON.parse(spawnSync("node", [
  "/mnt/storage/yields-v2/packages/zerion-agent/src/cli.js", "agent", "list",
], { encoding: "utf-8" }).stdout);
const agent = list.agents.find((a) => a.role === VAULT_AGENT_ROLE);
if (!agent) {
  console.error(`No vault agent for role ${VAULT_AGENT_ROLE}`);
  process.exit(1);
}
console.log(`Using agent ${VAULT_AGENT_ROLE} pubkey ${agent.pubkey}`);

// 2) Build a minimal "transfer 1 lamport to self" tx.
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
const tx = new Transaction().add(SystemProgram.transfer({
  fromPubkey: new (await import("@solana/web3.js")).PublicKey(agent.pubkey),
  toPubkey: new (await import("@solana/web3.js")).PublicKey(agent.pubkey),
  lamports: 1,
}));
tx.feePayer = new (await import("@solana/web3.js")).PublicKey(agent.pubkey);
tx.recentBlockhash = blockhash;
const txB64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");

// 3) Hand to `zerion-bundie agent execute` with action=create-strategy.
console.log("Calling agent execute...");
const exec = spawnSync("node", [
  "/mnt/storage/yields-v2/packages/zerion-agent/src/cli.js", "agent", "execute",
  "--name", VAULT_AGENT_ROLE,
  "--action", "create-strategy",
  "--tx", txB64,
  "--notional-usd", "0.5",
  "--rpc", "https://api.devnet.solana.com",
], { encoding: "utf-8" });

console.log("--- stdout ---");
console.log(exec.stdout);
console.log("--- stderr ---");
console.log(exec.stderr);
console.log(`exit: ${exec.status}`);
