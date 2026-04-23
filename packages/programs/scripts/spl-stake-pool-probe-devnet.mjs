#!/usr/bin/env node
/**
 * spl-stake-pool-probe-devnet.mjs — dump the wire layout of a `DepositSol`
 * instruction against an SPL stake pool on devnet, to verify the byte map
 * our beethoven-deposit-spl-stake-pool crate produces.
 *
 * Read-only — builds the ix and prints accounts + data, never sends a tx.
 *
 * What we're verifying against the canonical SPL stake-pool source
 * (https://github.com/solana-program/stake-pool/blob/main/program/src/instruction.rs):
 *
 *   instruction enum tag for DepositSol = 14 (single u8, Borsh-encoded)
 *   args:                                  lamports: u64 LE
 *   total ix data length:                  9 bytes
 *   accounts (10 required, 11 if pool has sol_deposit_authority):
 *     0. [w]  stake_pool
 *     1. [ ]  withdraw_authority         (PDA: [pool, "withdraw"])
 *     2. [w]  reserve_stake
 *     3. [s]  lamports_from              (writable signer = wallet)
 *     4. [w]  pool_tokens_to             (recipient ATA for pool LST)
 *     5. [w]  manager_fee_account
 *     6. [w]  referrer_pool_tokens_account
 *     7. [w]  pool_mint
 *     8. [ ]  system_program
 *     9. [ ]  token_program
 *    10. [s]  sol_deposit_authority      (OPTIONAL — only if pool has one)
 *
 * Env overrides:
 *   RPC_URL          devnet RPC                (default: api.devnet.solana.com)
 *   KEYPAIR          path to wallet keypair    (default: ~/.config/solana/id.json)
 *   STAKE_POOL       pool address to probe     (default: discovered)
 *   AMOUNT_LAMPORTS  deposit size for ix       (default: 1_000_000 = 0.001 SOL)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  STAKE_POOL_PROGRAM_ID,
  depositSolInstruction,
  getStakePoolAccount,
} from "@solana/spl-stake-pool";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH =
  process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");
const AMOUNT_LAMPORTS = BigInt(process.env.AMOUNT_LAMPORTS || "1000000");

// Known SPL stake pools that have historically run on devnet. We probe each
// in order until we find one that exists and has a deposit-permissioned
// reserve. None are guaranteed long-lived on devnet — set STAKE_POOL to
// override with a fresh address.
const KNOWN_DEVNET_POOLS = [
  // BlazeStake bSOL — devnet test pool (verify at stake.solblaze.org)
  "azFVdHtAJN8BX3sbGAYkXvtdjdrT5U6rj9rovvUFos9",
];

async function discoverPool(conn) {
  if (process.env.STAKE_POOL) {
    return new PublicKey(process.env.STAKE_POOL);
  }
  for (const candidate of KNOWN_DEVNET_POOLS) {
    const pk = new PublicKey(candidate);
    const info = await conn.getAccountInfo(pk);
    if (info && info.owner.equals(STAKE_POOL_PROGRAM_ID)) {
      return pk;
    }
  }
  // Fallback: enumerate all StakePool accounts on devnet. SPL stake pool's
  // `StakePool` discriminator is the first byte = 1 (AccountType::StakePool).
  // Pools are 611 bytes — filter to keep the RPC response small.
  console.log("No known pool found, scanning getProgramAccounts…");
  const accounts = await conn.getProgramAccounts(STAKE_POOL_PROGRAM_ID, {
    filters: [
      { dataSize: 611 },
      { memcmp: { offset: 0, bytes: "2" } }, // base58 of [1] = StakePool tag
    ],
  });
  if (accounts.length === 0) {
    throw new Error("No StakePool accounts found on devnet");
  }
  return accounts[0].pubkey;
}

function fmtMeta(m, i) {
  const flags = [];
  if (m.isSigner) flags.push("S");
  if (m.isWritable) flags.push("W");
  const f = flags.length ? `[${flags.join("")}]` : "[ ]";
  return `  ${String(i).padStart(2, "0")}. ${f}  ${m.pubkey.toBase58()}`;
}

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const kpBytes = Uint8Array.from(
    JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")),
  );
  const wallet = Keypair.fromSecretKey(kpBytes);

  console.log(`RPC:           ${RPC_URL}`);
  console.log(`Wallet:        ${wallet.publicKey.toBase58()}`);
  console.log(`Program:       ${STAKE_POOL_PROGRAM_ID.toBase58()}`);

  const stakePoolPk = await discoverPool(conn);
  console.log(`Stake pool:    ${stakePoolPk.toBase58()}`);

  const pool = await getStakePoolAccount(conn, stakePoolPk);
  const account = pool.account.data;
  console.log(`Pool mint:     ${account.poolMint.toBase58()}`);
  console.log(`Reserve stake: ${account.reserveStake.toBase58()}`);
  console.log(`Manager fee:   ${account.managerFeeAccount.toBase58()}`);
  console.log(
    `SOL deposit auth: ${
      account.solDepositAuthority ? account.solDepositAuthority.toBase58() : "(none)"
    }`,
  );

  // Derive the withdraw authority PDA: ["withdraw"] under the pool key.
  const [withdrawAuthority] = PublicKey.findProgramAddressSync(
    [stakePoolPk.toBuffer(), Buffer.from("withdraw")],
    STAKE_POOL_PROGRAM_ID,
  );
  console.log(`Withdraw auth: ${withdrawAuthority.toBase58()}`);

  // Use the wallet itself as the (placeholder) pool token recipient — we
  // never send the tx, this is purely for layout inspection.
  const poolTokensTo = wallet.publicKey;
  const referrer = poolTokensTo;

  const TOKEN_PROGRAM_ID = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  );

  const ix = depositSolInstruction(
    STAKE_POOL_PROGRAM_ID,
    stakePoolPk,
    withdrawAuthority,
    account.reserveStake,
    wallet.publicKey,
    poolTokensTo,
    account.managerFeeAccount,
    referrer,
    account.poolMint,
    TOKEN_PROGRAM_ID,
    AMOUNT_LAMPORTS,
    account.solDepositAuthority ?? undefined,
  );

  console.log(`\nInstruction layout for DepositSol(${AMOUNT_LAMPORTS}):`);
  console.log(`  program_id:    ${ix.programId.toBase58()}`);
  console.log(`  account count: ${ix.keys.length}  (10 = no deposit auth, 11 = with)`);
  console.log(`  data length:   ${ix.data.length}  (expected 9: tag(1) + lamports_le(8))`);
  console.log(
    `  data hex:      ${Buffer.from(ix.data).toString("hex")}  (first byte = 0x0e = variant 14 = DepositSol)`,
  );
  const tag = ix.data[0];
  const lamportsLe = Buffer.from(ix.data.slice(1, 9));
  const decoded = lamportsLe.readBigUInt64LE();
  console.log(`  decoded:       tag=${tag} lamports=${decoded}`);
  console.log(`\nAccount metas:`);
  ix.keys.forEach((k, i) => console.log(fmtMeta(k, i)));

  // Cross-check against our crate's expected ordering.
  const expected = [
    ["stake_pool", true, true],
    ["withdraw_authority", false, false],
    ["reserve_stake", false, true],
    ["lamports_from", true, true],
    ["pool_tokens_to", false, true],
    ["manager_fee_account", false, true],
    ["referrer_pool_tokens_account", false, true],
    ["pool_mint", false, true],
    ["system_program", false, false],
    ["token_program", false, false],
    ["sol_deposit_authority", true, false],
  ];
  console.log(`\nCross-check vs beethoven-deposit-spl-stake-pool layout:`);
  let ok = true;
  for (let i = 0; i < ix.keys.length; i++) {
    const [name, expSigner, expWritable] = expected[i];
    const k = ix.keys[i];
    const match = k.isSigner === expSigner && k.isWritable === expWritable;
    if (!match) ok = false;
    console.log(
      `  ${i.toString().padStart(2, "0")}. ${name.padEnd(30)} ${
        match ? "OK" : `MISMATCH (got s=${k.isSigner} w=${k.isWritable}, expected s=${expSigner} w=${expWritable})`
      }`,
    );
  }
  console.log(`\n${ok ? "Layout matches" : "LAYOUT MISMATCH — inspect crate"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
