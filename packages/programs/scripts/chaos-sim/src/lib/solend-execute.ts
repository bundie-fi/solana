/**
 * solend-execute.ts — Solend lend executor against the surfpool mainnet
 * fork. Mirrors kamino-execute.ts and zeta-execute.ts for caching +
 * surfpool tx hygiene.
 *
 * Bootstrap on the FIRST lend call for an agent:
 *   1. Lazy-load `SolendMarket` against Solend's MAIN POOL on mainnet —
 *      the surfpool fork inherits the market state verbatim. We
 *      explicitly target the main pool (NOT "Turbo SOL", NOT any of the
 *      isolated-asset pools) since the brain is reasoning about the most
 *      liquid USDC reserve, which lives there.
 *   2. Resolve the USDC reserve inside the main pool.
 *   3. Build deposit ix bundle:
 *        a. createAssociatedTokenAccountIdempotent (USDC ATA, defensive)
 *        b. RefreshReserve(usdc reserve)
 *        c. RefreshObligation(agent obligation)
 *        d. DepositReserveLiquidityAndObligationCollateral
 *      The combined deposit ix atomically converts USDC → cToken and
 *      deposits the cToken as obligation collateral, so we don't have to
 *      manage cToken ATAs separately.
 *
 * RUNTIME CAVEATS:
 *   - `@solendprotocol/solend-sdk` is NOT currently in
 *     packages/programs/package.json. Until it is, this module exports
 *     STUB functions that throw a clear error explaining the missing
 *     dependency. The action-executor catches the throw and bubbles it
 *     up to the daemon's per-action try/catch as `phase=execute_error`.
 *   - The agent's USDC ATA must hold enough USDC for the deposit. The
 *     daemon calls `ensureSurfpoolUsdc` per-tick (see surfpool-seed.ts).
 *   - Surfpool tx hygiene: blockhash @ "processed", lastValidBlockHeight
 *     + 300 slots, skipPreflight: true. Same pattern as
 *     beethoven-execute.ts and kamino-execute.ts.
 *
 * NAMED PUBKEYS (mainnet, inherited by the fork):
 *   - Program        So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo
 *   - Main pool      4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY
 *   - USDC reserve   BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw
 *   - cUSDC mint     993dVFL2uXWYeoXuEBFXR4BijeXdTv4s6BzsCjJZuwqk
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

import { ensureSurfpoolUsdc, MAINNET_USDC_MINT } from "./surfpool-seed.js";

// ─── Mainnet constants ────────────────────────────────────────────────────

/** Solend program (mainnet — same id on the surfpool fork). */
export const SOLEND_PROGRAM_ID = "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo";

/** Solend "Main Pool" lending market on mainnet. */
export const SOLEND_MAIN_POOL = "4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY";

/** USDC reserve inside the main pool. */
export const SOLEND_MAIN_USDC_RESERVE =
  "BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw";

/** cUSDC mint backing the main-pool USDC reserve (collateral receipt). */
export const SOLEND_MAIN_CUSDC_MINT =
  "993dVFL2uXWYeoXuEBFXR4BijeXdTv4s6BzsCjJZuwqk";

// ─── Result types ─────────────────────────────────────────────────────────

export interface SolendDepositResult {
  protocol: "solend";
  action: "lend_deposit";
  txSig: string;
  /** Reserve pubkey the deposit landed in. */
  reserveAddress: string;
  /** Liquidity mint of the reserve (USDC by default). */
  reserveLiquidityMint: string;
  /** Base units of `reserveLiquidityMint` deposited. */
  amountBaseUnits: number;
  /** Number of ix's bundled into the submitted tx (informational). */
  ixCount: number;
}

export interface SolendWithdrawResult {
  protocol: "solend";
  action: "lend_withdraw";
  txSig: string;
  reserveAddress: string;
  reserveLiquidityMint: string;
  amountBaseUnits: number;
  ixCount: number;
}

// ─── Module-level caches (matches zeta-execute.ts pattern) ────────────────

let solendMarket: unknown = null;
let solendMarketLoadPromise: Promise<unknown> | null = null;

const obligationCache = new Map<string, unknown>();
const obligationLoadPromises = new Map<string, Promise<unknown>>();

// ─── Public API (stubbed until SDK lands) ─────────────────────────────────

export interface DepositSolendArgs {
  /** web3.js Connection pointed at surfpool. */
  surfpool: Connection;
  /** Agent keypair. */
  vault: Keypair;
  /** USDC amount in UI units (e.g. 0.5 = 0.5 USDC). */
  amountUsdcUi: number;
  /** Optional reserve override; defaults to main-pool USDC reserve. */
  reserveAddress?: string;
}

export interface WithdrawSolendArgs {
  surfpool: Connection;
  vault: Keypair;
  /** UI amount to withdraw (in USDC for the default reserve). */
  amountUsdcUi: number;
  reserveAddress?: string;
}

function sdkMissingError(direction: "deposit" | "withdraw"): never {
  throw new Error(
    `solend-execute: cannot ${direction} — @solendprotocol/solend-sdk is not installed. ` +
      `Add it to packages/programs/package.json devDependencies (latest stable: ^0.13.x), ` +
      `then replace the stub bodies in lib/solend-execute.ts with the real SDK calls ` +
      `(SolendMarket.initialize → market.refreshAll → reserve.depositReserveLiquidityAndObligationCollateral / ` +
      `depositObligationCollateralAndRedeemReserveCollateral).`,
  );
}

/**
 * Deposit USDC into the Solend main pool's USDC reserve on surfpool.
 *
 * STUB: throws `sdkMissingError` until @solendprotocol/solend-sdk is
 * added to devDependencies. The bootstrap flow once the SDK is present:
 *
 *   1. Ensure USDC funding via `ensureSurfpoolUsdc`.
 *   2. Boot or reuse the cached SolendMarket(MainPool).
 *   3. Resolve `reserveAddress ?? SOLEND_MAIN_USDC_RESERVE`.
 *   4. Build the ix bundle:
 *        - createAssociatedTokenAccountIdempotent (USDC ATA — defensive)
 *        - RefreshReserve(reserve)
 *        - RefreshObligation(agentObligationPda)
 *        - DepositReserveLiquidityAndObligationCollateral(amount, …)
 *   5. Submit through the existing surfpool Connection with surfpool
 *      tx hygiene (processed blockhash, +300 slots, skipPreflight).
 */
export async function depositSolend(
  args: DepositSolendArgs,
): Promise<SolendDepositResult> {
  const { surfpool, vault, amountUsdcUi } = args;
  if (amountUsdcUi <= 0) {
    throw new Error(
      `depositSolend: amountUsdcUi must be > 0 (got ${amountUsdcUi})`,
    );
  }
  const reserveAddress = args.reserveAddress ?? SOLEND_MAIN_USDC_RESERVE;

  // Belt-and-braces USDC seeding before the deposit attempt.
  await ensureSurfpoolUsdc(surfpool, vault.publicKey, Math.max(amountUsdcUi, 1000));

  // Touch caches so unused-var lint doesn't fire while stubbed.
  void solendMarket;
  void solendMarketLoadPromise;
  void obligationCache;
  void obligationLoadPromises;

  // TODO(solend): replace stub once @solendprotocol/solend-sdk is added.
  // Sketch of the real call against the main pool:
  //
  //   import { SolendMarket } from "@solendprotocol/solend-sdk";
  //   const market = await SolendMarket.initialize(surfpool, "production",
  //     new PublicKey(SOLEND_MAIN_POOL));
  //   await market.loadReserves();
  //   const reserve = market.reserves.find(r => r.config.address === reserveAddress);
  //   const txn = await reserve.depositReserveLiquidityAndObligationCollateral(
  //     vault.publicKey,
  //     new BN(Math.round(amountUsdcUi * 1_000_000)),
  //   );
  //   // Surfpool tx hygiene:
  //   const { blockhash, lastValidBlockHeight } =
  //     await surfpool.getLatestBlockhash("processed");
  //   txn.recentBlockhash = blockhash;
  //   txn.lastValidBlockHeight = lastValidBlockHeight + 300;
  //   txn.feePayer = vault.publicKey;
  //   const txSig = await sendAndConfirmTransaction(surfpool, txn, [vault], {
  //     commitment: "confirmed", skipPreflight: true,
  //   });
  sdkMissingError("deposit");

  // eslint-disable-next-line @typescript-eslint/no-unreachable
  return {
    protocol: "solend",
    action: "lend_deposit",
    txSig: "",
    reserveAddress,
    reserveLiquidityMint: MAINNET_USDC_MINT,
    amountBaseUnits: Math.round(amountUsdcUi * 1_000_000),
    ixCount: 0,
  };
}

/**
 * Withdraw USDC from the Solend main pool's USDC reserve on surfpool.
 *
 * STUB: throws `sdkMissingError` until @solendprotocol/solend-sdk is
 * added. Real flow uses
 * `withdrawObligationCollateralAndRedeemReserveCollateral` — the inverse
 * of the combined deposit ix — so we don't have to bounce through cToken
 * ATA management.
 */
export async function withdrawSolend(
  args: WithdrawSolendArgs,
): Promise<SolendWithdrawResult> {
  const { amountUsdcUi } = args;
  if (amountUsdcUi <= 0) {
    throw new Error(
      `withdrawSolend: amountUsdcUi must be > 0 (got ${amountUsdcUi})`,
    );
  }
  const reserveAddress = args.reserveAddress ?? SOLEND_MAIN_USDC_RESERVE;

  // TODO(solend): replace stub. Real call shape:
  //
  //   const txn = await reserve.withdrawObligationCollateralAndRedeemReserveCollateral(
  //     vault.publicKey,
  //     new BN(Math.round(amountUsdcUi * 1_000_000)),
  //   );
  sdkMissingError("withdraw");

  // eslint-disable-next-line @typescript-eslint/no-unreachable
  return {
    protocol: "solend",
    action: "lend_withdraw",
    txSig: "",
    reserveAddress,
    reserveLiquidityMint: MAINNET_USDC_MINT,
    amountBaseUnits: Math.round(amountUsdcUi * 1_000_000),
    ixCount: 0,
  };
}

// ─── TODOs (Phase Q follow-up) ────────────────────────────────────────────
//
// 1. Add `@solendprotocol/solend-sdk` to packages/programs/package.json
//    devDependencies (latest stable ^0.13.x).
//
// 2. Replace `sdkMissingError` bodies with the real SDK paths sketched
//    above. Return shapes are already finalized.
//
// 3. The caches (solendMarket / obligationCache / *LoadPromises) follow
//    the same lazy-load + dedup pattern as zeta-execute.ts. Hydrate them
//    on first call once the SDK lands.

// Touch unused imports so the linter doesn't flag them while stubbed.
// All of these are used by the *real* implementation sketched in the
// TODOs above (deposit/withdraw will need ATA setup + tx submission).
void createAssociatedTokenAccountIdempotentInstruction;
void getAssociatedTokenAddressSync;
void sendAndConfirmTransaction;
void Transaction;
void PublicKey;
