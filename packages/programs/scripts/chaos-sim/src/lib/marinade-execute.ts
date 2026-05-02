/**
 * marinade-execute.ts — direct Marinade stake/unstake executors used by
 * the chaos-sim agent runtime.
 *
 * Calls @marinade.finance/marinade-ts-sdk in-process: SDK derives the
 * Marinade State PDA chain (msol_mint, liq_pool_*, reserve_pda, …) and
 * builds the same `deposit` / `liquidUnstake` ixs Marinade's UI ships.
 *
 * Sibling executors follow the same pattern for their respective
 * protocols: kamino-execute.ts, marginfi-execute.ts, solend-execute.ts,
 * zeta-execute.ts. None of these CPI through any router — they call
 * each protocol directly. Mainnet rate observation is separate
 * (rate-surfaces.ts).
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { Marinade, MarinadeConfig } from "@marinade.finance/marinade-ts-sdk";

export interface StakeResult {
  protocol: "marinade";
  action: "lst_stake";
  txSig: string;
  /** Associated mSOL token account created / topped up. */
  mSolTokenAccount: string;
  /** Amount staked in lamports. */
  stakedLamports: number;
}

export interface UnstakeResult {
  protocol: "marinade";
  action: "lst_unstake";
  txSig: string;
  solRecovered: number;
}

/**
 * Deposit SOL into Marinade on devnet using the marinade-ts-sdk.
 *
 * Account ordering produced by the SDK:
 *   state, msol_mint, liq_pool_sol_leg_pda, liq_pool_msol_leg,
 *   liq_pool_msol_leg_authority, reserve_pda, transfer_from, mint_to,
 *   msol_mint_authority, system_program, token_program
 *
 * The SDK derives all PDAs from the Marinade State account
 * (8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC).
 */
export async function stakeMarinade(
  conn: Connection,
  vault: Keypair,
  amountSolUi: number,
): Promise<StakeResult> {
  const amountLamports = Math.floor(amountSolUi * LAMPORTS_PER_SOL);
  if (amountLamports <= 0) {
    throw new Error(`stakeMarinade: amountSolUi=${amountSolUi} results in 0 lamports`);
  }

  const config = new MarinadeConfig({
    connection: conn,
    publicKey: vault.publicKey,
  });
  const marinade = new Marinade(config);

  const { transaction, associatedMSolTokenAccountAddress } =
    await marinade.deposit(new BN(amountLamports));

  transaction.feePayer = vault.publicKey;
  // Use `processed` for the blockhash on surfpool — `confirmed` lags behind
  // by several slots and the default 150-slot validity window collapses to
  // ~30s of headroom, which often expires before sendAndConfirmTransaction
  // finishes its slow polling loop. Bumping lastValidBlockHeight by 300
  // extra slots (~2min) gives us margin without going stale enough that
  // the network rejects the blockhash.
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("processed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight + 300;

  const txSig = await sendAndConfirmTransaction(conn, transaction, [vault], {
    commitment: "confirmed",
    skipPreflight: true,
  });

  return {
    protocol: "marinade",
    action: "lst_stake",
    txSig,
    mSolTokenAccount: associatedMSolTokenAccountAddress.toBase58(),
    stakedLamports: amountLamports,
  };
}

/**
 * Liquid-unstake mSOL back to SOL via Marinade on devnet.
 *
 * Uses Marinade's liquidity pool for instant SOL return (small fee).
 * For large amounts, consider delayed unstake (order ticket) instead.
 */
export async function unstakeMarinade(
  conn: Connection,
  vault: Keypair,
  amountMsolUi: number,
): Promise<UnstakeResult> {
  const amountLamports = Math.floor(amountMsolUi * LAMPORTS_PER_SOL);
  if (amountLamports <= 0) {
    throw new Error(`unstakeMarinade: amountMsolUi=${amountMsolUi} results in 0`);
  }

  const config = new MarinadeConfig({
    connection: conn,
    publicKey: vault.publicKey,
  });
  const marinade = new Marinade(config);

  const { transaction } = await marinade.liquidUnstake(new BN(amountLamports));

  transaction.feePayer = vault.publicKey;
  // Same surfpool-specific timing fix as stakeMarinade — see comment there.
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("processed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight + 300;

  const txSig = await sendAndConfirmTransaction(conn, transaction, [vault], {
    commitment: "confirmed",
    skipPreflight: true,
  });

  return {
    protocol: "marinade",
    action: "lst_unstake",
    txSig,
    solRecovered: amountMsolUi, // approximate, actual depends on mSOL price
  };
}
