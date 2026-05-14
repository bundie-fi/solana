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

    for (const info of sigInfos) {
      if (seen.has(info.signature)) continue;
      const tx = await connection.getTransaction(info.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || !tx.meta?.logMessages) continue;

      const blockTimeMs = (tx.blockTime ?? 0) * 1000;
      const feePayer =
        tx.transaction.message.staticAccountKeys?.[0]?.toBase58() ?? "unknown";

      // The market PDA is the second account in our event-market ix layouts.
      const accountKeys = tx.transaction.message.staticAccountKeys;
      const marketAddress = accountKeys?.[1]?.toBase58() ?? "unknown";

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

/** Force a refresh — useful for tests / cold starts. */
export async function indexerRefresh(): Promise<void> {
  lastRefresh = 0;
  await refresh();
}
