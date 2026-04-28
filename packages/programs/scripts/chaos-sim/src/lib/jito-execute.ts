/**
 * jito-execute.ts — direct Jito stake/unstake executors used by the
 * chaos-sim agent runtime.
 *
 * Calls @solana/spl-stake-pool in-process: the SDK derives the SPL
 * stake-pool PDAs (withdraw authority, reserve stake, manager fee
 * account, pool mint) from the on-chain StakePool account and builds
 * the same `depositSol` / `withdrawSol` ixs the Jito UI ships.
 *
 * Sibling executor for marinade is in marinade-execute.ts; same tx
 * hygiene applies (skipPreflight + extended blockhash window) so
 * surfpool's slow confirmation polling doesn't blow the validity
 * window.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { depositSol, withdrawSol } from "@solana/spl-stake-pool";

/** Jito mainnet stake-pool address (also valid on the surfpool mainnet fork). */
const JITO_STAKE_POOL = new PublicKey(
  "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb",
);

export interface JitoStakeResult {
  protocol: "jito";
  action: "lst_stake";
  txSig: string;
  /** Associated jitoSOL token account created / topped up. */
  jitoSolTokenAccount: string;
  /** Amount staked in lamports. */
  stakedLamports: number;
}

export interface JitoUnstakeResult {
  protocol: "jito";
  action: "lst_unstake";
  txSig: string;
  solRecovered: number;
}

/**
 * Deposit SOL into Jito's SPL stake pool on the surfpool mainnet fork.
 *
 * SDK builds the depositSol ix list — derives reserve stake, withdraw
 * authority, manager fee account, pool mint from the on-chain StakePool
 * struct, and creates the destination jitoSOL ATA when missing.
 */
export async function stakeJito(
  conn: Connection,
  vault: Keypair,
  amountSolUi: number,
): Promise<JitoStakeResult> {
  const amountLamports = Math.floor(amountSolUi * LAMPORTS_PER_SOL);
  if (amountLamports <= 0) {
    throw new Error(`stakeJito: amountSolUi=${amountSolUi} results in 0 lamports`);
  }

  const { instructions, signers } = await depositSol(
    conn,
    JITO_STAKE_POOL,
    vault.publicKey,
    amountLamports,
  );

  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = vault.publicKey;
  // Same surfpool-specific timing fix as Marinade — see marinade-execute.ts.
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("processed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight + 300;

  const txSig = await sendAndConfirmTransaction(
    conn,
    transaction,
    [vault, ...signers],
    { commitment: "confirmed", skipPreflight: true },
  );

  // depositSol's last ix is the deposit itself; the destination pool-token
  // account is the 5th key on it (index 4 — see SPL stake-pool layout).
  // Pull it out of the ix rather than re-deriving the ATA so we report what
  // the SDK actually used.
  const depositIx = instructions[instructions.length - 1];
  const jitoSolTokenAccount = depositIx.keys[4].pubkey.toBase58();

  return {
    protocol: "jito",
    action: "lst_stake",
    txSig,
    jitoSolTokenAccount,
    stakedLamports: amountLamports,
  };
}

/**
 * Instant-unstake jitoSOL back to SOL via the SPL stake pool's withdrawSol
 * path on the surfpool mainnet fork.
 *
 * `amountJitoSolUi` is denominated in jitoSOL (the pool's pool-token), not
 * SOL — the SDK passes it through as the `pool_tokens` argument and the
 * pool returns SOL net of the withdrawal fee.
 */
export async function unstakeJito(
  conn: Connection,
  vault: Keypair,
  amountJitoSolUi: number,
): Promise<JitoUnstakeResult> {
  const amountLamports = Math.floor(amountJitoSolUi * LAMPORTS_PER_SOL);
  if (amountLamports <= 0) {
    throw new Error(`unstakeJito: amountJitoSolUi=${amountJitoSolUi} results in 0`);
  }

  const { instructions, signers } = await withdrawSol(
    conn,
    JITO_STAKE_POOL,
    vault.publicKey,
    vault.publicKey,
    amountLamports,
  );

  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = vault.publicKey;
  // Same surfpool-specific timing fix as stakeJito.
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("processed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight + 300;

  const txSig = await sendAndConfirmTransaction(
    conn,
    transaction,
    [vault, ...signers],
    { commitment: "confirmed", skipPreflight: true },
  );

  return {
    protocol: "jito",
    action: "lst_unstake",
    txSig,
    solRecovered: amountJitoSolUi, // approximate, actual depends on jitoSOL price
  };
}
