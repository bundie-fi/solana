/**
 * zeta-execute.ts — Zeta Markets perp executor against the surfpool mainnet
 * fork. Mirrors marinade-execute.ts in style + tx hygiene.
 *
 * Design notes
 * ------------
 * The Zeta SDK is built around a *singleton* `Exchange` plus per-user
 * `CrossClient` objects. Both are heavy-weight: `Exchange.load()` subscribes
 * to a dozen on-chain accounts (state, pricing, oracle, perp markets, …) and
 * `CrossClient.load()` fetches / subscribes the user's CrossMarginAccount +
 * CrossMarginAccountManager PDAs. We therefore cache:
 *
 *   - the Exchange singleton (it's already a module-level singleton in the
 *     SDK; we just track an `exchangeLoaded` flag here so we only call .load
 *     once per process),
 *   - one CrossClient per agent pubkey (the Map is keyed on base58).
 *
 * Bootstrap flow on the FIRST perp_open for an agent:
 *   1. Lazy-load the Exchange singleton (if !exchangeLoaded) targeting
 *      Network.MAINNET — surfpool is a mainnet fork and Zeta's mainnet
 *      program/state PDAs are inherited as-is.
 *   2. CrossClient.load() — this binds to the agent's CrossMarginAccount
 *      PDA. If the PDA doesn't exist yet, the SDK still returns a client
 *      with `account === null`.
 *   3. If `client.account === null`, call `client.deposit(amount)`. The
 *      SDK's deposit() handler atomically initializes
 *      CrossMarginAccountManager + CrossMarginAccount + USDC vault on
 *      first call (see CrossClient.deposit → initializeAccounts path),
 *      then deposits collateral.
 *   4. Place a FILLORKILL perp order at a wide slippage cap (5% off mark)
 *      so it crosses against whatever liquidity the surfpool fork has
 *      inherited from mainnet at fork-time.
 *
 * On perp_close we don't withdraw collateral or settle PNL — we just
 * flatten the position by placing an opposing FILLORKILL of equal size at
 * a wide slippage cap. The collateral stays in the cross-margin account
 * and is reused on the next perp_open.
 *
 * RUNTIME CAVEATS (see action-executor.ts gap notes):
 *   - The agent's USDC ATA on surfpool must be funded *before* this is
 *     called. ensureSurfpoolFunded only airdrops SOL, not USDC. Until a
 *     surfnet_setTokenAccount call is wired in, the deposit() call here
 *     will fail with InsufficientFunds on the agent's first perp_open.
 *   - Zeta's mainnet program state must be present on the surfpool fork.
 *     Surfpool clones mainnet account state on a per-account access basis,
 *     so the first call to Exchange.load() will trigger a flurry of clones
 *     and may be slow (15-30s). If the fork is already warmed up from a
 *     previous tick this is a no-op.
 *   - Zeta's perp markets use an on-chain Serum orderbook. Liquidity at
 *     fork-time is whatever was on mainnet at that exact slot — for
 *     SOL-PERP that's typically deep, but stale (frozen at fork). Mark
 *     prices won't move with mainnet over time.
 */

import { Connection, Keypair } from "@solana/web3.js";
import {
  Wallet,
  CrossClient,
  Exchange,
  Network,
  utils as zetaUtils,
  types as zetaTypes,
  constants as zetaConstants,
} from "@zetamarkets/sdk";

import { ensureSurfpoolUsdc } from "./surfpool-seed.js";

// ─── Module-level caches ─────────────────────────────────────────────────

/**
 * Whether Exchange.load() has succeeded in this process. Exchange itself is
 * a singleton inside the SDK so we just need a one-shot guard.
 */
let exchangeLoaded = false;
/** In-flight Exchange.load() promise, so concurrent ticks share the wait. */
let exchangeLoadPromise: Promise<void> | null = null;

/**
 * Per-agent CrossClient cache. Key is the agent pubkey base58. CrossClient
 * holds a websocket subscription to its own margin-account, so we keep one
 * around per-agent and reuse it across ticks.
 */
const clientCache = new Map<string, CrossClient>();
/** In-flight CrossClient.load() promises so concurrent ticks share the wait. */
const clientLoadPromises = new Map<string, Promise<CrossClient>>();

// ─── Asset mapping ────────────────────────────────────────────────────────

/**
 * Maps the brain-side market symbol to a Zeta `Asset` enum. The brain only
 * emits "SOL-PERP" / "BTC-PERP" / "ETH-PERP" today; extend here if more are
 * added. Throws on unknown symbols so the daemon's per-action try/catch
 * surfaces a clean error.
 */
function marketToAsset(market: string): zetaConstants.Asset {
  switch (market) {
    case "SOL-PERP":
      return zetaConstants.Asset.SOL;
    case "BTC-PERP":
      return zetaConstants.Asset.BTC;
    case "ETH-PERP":
      return zetaConstants.Asset.ETH;
    default:
      throw new Error(
        `zeta-execute: unsupported market "${market}" (expected SOL-PERP / BTC-PERP / ETH-PERP)`,
      );
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────

async function ensureExchangeLoaded(connection: Connection): Promise<void> {
  if (exchangeLoaded) return;
  if (exchangeLoadPromise) {
    await exchangeLoadPromise;
    return;
  }
  exchangeLoadPromise = (async () => {
    // Network.MAINNET — surfpool is a mainnet fork so we want the mainnet
    // ZETA_PID + USDC mint. defaultLoadExchangeConfig with loadAssets
    // restricted to [SOL, BTC, ETH] keeps the subscription cost down.
    const loadConfig = zetaTypes.defaultLoadExchangeConfig(
      Network.MAINNET,
      connection,
      zetaUtils.defaultCommitment(),
      0,
      true, // loadFromStore — fetches account snapshots in bulk
      undefined,
      undefined,
      undefined,
      [
        zetaConstants.Asset.SOL,
        zetaConstants.Asset.BTC,
        zetaConstants.Asset.ETH,
      ],
    );
    await Exchange.load(loadConfig);
    exchangeLoaded = true;
  })();
  try {
    await exchangeLoadPromise;
  } finally {
    exchangeLoadPromise = null;
  }
}

/**
 * Eagerly load the Zeta Exchange singleton so the first agent's first
 * perp_open isn't blocked by the 30+ mainnet-account clone storm that
 * `Exchange.load()` triggers. Safe to call from daemon startup before the
 * supervisor loop kicks off.
 *
 * Interaction with `ensureExchangeLoaded`:
 *   - Both gates on the same module-level `exchangeLoaded` flag, so a
 *     successful prewarm makes every subsequent `ensureExchangeLoaded`
 *     call a synchronous no-op.
 *   - When prewarm FAILS (returns false), `exchangeLoaded` stays `false`
 *     and the lazy `ensureExchangeLoaded` path inside `openZetaPerp` /
 *     `closeZetaPerp` will retry on the first perp action. This is the
 *     fork-reset-safe self-heal.
 *   - `exchangeLoadPromise` is cleared in the `finally` block of
 *     `ensureExchangeLoaded`, so a prewarm that wins the race and a tick
 *     that races in alongside it both observe the same in-flight promise.
 *
 * Returns true on success, false on failure (including timeout). Never
 * throws — daemon startup must continue regardless.
 */
export async function prewarmZetaExchange(
  connection: Connection,
  timeoutMs = 60_000,
): Promise<boolean> {
  if (exchangeLoaded) return true;
  const start = Date.now();
  try {
    await Promise.race([
      ensureExchangeLoaded(connection),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`prewarmZetaExchange timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
    const elapsedMs = Date.now() - start;
    console.log(
      `[zeta-prewarm] Exchange.load() complete in ${elapsedMs}ms (lazy path now no-op)`,
    );
    return true;
  } catch (e) {
    const elapsedMs = Date.now() - start;
    console.warn(
      `[zeta-prewarm] failed after ${elapsedMs}ms: ${(e as Error).message} — lazy load will retry on first perp action`,
    );
    return false;
  }
}

async function ensureCrossClient(
  connection: Connection,
  kp: Keypair,
): Promise<CrossClient> {
  const key = kp.publicKey.toBase58();
  const cached = clientCache.get(key);
  if (cached) return cached;
  const inflight = clientLoadPromises.get(key);
  if (inflight) return inflight;
  const promise = (async () => {
    const wallet = new Wallet(kp);
    const client = await CrossClient.load(connection, wallet, undefined);
    clientCache.set(key, client);
    return client;
  })();
  clientLoadPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    clientLoadPromises.delete(key);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface ZetaPerpOpenResult {
  protocol: "zeta";
  action: "perp_open";
  txSig: string;
  /** Final market symbol back from the brain (e.g. "SOL-PERP"). */
  market: string;
  /** "long" → BID, "short" → ASK. */
  side: "long" | "short";
  /** Notional USDC notional requested by the brain. */
  notionalUsd: number;
  /** Mark price in USD at order time (decimal). */
  markPrice: number;
  /** Worst-acceptable price the FILLORKILL was placed at (decimal USD). */
  limitPrice: number;
  /** Contracts placed (decimal — same unit the brain reasons in). */
  size: number;
  /** Pubkey of the agent's CrossMarginAccount (base58). */
  crossMarginAccount: string;
}

export interface ZetaPerpCloseResult {
  protocol: "zeta";
  action: "perp_close";
  txSig: string | null;
  market: string;
  /** Position size before close (decimal, signed: + long, - short). */
  positionBefore: number;
  /** Mark price at close time. */
  markPrice: number;
  /** True if there was no position to close (no tx submitted). */
  flat: boolean;
  crossMarginAccount: string;
}

/**
 * Open a perp on Zeta. First call for an agent:
 *   1. boots Exchange (mainnet config),
 *   2. loads CrossClient,
 *   3. deposits USDC collateral if account is fresh,
 *   4. places a FILLORKILL at mark ± 5%.
 * Subsequent calls reuse the cached Exchange + client.
 */
export async function openZetaPerp(
  connection: Connection,
  kp: Keypair,
  market: string,
  side: "long" | "short",
  notionalUsd: number,
): Promise<ZetaPerpOpenResult> {
  if (notionalUsd <= 0) {
    throw new Error(`openZetaPerp: notionalUsd must be > 0 (got ${notionalUsd})`);
  }
  const asset = marketToAsset(market);

  await ensureExchangeLoaded(connection);
  const client = await ensureCrossClient(connection, kp);

  // Mark price — Exchange has a websocket-fed cache. Decimal USD.
  const markPrice = Exchange.getMarkPrice(asset);
  if (!markPrice || markPrice <= 0) {
    throw new Error(
      `openZetaPerp: Exchange.getMarkPrice(${asset}) returned ${markPrice} — Zeta state likely not present on the fork yet`,
    );
  }

  // Contract sizing. Zeta perps are 1:1 with the underlying — 1 SOL-PERP =
  // 1 SOL of exposure, 1 BTC-PERP = 1 BTC of exposure. So contracts =
  // notionalUsd / markPrice. The size argument to placeOrder is in the same
  // decimal unit (convertDecimalToNativeLotSize handles 3dp scaling).
  const size = notionalUsd / markPrice;
  if (size <= 0) {
    throw new Error(
      `openZetaPerp: computed size=${size} from notional=${notionalUsd} mark=${markPrice}`,
    );
  }

  // Ensure CrossMarginAccount exists. We use ~120% of notional as collateral
  // floor on first deposit so a single 5x position doesn't immediately blow
  // through the maintenance margin — rough heuristic until the brain learns
  // about leverage explicitly. Subsequent perp_open calls reuse existing
  // collateral.
  await client.updateState(false, true);
  if (client.account === null) {
    const collateralUsd = Math.max(notionalUsd * 1.2, 10);
    // Belt-and-braces USDC seed: even with the daemon's per-tick seeder,
    // the agent's first perp_open ever might race against a fork that
    // hasn't been seeded yet. ensureSurfpoolUsdc is idempotent and cheap
    // when the floor is already met, so this is safe to always call.
    await ensureSurfpoolUsdc(
      connection,
      kp.publicKey,
      Math.max(collateralUsd * 1.5, 1000),
    );
    const nativeAmount = zetaUtils.convertDecimalToNativeInteger(collateralUsd);
    await client.deposit(nativeAmount);
    await client.updateState(false, true);
  }

  // FILLORKILL with a 5% slippage cap so the order either fills fully at a
  // sane price or aborts the tx (no partial fills, no stuck open orders).
  // Side mapping: long = BID (buy), short = ASK (sell).
  const slippageBps = 500;
  const limitPrice =
    side === "long"
      ? markPrice * (1 + slippageBps / 10_000)
      : markPrice * (1 - slippageBps / 10_000);
  const zSide = side === "long" ? zetaTypes.Side.BID : zetaTypes.Side.ASK;

  const txSig = await client.placeOrder(
    asset,
    zetaUtils.convertDecimalToNativeInteger(limitPrice),
    zetaUtils.convertDecimalToNativeLotSize(size),
    zSide,
    {
      orderType: zetaTypes.OrderType.FILLORKILL,
      tifOptions: {},
      tag: "BNDI",
    },
  );

  return {
    protocol: "zeta",
    action: "perp_open",
    txSig,
    market,
    side,
    notionalUsd,
    markPrice,
    limitPrice,
    size,
    crossMarginAccount: client.accountAddress.toBase58(),
  };
}

/**
 * Flatten the position on `market` by placing an opposing FILLORKILL of the
 * same size at mark ± 5%. We do NOT settle PNL or withdraw collateral on
 * close — that stays in the cross-margin account for the next open.
 */
export async function closeZetaPerp(
  connection: Connection,
  kp: Keypair,
  market: string,
): Promise<ZetaPerpCloseResult> {
  const asset = marketToAsset(market);

  await ensureExchangeLoaded(connection);
  const client = await ensureCrossClient(connection, kp);

  const markPrice = Exchange.getMarkPrice(asset);
  if (!markPrice || markPrice <= 0) {
    throw new Error(
      `closeZetaPerp: Exchange.getMarkPrice(${asset}) returned ${markPrice}`,
    );
  }

  // Refresh on-chain position state before reading it.
  await client.updateState(false, true);
  // getPositionSize(asset, decimal=true) returns the signed decimal size:
  //   positive  → long
  //   negative  → short
  //   zero      → flat (no-op)
  const positionDecimal = client.getPositionSize(asset, true);
  if (!positionDecimal || Math.abs(positionDecimal) < 1e-9) {
    return {
      protocol: "zeta",
      action: "perp_close",
      txSig: null,
      market,
      positionBefore: 0,
      markPrice,
      flat: true,
      crossMarginAccount: client.accountAddress.toBase58(),
    };
  }

  // To close: opposite side, same |size|, FILLORKILL at slipped price.
  // Long → sell (ASK) at mark - 5%. Short → buy (BID) at mark + 5%.
  const isLong = positionDecimal > 0;
  const closeSide = isLong ? zetaTypes.Side.ASK : zetaTypes.Side.BID;
  const slippageBps = 500;
  const limitPrice = isLong
    ? markPrice * (1 - slippageBps / 10_000)
    : markPrice * (1 + slippageBps / 10_000);
  const sizeDecimal = Math.abs(positionDecimal);

  const txSig = await client.placeOrder(
    asset,
    zetaUtils.convertDecimalToNativeInteger(limitPrice),
    zetaUtils.convertDecimalToNativeLotSize(sizeDecimal),
    closeSide,
    {
      orderType: zetaTypes.OrderType.FILLORKILL,
      tifOptions: {},
      reduceOnly: true,
      tag: "BNDI",
    },
  );

  return {
    protocol: "zeta",
    action: "perp_close",
    txSig,
    market,
    positionBefore: positionDecimal,
    markPrice,
    flat: false,
    crossMarginAccount: client.accountAddress.toBase58(),
  };
}
