/**
 * funding.ts — distribute SOL + USDC from the deployer keypair to the pool.
 *
 * Devnet USDC mint authority is multisig — there's no faucet. We draw from
 * the deployer's existing balance (`solana balance` + `spl-token accounts`).
 *
 * Single batched tx for SOL (system transfer × N) and a second for USDC
 * (spl-token transferChecked × N, ATAs auto-created if missing).
 *
 * Idempotent-ish: we check current balances first and skip wallets that
 * are already at-or-above the seed amount. Re-running this is safe.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEVNET_USDC_MINT,
  RPC_URL,
  SEED_SOL_LAMPORTS,
  SEED_USDC_BASE_UNITS,
} from "./config.js";
import { ChaosWallet } from "./wallets.js";

const USDC_DECIMALS = 6;

/** ChaosWallet exposes only `pubkeyB58` post-Zerion-vault migration. funding.ts
 *  only needs the destination pubkey (never the secret), so we lift it via a
 *  small helper instead of accessing `keypair` (which is now optional). */
function chaosPub(w: ChaosWallet): PublicKey {
  return new PublicKey(w.pubkeyB58);
}

function loadDeployer(): Keypair {
  const path = process.env.SOLANA_KEYPAIR || join(homedir(), ".config/solana/id.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

interface FundingPlan {
  needsSol: ChaosWallet[];
  needsUsdc: ChaosWallet[];
  solRequired: number;
  usdcRequired: number;
}

async function buildPlan(
  conn: Connection,
  wallets: ChaosWallet[],
): Promise<FundingPlan> {
  const needsSol: ChaosWallet[] = [];
  const needsUsdc: ChaosWallet[] = [];
  for (const w of wallets) {
    const sol = await conn.getBalance(chaosPub(w), "confirmed");
    if (sol < SEED_SOL_LAMPORTS) needsSol.push(w);

    const ata = getAssociatedTokenAddressSync(
      DEVNET_USDC_MINT,
      chaosPub(w),
    );
    let usdc = 0n;
    try {
      const acc = await getAccount(conn, ata, "confirmed");
      usdc = acc.amount;
    } catch {
      usdc = 0n;
    }
    if (usdc < BigInt(SEED_USDC_BASE_UNITS)) needsUsdc.push(w);
  }
  return {
    needsSol,
    needsUsdc,
    solRequired: needsSol.length * SEED_SOL_LAMPORTS,
    usdcRequired: needsUsdc.length * SEED_USDC_BASE_UNITS,
  };
}

async function fundSol(
  conn: Connection,
  deployer: Keypair,
  targets: ChaosWallet[],
): Promise<string[]> {
  if (targets.length === 0) return [];
  // 10 SystemProgram.transfer ixs fit comfortably in one tx, but chunk
  // anyway for symmetry with the USDC path.
  const CHUNK = 8;
  const sigs: string[] = [];
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
    for (const t of chunk) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: deployer.publicKey,
          toPubkey: chaosPub(t),
          lamports: SEED_SOL_LAMPORTS,
        }),
      );
    }
    const sig = await sendAndConfirmTransaction(conn, tx, [deployer], {
      commitment: "confirmed",
    });
    sigs.push(sig);
  }
  return sigs;
}

async function fundUsdc(
  conn: Connection,
  deployer: Keypair,
  targets: ChaosWallet[],
): Promise<string[]> {
  if (targets.length === 0) return [];
  const deployerAta = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    deployer.publicKey,
  );
  // 4 targets per tx = 8 ixs (createATA + transferChecked) + budget ix.
  // Stays well under the 1232-byte legacy tx size.
  const CHUNK = 4;
  const sigs: string[] = [];
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    for (const t of chunk) {
      const ata = getAssociatedTokenAddressSync(
        DEVNET_USDC_MINT,
        chaosPub(t),
      );
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          deployer.publicKey,
          ata,
          chaosPub(t),
          DEVNET_USDC_MINT,
        ),
      );
      tx.add(
        createTransferCheckedInstruction(
          deployerAta,
          DEVNET_USDC_MINT,
          ata,
          deployer.publicKey,
          BigInt(SEED_USDC_BASE_UNITS),
          USDC_DECIMALS,
        ),
      );
    }
    const sig = await sendAndConfirmTransaction(conn, tx, [deployer], {
      commitment: "confirmed",
    });
    sigs.push(sig);
  }
  return sigs;
}

export async function fundPool(wallets: ChaosWallet[]): Promise<void> {
  const conn = new Connection(RPC_URL, "confirmed");
  const deployer = loadDeployer();
  console.log(`funding from deployer ${deployer.publicKey.toBase58()}`);

  const plan = await buildPlan(conn, wallets);
  console.log(
    `plan: ${plan.needsSol.length} wallets need SOL (${plan.solRequired / 1e9} total)`,
  );
  console.log(
    `plan: ${plan.needsUsdc.length} wallets need USDC (${plan.usdcRequired / 1e6} total)`,
  );

  // Sanity-check deployer balance before sending
  const deployerSol = await conn.getBalance(deployer.publicKey, "confirmed");
  if (deployerSol < plan.solRequired + 5_000_000) {
    throw new Error(
      `deployer SOL too low: have ${deployerSol / 1e9}, need ${plan.solRequired / 1e9} + fees`,
    );
  }
  if (plan.usdcRequired > 0) {
    const deployerAta = getAssociatedTokenAddressSync(
      DEVNET_USDC_MINT,
      deployer.publicKey,
    );
    const deployerUsdc = (await getAccount(conn, deployerAta, "confirmed")).amount;
    if (deployerUsdc < BigInt(plan.usdcRequired)) {
      throw new Error(
        `deployer USDC too low: have ${Number(deployerUsdc) / 1e6}, need ${plan.usdcRequired / 1e6}`,
      );
    }
  }

  const solSigs = await fundSol(conn, deployer, plan.needsSol);
  for (const s of solSigs) console.log(`SOL fund tx: ${s}`);
  const usdcSigs = await fundUsdc(conn, deployer, plan.needsUsdc);
  for (const s of usdcSigs) console.log(`USDC fund tx: ${s}`);

  if (solSigs.length === 0 && usdcSigs.length === 0) {
    console.log("nothing to fund — pool already at target balances");
  }
}
