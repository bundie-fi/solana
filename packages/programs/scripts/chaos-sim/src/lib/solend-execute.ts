/**
 * solend-execute.ts — Solend lend executor against the surfpool mainnet
 * fork. Mirrors kamino-execute.ts and zeta-execute.ts for caching +
 * surfpool tx hygiene.
 *
 * Bootstrap on the FIRST lend call for an agent:
 *   1. Lazy-load `@solendprotocol/solend-sdk` + parse the on-chain
 *      Solend lending market (main pool) and USDC reserve once per
 *      process, keyed for cache reuse across ticks.
 *   2. Build `SolendActionCore.buildDepositTxns` (or
 *      `buildWithdrawTxns`) — the SDK auto-bundles obligation init,
 *      RefreshReserve, RefreshObligation, and the lending ix.
 *   3. Call `getTransactions(blockhash)` to get pre/lending/post
 *      VersionedTransactions, sign them with the agent keypair, and
 *      submit each in order through the existing surfpool Connection
 *      with surfpool tx hygiene (processed blockhash, skipPreflight).
 *
 * RUNTIME CAVEATS:
 *   - `@solendprotocol/solend-sdk` is loaded via dynamic import so
 *     eagerly importing this file from action-executor.ts doesn't drag
 *     the SDK chain (which transitively pins
 *     @solana/web3.js@1.92.3 + rpc-websockets@7.11.0) in at daemon
 *     startup. Same precaution as zeta-execute.ts. Lazy-load is
 *     mandatory, not optional.
 *   - The agent's USDC ATA must hold enough USDC for the deposit. The
 *     daemon calls `ensureSurfpoolUsdc` per-tick (see surfpool-seed.ts).
 *   - Surfpool tx hygiene: blockhash @ "processed", lastValidBlockHeight
 *     + 300 slots, skipPreflight: true. Same pattern as kamino-execute.
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
  VersionedTransaction,
} from "@solana/web3.js";

import { ensureSurfpoolUsdc, MAINNET_USDC_MINT } from "./surfpool-seed.js";

// Re-export for symmetry with kamino-execute.
export { MAINNET_USDC_MINT };

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

// ─── Module-level caches ──────────────────────────────────────────────────
//
// `InputPoolType` describes the lending market plus a list of all reserves
// the SDK might need to refresh. We only ever interact with the USDC
// reserve, so the cache holds a minimal pool with that single reserve.
// Both pool + reserve are reused across agents (mainnet state is the same
// for everyone; only the obligation PDA varies per agent).

interface CachedPoolReserve {
  /** `InputPoolType` shape expected by SolendActionCore. */
  pool: {
    address: string;
    owner: string;
    name: string | null;
    authorityAddress: string;
    reserves: Array<{
      address: string;
      pythOracle: string;
      switchboardOracle: string;
      mintAddress: string;
      liquidityFeeReceiverAddress: string;
      extraOracle?: string;
    }>;
  };
  /** `InputReserveType` shape expected by SolendActionCore. */
  reserve: {
    address: string;
    liquidityAddress: string;
    cTokenMint: string;
    cTokenLiquidityAddress: string;
    pythOracle: string;
    switchboardOracle: string;
    mintAddress: string;
    liquidityFeeReceiverAddress: string;
  };
}

const poolReserveCache = new Map<string, CachedPoolReserve>();
const poolReserveLoadPromises = new Map<string, Promise<CachedPoolReserve>>();

// ─── Lazy SDK loader ─────────────────────────────────────────────────────

async function loadSolendSdk(): Promise<typeof import("@solendprotocol/solend-sdk")> {
  return await import("@solendprotocol/solend-sdk");
}

/**
 * Read the lending market + reserve state on-chain (once per process)
 * and assemble the InputPoolType + InputReserveType structs the SDK
 * needs. Cache key = `${poolAddress}:${reserveAddress}` so a future
 * caller asking for a different reserve still gets fresh state.
 *
 * The cache is "best-effort fresh": surfpool's fork state for these
 * accounts doesn't change unless the fork is restarted, so a stale
 * cache only matters if the daemon survives a fork reset. The per-
 * action try/catch in action-executor will surface the resulting
 * stale-state failure as `phase=execute_error` — caller can flush by
 * restarting the daemon.
 */
async function ensurePoolReserve(
  surfpool: Connection,
  poolAddress: string,
  reserveAddress: string,
): Promise<CachedPoolReserve> {
  const key = `${poolAddress}:${reserveAddress}`;
  const cached = poolReserveCache.get(key);
  if (cached) return cached;
  const inflight = poolReserveLoadPromises.get(key);
  if (inflight) return await inflight;

  const promise = (async () => {
    const sdk = await loadSolendSdk();
    const poolPk = new PublicKey(poolAddress);
    const reservePk = new PublicKey(reserveAddress);

    // Parse lending market — gives us `owner`.
    const marketAi = await surfpool.getAccountInfo(poolPk);
    if (!marketAi) {
      throw new Error(
        `Solend lending market ${poolAddress} not found on surfpool — fork may not have cloned the account yet`,
      );
    }
    const market = sdk.parseLendingMarket(poolPk, marketAi);

    // Parse reserve — gives us liquidity + collateral pubkeys, oracles, fee receiver.
    const reserveAi = await surfpool.getAccountInfo(reservePk);
    if (!reserveAi) {
      throw new Error(
        `Solend reserve ${reserveAddress} not found on surfpool — fork may not have cloned the account yet`,
      );
    }
    const reserveParsed = sdk.parseReserve(reservePk, reserveAi);

    // Pool authority is a PDA derived from the lending market pubkey.
    const [authorityPk] = PublicKey.findProgramAddressSync(
      [poolPk.toBytes()],
      new PublicKey(SOLEND_PROGRAM_ID),
    );

    const reserveInput = {
      address: reservePk.toBase58(),
      liquidityAddress: reserveParsed.info.liquidity.supplyPubkey.toBase58(),
      cTokenMint: reserveParsed.info.collateral.mintPubkey.toBase58(),
      cTokenLiquidityAddress:
        reserveParsed.info.collateral.supplyPubkey.toBase58(),
      pythOracle: reserveParsed.info.liquidity.pythOracle.toBase58(),
      switchboardOracle:
        reserveParsed.info.liquidity.switchboardOracle.toBase58(),
      mintAddress: reserveParsed.info.liquidity.mintPubkey.toBase58(),
      liquidityFeeReceiverAddress:
        reserveParsed.info.config.feeReceiver.toBase58(),
    };

    const pool = {
      address: poolPk.toBase58(),
      owner: market.info.owner.toBase58(),
      name: null as string | null,
      authorityAddress: authorityPk.toBase58(),
      reserves: [
        {
          address: reserveInput.address,
          pythOracle: reserveInput.pythOracle,
          switchboardOracle: reserveInput.switchboardOracle,
          mintAddress: reserveInput.mintAddress,
          liquidityFeeReceiverAddress: reserveInput.liquidityFeeReceiverAddress,
          extraOracle: reserveParsed.info.config.extraOracle?.toBase58(),
        },
      ],
    };

    const entry: CachedPoolReserve = { pool, reserve: reserveInput };
    poolReserveCache.set(key, entry);
    return entry;
  })();
  poolReserveLoadPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    poolReserveLoadPromises.delete(key);
  }
}

/**
 * Eagerly populate the pool/reserve cache for the Solend main-pool USDC
 * reserve so the first agent's first lend action isn't blocked by the
 * 5-15s `parseLendingMarket` + `parseReserve` round-trip + parse on the
 * lazy path.
 *
 * Mirrors `prewarmZetaExchange` / `prewarmMarginfiClient`:
 *   - Idempotent: if the cache for the default `(pool, reserve)` key is
 *     already populated, returns true immediately. The existing
 *     `poolReserveCache` Map is the dedup signal — no parallel
 *     `solendPrewarmed` flag.
 *   - Fork-reset-safe: a clean cache (fresh module load) makes prewarm
 *     re-fetch. The lazy bootstrap in `depositSolend` / `withdrawSolend`
 *     is the safety net — on prewarm failure the lazy path retries on
 *     the first lend action.
 *   - Never throws: returns false on failure so daemon startup proceeds.
 */
export async function prewarmSolendMarket(
  surfpool: Connection,
  timeoutMs = 60_000,
): Promise<boolean> {
  const cacheKey = `${SOLEND_MAIN_POOL}:${SOLEND_MAIN_USDC_RESERVE}`;
  if (poolReserveCache.has(cacheKey)) {
    console.log("[solend-prewarm] pool/reserve already cached — no-op");
    return true;
  }
  const start = Date.now();
  try {
    await Promise.race([
      ensurePoolReserve(surfpool, SOLEND_MAIN_POOL, SOLEND_MAIN_USDC_RESERVE),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `prewarmSolendMarket timed out after ${timeoutMs}ms`,
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);
    const elapsedMs = Date.now() - start;
    console.log(
      `[solend-prewarm] pool/reserve hydrate complete in ${elapsedMs}ms (lazy path now no-op)`,
    );
    return true;
  } catch (e) {
    const elapsedMs = Date.now() - start;
    console.warn(
      `[solend-prewarm] failed after ${elapsedMs}ms: ${(e as Error).message} — lazy load will retry on first lend action`,
    );
    return false;
  }
}

/**
 * Sign + submit a Solend SDK VersionedTransaction. Solend's
 * `getTransactions` returns pre/lending/post versioned txns with the
 * blockhash already attached; we only need to sign with the agent
 * keypair and submit. Surfpool tx hygiene: skipPreflight + extended
 * blockhash window (the txn arrives pre-stamped with a window we
 * widened from the inputs above).
 */
async function signAndSendVersioned(
  surfpool: Connection,
  vault: Keypair,
  tx: VersionedTransaction,
): Promise<string> {
  tx.sign([vault]);
  const sig = await surfpool.sendTransaction(tx, {
    skipPreflight: true,
    maxRetries: 5,
  });
  await surfpool.confirmTransaction(sig, "confirmed");
  return sig;
}

// ─── Public API ──────────────────────────────────────────────────────────

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

/**
 * Deposit USDC into the Solend main pool's USDC reserve on surfpool.
 *
 * Flow:
 *   1. Ensure USDC funding via `ensureSurfpoolUsdc`.
 *   2. Lazy-load SDK + read on-chain pool/reserve state (cached).
 *   3. `SolendActionCore.buildDepositTxns(...)` — SDK bundles
 *      obligation init (first deposit), RefreshReserve, RefreshObligation,
 *      and DepositReserveLiquidityAndObligationCollateral.
 *   4. Submit pre/lending/post txns in order with surfpool tx hygiene.
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
  const usdcResult = await ensureSurfpoolUsdc(
    surfpool,
    vault.publicKey,
    Math.max(amountUsdcUi, 1000),
  );

  const { pool, reserve } = await ensurePoolReserve(
    surfpool,
    SOLEND_MAIN_POOL,
    reserveAddress,
  );

  const sdk = await loadSolendSdk();
  const amountBaseUnits = Math.round(amountUsdcUi * 1_000_000);
  const action = await sdk.SolendActionCore.buildDepositTxns(
    pool,
    reserve,
    surfpool,
    amountBaseUnits.toString(),
    { publicKey: vault.publicKey },
    {
      environment: "production",
    },
  );

  // Surfpool blockhash + extended validity window. Same hygiene as
  // marinade-execute / kamino-execute.
  const { blockhash, lastValidBlockHeight } =
    await surfpool.getLatestBlockhash("processed");
  const extendedValidity = {
    blockhash,
    lastValidBlockHeight: lastValidBlockHeight + 300,
  };

  const txns = await action.getTransactions(extendedValidity);

  // Count ix's across the bundle for the result row.
  const ixCount =
    action.setupIxs.length +
    action.lendingIxs.length +
    action.cleanupIxs.length +
    action.preTxnIxs.length +
    action.postTxnIxs.length;

  // Submit in order: preLendingTxn → lendingTxn → postLendingTxn. Pull
  // price txns (oracle updates from Pyth pull/Switchboard) come first
  // when present.
  if (txns.pullPriceTxns?.length) {
    for (const ptx of txns.pullPriceTxns) {
      await signAndSendVersioned(surfpool, vault, ptx);
    }
  }
  if (txns.preLendingTxn) {
    await signAndSendVersioned(surfpool, vault, txns.preLendingTxn);
  }
  if (!txns.lendingTxn) {
    throw new Error(
      "depositSolend: SDK did not produce a lending tx — nothing to submit",
    );
  }
  const lendingSig = await signAndSendVersioned(
    surfpool,
    vault,
    txns.lendingTxn,
  );
  if (txns.postLendingTxn) {
    await signAndSendVersioned(surfpool, vault, txns.postLendingTxn);
  }

  console.log(
    `[solend] deposit ${amountUsdcUi} USDC → reserve ${reserveAddress.slice(0, 8)}…  ixs=${ixCount}  usdcFunding=${usdcResult.method}`,
  );

  return {
    protocol: "solend",
    action: "lend_deposit",
    txSig: lendingSig,
    reserveAddress,
    reserveLiquidityMint: MAINNET_USDC_MINT,
    amountBaseUnits,
    ixCount,
  };
}

/**
 * Withdraw USDC from the Solend main pool's USDC reserve on surfpool.
 *
 * HARD-FAILS when the agent has no obligation (i.e. has never deposited).
 * The SolendActionCore.buildWithdrawTxns path internally throws when it
 * can't find the obligation account; we let that bubble up rather than
 * silently swallowing it.
 */
export async function withdrawSolend(
  args: WithdrawSolendArgs,
): Promise<SolendWithdrawResult> {
  const { surfpool, vault, amountUsdcUi } = args;
  if (amountUsdcUi <= 0) {
    throw new Error(
      `withdrawSolend: amountUsdcUi must be > 0 (got ${amountUsdcUi})`,
    );
  }
  const reserveAddress = args.reserveAddress ?? SOLEND_MAIN_USDC_RESERVE;

  const { pool, reserve } = await ensurePoolReserve(
    surfpool,
    SOLEND_MAIN_POOL,
    reserveAddress,
  );

  const sdk = await loadSolendSdk();
  const amountBaseUnits = Math.round(amountUsdcUi * 1_000_000);
  // Pre-flight obligation check: the SDK derives the obligation PDA
  // from (publicKey, lendingMarket, programId) seeds. If the account
  // doesn't exist on surfpool, the agent has no Solend position and
  // we should hard-fail here rather than letting the SDK build a
  // refresh-obligation ix that targets nothing.
  const obligationSeed = SOLEND_MAIN_POOL.slice(0, 32);
  const obligationPk = await PublicKey.createWithSeed(
    vault.publicKey,
    obligationSeed,
    new PublicKey(SOLEND_PROGRAM_ID),
  );
  const obligationAi = await surfpool.getAccountInfo(obligationPk);
  if (!obligationAi) {
    throw new Error(
      `withdrawSolend: agent ${vault.publicKey.toBase58()} has no Solend obligation under pool ${SOLEND_MAIN_POOL} — nothing to withdraw`,
    );
  }

  const action = await sdk.SolendActionCore.buildWithdrawTxns(
    pool,
    reserve,
    surfpool,
    amountBaseUnits.toString(),
    { publicKey: vault.publicKey },
    {
      environment: "production",
    },
  );

  const { blockhash, lastValidBlockHeight } =
    await surfpool.getLatestBlockhash("processed");
  const extendedValidity = {
    blockhash,
    lastValidBlockHeight: lastValidBlockHeight + 300,
  };
  const txns = await action.getTransactions(extendedValidity);

  const ixCount =
    action.setupIxs.length +
    action.lendingIxs.length +
    action.cleanupIxs.length +
    action.preTxnIxs.length +
    action.postTxnIxs.length;

  if (txns.pullPriceTxns?.length) {
    for (const ptx of txns.pullPriceTxns) {
      await signAndSendVersioned(surfpool, vault, ptx);
    }
  }
  if (txns.preLendingTxn) {
    await signAndSendVersioned(surfpool, vault, txns.preLendingTxn);
  }
  if (!txns.lendingTxn) {
    throw new Error(
      "withdrawSolend: SDK did not produce a lending tx — nothing to submit",
    );
  }
  const lendingSig = await signAndSendVersioned(
    surfpool,
    vault,
    txns.lendingTxn,
  );
  if (txns.postLendingTxn) {
    await signAndSendVersioned(surfpool, vault, txns.postLendingTxn);
  }

  console.log(
    `[solend] withdraw ${amountUsdcUi} USDC ← reserve ${reserveAddress.slice(0, 8)}…  ixs=${ixCount}`,
  );

  return {
    protocol: "solend",
    action: "lend_withdraw",
    txSig: lendingSig,
    reserveAddress,
    reserveLiquidityMint: MAINNET_USDC_MINT,
    amountBaseUnits,
    ixCount,
  };
}

