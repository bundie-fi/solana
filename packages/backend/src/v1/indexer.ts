/**
 * Minimal in-memory indexer for event-market trades.
 *
 * The backend's confidence scoring + EventPriceResponse fields
 * (trade_count_24h, unique_traders_24h) need a count of recent trades
 * per market. A full indexer (Postgres + log streaming) is out of scope
 * for v1 — this lightweight version maintains an in-memory ring buffer
 * keyed by market PDA, populated by a polling task that reads recent
 * transactions for the program.
 *
 * Production-ready version reads Yellowstone gRPC or RpcFast WebSocket
 * subscriptions for buy_event_shares / sell_event_shares program logs,
 * persists to Postgres, and exposes a query API. v1 ships this stub so
 * the EventPriceResponse fields stop being permanent zeros.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { emitPriceUpdate } from "./price-emitter.js";
import { loadRegistry } from "./registry.js";
import { findMarketForEvent } from "./onchain.js";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.PREDICTION_PROGRAM_ID ??
    "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);
const REFRESH_INTERVAL_MS = 30_000;
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface TradeRecord {
  signature: string;
  blockTimeMs: number;
  trader: string;
  marketAddress: string;
  kind: "buy" | "sell";
  outcome: "yes" | "no";
}

interface MarketStats {
  tradeCount24h: number;
  uniqueTraders24h: number;
  lastChange24h: number;
  spotVsTwapPct: number;
}

const tradesByMarket = new Map<string, TradeRecord[]>();
let lastRefresh = 0;

/**
 * Parse a transaction log line emitted by buy_event_shares / sell_event_shares.
 * Returns null if the line isn't one of ours. The log format is exactly
 * what the on-chain `msg!()` calls produce.
 */
function parseLogLine(
  log: string,
  signature: string,
  blockTimeMs: number,
  feePayer: string,
  marketAddress: string,
): TradeRecord | null {
  // "buy_event_shares: outcome_yes=true amount=... cost=... fee=..."
  const buyMatch = /^Program log: buy_event_shares: outcome_yes=(true|false) amount=/.exec(
    log,
  );
  if (buyMatch) {
    return {
      signature,
      blockTimeMs,
      trader: feePayer,
      marketAddress,
      kind: "buy",
      outcome: buyMatch[1] === "true" ? "yes" : "no",
    };
  }
  const sellMatch = /^Program log: sell_event_shares: outcome_yes=(true|false) shares=/.exec(
    log,
  );
  if (sellMatch) {
    return {
      signature,
      blockTimeMs,
      trader: feePayer,
      marketAddress,
      kind: "sell",
      outcome: sellMatch[1] === "true" ? "yes" : "no",
    };
  }
  return null;
}

/**
 * Pull recent program signatures and parse the trade logs out of each.
 * Idempotent; only records new signatures.
 */
async function refresh(): Promise<void> {
  const now = Date.now();
  if (now - lastRefresh < REFRESH_INTERVAL_MS) return;
  lastRefresh = now;

  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const sigInfos = await connection.getSignaturesForAddress(PROGRAM_ID, {
      limit: 200,
    });
    const seen = new Set<string>();
    for (const trades of tradesByMarket.values()) {
      for (const t of trades) seen.add(t.signature);
    }

    // Build the set of market PDAs we track. The market account is NOT at a
    // fixed index in the tx (account order varies per tx), so we identify it
    // by matching against known market PDAs rather than assuming accountKeys[1].
    const knownMarkets = new Map<string, string>(); // market PDA -> event_id
    for (const e of loadRegistry().events) {
      // eslint-disable-next-line no-await-in-loop
      const pda = await findMarketForEvent(e.event_id).catch(() => null);
      if (pda) knownMarkets.set(pda.toBase58(), e.event_id);
    }

    for (const info of sigInfos) {
      if (seen.has(info.signature)) continue;
      const tx = await connection.getTransaction(info.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || !tx.meta?.logMessages) continue;

      const blockTimeMs = (tx.blockTime ?? 0) * 1000;
      const accountKeys = tx.transaction.message.staticAccountKeys ?? [];
      const feePayer = accountKeys[0]?.toBase58() ?? "unknown";

      // Identify the market PDA among this tx's accounts (order is not fixed).
      let marketAddress: string | null = null;
      let eventId: string | null = null;
      for (const k of accountKeys) {
        const b = k.toBase58();
        const ev = knownMarkets.get(b);
        if (ev) {
          marketAddress = b;
          eventId = ev;
          break;
        }
      }
      if (!marketAddress) continue; // not a tracked market

      for (const log of tx.meta.logMessages) {
        const trade = parseLogLine(
          log,
          info.signature,
          blockTimeMs,
          feePayer,
          marketAddress,
        );
        if (!trade) continue;
        const arr = tradesByMarket.get(trade.marketAddress) ?? [];
        arr.push(trade);
        tradesByMarket.set(trade.marketAddress, arr);
        if (eventId) emitPriceUpdate(eventId);
      }
    }

    // Trim trades older than 24h.
    const cutoff = now - WINDOW_MS;
    for (const [market, arr] of tradesByMarket) {
      const kept = arr.filter((t) => t.blockTimeMs >= cutoff);
      tradesByMarket.set(market, kept);
    }
  } catch (err) {
    console.warn(`[indexer] refresh failed: ${(err as Error).message}`);
  }
}

export async function getMarketStats(marketAddress: string): Promise<MarketStats> {
  // Best-effort refresh on each call; rate-limited internally.
  refresh().catch(() => undefined);
  const trades = tradesByMarket.get(marketAddress) ?? [];
  const tradeCount24h = trades.length;
  const uniqueTraders24h = new Set(trades.map((t) => t.trader)).size;
  return {
    tradeCount24h,
    uniqueTraders24h,
    // last_change_24h and spot_vs_twap_pct require historical price
    // snapshots which this v1 indexer doesn't store. They stay 0 until
    // the price-history table is wired (next pass).
    lastChange24h: 0,
    spotVsTwapPct: 0,
  };
}

/**
 * Historical variant of {@link getMarketStats}: aggregates trades over the
 * 24h window ending at `atMs` rather than the live `[now - 24h, now]`. Used
 * by /v1/event-price?at=... for agent backtesting.
 *
 * Returns the same MarketStats shape, plus:
 *  - tickBlockTimeMs: the block-time of the closest trade at-or-before
 *    `atMs`, or null if no trade is in scope. Callers use this as the
 *    `as_of` for the historical response (rounded to the nearest sample
 *    in the buffer).
 *  - windowTruncated: true if the buffer doesn't extend back to `atMs - 24h`
 *    (i.e. the available subset is shorter than 24h).
 *  - earliestBufferedMs: the oldest trade block-time currently in the
 *    buffer for this market (used to format 400-error bounds).
 */
export interface HistoricalMarketStats extends MarketStats {
  tickBlockTimeMs: number | null;
  windowTruncated: boolean;
  earliestBufferedMs: number | null;
}

export async function getHistoricalMarketStats(
  marketAddress: string,
  atMs: number,
): Promise<HistoricalMarketStats> {
  // Best-effort refresh on each call; rate-limited internally.
  refresh().catch(() => undefined);
  const trades = tradesByMarket.get(marketAddress) ?? [];
  const earliestBufferedMs =
    trades.length > 0
      ? trades.reduce((m, t) => Math.min(m, t.blockTimeMs), Infinity)
      : null;
  const windowStartMs = atMs - WINDOW_MS;
  const inWindow = trades.filter(
    (t) => t.blockTimeMs >= windowStartMs && t.blockTimeMs <= atMs,
  );
  const tradeCount24h = inWindow.length;
  const uniqueTraders24h = new Set(inWindow.map((t) => t.trader)).size;
  // Closest tick at-or-before `atMs`. We use the trade event's block-time
  // as the sample timestamp; ties resolve to the latest.
  const atOrBefore = trades.filter((t) => t.blockTimeMs <= atMs);
  const tickBlockTimeMs =
    atOrBefore.length > 0
      ? atOrBefore.reduce((m, t) => Math.max(m, t.blockTimeMs), -Infinity)
      : null;
  const windowTruncated =
    earliestBufferedMs !== null && earliestBufferedMs > windowStartMs;
  return {
    tradeCount24h,
    uniqueTraders24h,
    // Same v1 limitation as live reads: last_change_24h and spot_vs_twap_pct
    // require per-trade price snapshots which the trade-event buffer does
    // not carry. They stay 0 until the price-history table ships.
    lastChange24h: 0,
    spotVsTwapPct: 0,
    tickBlockTimeMs,
    windowTruncated,
    earliestBufferedMs: earliestBufferedMs === Infinity ? null : earliestBufferedMs,
  };
}

/** Force a refresh — useful for tests / cold starts. */
export async function indexerRefresh(): Promise<void> {
  lastRefresh = 0;
  await refresh();
}

