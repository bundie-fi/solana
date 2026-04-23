#!/usr/bin/env node
/**
 * marinade-probe-devnet.mjs — ground-truth Marinade `deposit` ix layout.
 *
 * Builds a Marinade `deposit` instruction via @marinade.finance/marinade-ts-sdk,
 * then dumps:
 *   • programId
 *   • keys[] (each with role flags) — this is the source-of-truth ordering
 *     for `MarinadeDepositAccounts` in beethoven/crates/deposit/marinade.
 *   • data hex (8-byte Anchor disc + 8-byte LE u64 lamports = 16 bytes)
 *
 * Read-only: never sends. Run with:
 *   node packages/programs/scripts/marinade-probe-devnet.mjs
 *
 * Optional env:
 *   RPC_URL          devnet RPC (default https://api.devnet.solana.com)
 *   KEYPAIR          path to signer keypair (default ~/.config/solana/id.json)
 *   AMOUNT_SOL       deposit size for the simulated ix (default 0.01)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Marinade, MarinadeConfig } from "@marinade.finance/marinade-ts-sdk";
import BN from "bn.js";

const RPC_URL      = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");
const AMOUNT_SOL   = parseFloat(process.env.AMOUNT_SOL || "0.01");

// Devnet — matches Marinade's published devnet deployment (slot 285395436).
const PROGRAM_ID_DEVNET = new PublicKey("MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD");
const STATE_DEVNET      = new PublicKey("8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC");

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const kpBytes = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")));
  const wallet = Keypair.fromSecretKey(kpBytes);

  console.log(`RPC:        ${RPC_URL}`);
  console.log(`Wallet:     ${wallet.publicKey.toBase58()}`);
  console.log(`Program:    ${PROGRAM_ID_DEVNET.toBase58()}`);
  console.log(`State:      ${STATE_DEVNET.toBase58()}`);
  console.log(`Amount:     ${AMOUNT_SOL} SOL`);
  console.log();

  const config = new MarinadeConfig({
    connection: conn,
    publicKey: wallet.publicKey,
    marinadeFinanceProgramId: PROGRAM_ID_DEVNET,
    marinadeStateAddress: STATE_DEVNET,
  });
  const marinade = new Marinade(config);

  const lamports = new BN(Math.floor(AMOUNT_SOL * 1e9));
  const { transaction } = await marinade.deposit(lamports);

  // The SDK returns a Transaction; the deposit ix is the last one. There may be
  // an associated-token-account create ix prepended if `mint_to` doesn't exist.
  const ix = transaction.instructions.find((i) =>
    i.programId.equals(PROGRAM_ID_DEVNET),
  );
  if (!ix) throw new Error("No Marinade ix found in returned transaction");

  console.log(`programId: ${ix.programId.toBase58()}`);
  console.log(`data:      0x${Buffer.from(ix.data).toString("hex")}  (len=${ix.data.length})`);

  // First 8 bytes should be the Anchor disc for `deposit`:
  //   sha256("global:deposit")[..8] = [242, 35, 198, 137, 82, 225, 242, 182]
  // Remaining 8 bytes = LE u64 lamports.
  const disc = Array.from(ix.data.slice(0, 8));
  const lamportsLE = Buffer.from(ix.data.slice(8, 16));
  console.log(`  disc:     [${disc.join(", ")}]`);
  console.log(`  lamports: ${lamportsLE.readBigUInt64LE(0).toString()}`);
  console.log();

  console.log(`keys[] (${ix.keys.length} accounts):`);
  ix.keys.forEach((k, i) => {
    const flags = `${k.isSigner ? "S" : "-"}${k.isWritable ? "W" : "-"}`;
    console.log(`  ${String(i).padStart(2)}  ${flags}  ${k.pubkey.toBase58()}`);
  });
  console.log();

  console.log("Compare against Rust MarinadeDepositAccounts in:");
  console.log("  packages/beethoven/crates/deposit/marinade/src/lib.rs");
}

main().catch((e) => {
  console.error("\n✗", e?.stack || e);
  process.exit(1);
});
