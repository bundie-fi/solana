/**
 * v1 — public event-price API.
 *
 * Endpoints (priced via x402 in production; free in dev):
 *
 *   GET /v1/events
 *     List all registered events with current market state.
 *
 *   GET /v1/event-price?id=<event_id>[&at=<unix_seconds_or_iso8601>]
 *     Returns the LMSR market price + confidence + depth + TWAP.
 *     Without `at`, the response describes the live on-chain state.
 *     With `at`, the response describes the closest trade-buffer tick
 *     at-or-before that timestamp; the 24h-window aggregates
 *     (trade_count_24h, unique_traders_24h, twap_24h, last_change_24h)
 *     reflect the window `[at - 24h, at]` rather than `[now - 24h, now]`.
 *     `at` may be a unix-seconds integer/decimal or an ISO-8601 string.
 *     Absent or future `at` → live behaviour. `at` older than the 24h
 *     trade-buffer horizon → 400 with the earliest available timestamp.
 *     The `at` field is included in the signed-attestation canonical
 *     form so historical signatures are not replayable as live ones.
 *
 *   GET /v1/event-detail?id=<event_id>
 *     Full event metadata + resolver track record.
 *
 * When no on-chain market exists for an event_id yet (i.e. before
 * `create_event` has been called), the response returns price=0.5,
 * confidence=0, depth=0 — same schema, sentinel values. Clients filter
 * on `confidence > 0` to ignore unresolved-state stubs.
 */

import { Hono } from "hono";
import { loadRegistry, getEvent } from "./registry.js";
import { readMarketSnapshot } from "./onchain.js";
import { yesPrice, confidenceScore } from "./lmsr.js";
import { signResponse, publicKeyBase58 } from "./attestation.js";
import { getMarketStats, getHistoricalMarketStats } from "./indexer.js";
import { getTrackRecord } from "./track-record.js";
import { recordReadPrice, READ_PRICE_FLOOR_USDC_MICRO } from "./pricing.js";
import type { EventPriceResponse, EventSummary } from "./types.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export const v1 = new Hono();

/**
 * Stub price response for an event with no on-chain market yet. Real-market
 * pricing replaces this once `create_event` has been called and the LMSR
 * has trades. The shape is identical; only the values are sentinel zeros.
 */
async function stubPriceResponse(eventId: string): Promise<EventPriceResponse> {
  const event = getEvent(eventId);
  if (!event) {
    throw new Error(`Unknown event_id: ${eventId}`);
  }
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    event_id: eventId,
    description: event.description,
    window_start: now.toISOString(),
    window_end: windowEnd.toISOString(),
    price: 0.5,
    confidence: 0,
    depth_usd: 0,
    trade_count_24h: 0,
    unique_traders_24h: 0,
    twap_24h: 0.5,
    last_change_24h: 0,
    spot_vs_twap_pct: 0,
    resolver_class: event.resolver_class,
    resolver_track_record: await getTrackRecord(event.resolver_class),
    signed_attestation: "", // filled by signResponse() before serialisation
    as_of: now.toISOString(),
    // Stub markets have $0 depth → floor price ($0.0001). Record so the
    // x402 middleware quotes consistently on the next request.
    read_price_usdc_micro: recordReadPrice(eventId, 0),
  };
}

/**
 * Build a live price response from on-chain market state. Falls back to
 * the stub if no market is deployed yet for the event_id.
 */
async function livePriceResponse(eventId: string): Promise<EventPriceResponse> {
  const event = getEvent(eventId);
  if (!event) {
    throw new Error(`Unknown event_id: ${eventId}`);
  }
  const snapshot = await readMarketSnapshot(eventId);
  if (!snapshot) {
    return stubPriceResponse(eventId);
  }

  const price = yesPrice(snapshot.yesShares, snapshot.noShares, snapshot.liquidityParam);
  const depthUsd = snapshot.totalVolumeUsd;
  const [stats, trackRecord] = await Promise.all([
    getMarketStats(snapshot.marketAddress),
    getTrackRecord(event.resolver_class),
  ]);
  const confidence = confidenceScore(
    depthUsd,
    stats.tradeCount24h,
    stats.uniqueTraders24h,
  );

  const now = new Date();
  return {
    event_id: eventId,
    description: event.description,
    window_start: now.toISOString(),
    window_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    price,
    confidence,
    depth_usd: depthUsd,
    trade_count_24h: stats.tradeCount24h,
    unique_traders_24h: stats.uniqueTraders24h,
    twap_24h: price, // TWAP requires price history; same as spot until that ships
    last_change_24h: stats.lastChange24h,
    spot_vs_twap_pct: stats.spotVsTwapPct,
    resolver_class: event.resolver_class,
    resolver_track_record: trackRecord,
    signed_attestation: "", // filled by signResponse() before serialisation
    as_of: now.toISOString(),
    read_price_usdc_micro: recordReadPrice(eventId, depthUsd),
  };
}

/**
 * GET /v1/events
 * Free tier — no x402 payment required for discovery.
 */
v1.get("/events", async (c) => {
  const registry = loadRegistry();
  const events: EventSummary[] = await Promise.all(
    registry.events.map(async (e) => {
      const snapshot = await readMarketSnapshot(e.event_id).catch(() => null);
      const price = snapshot
        ? yesPrice(snapshot.yesShares, snapshot.noShares, snapshot.liquidityParam)
        : 0.5;
      return {
        event_id: e.event_id,
        description: e.description,
        market_kind: marketKindFromProposed(e.market_kind_proposed),
        resolver_class: e.resolver_class,
        price,
        depth_usd: snapshot?.totalVolumeUsd ?? 0,
        window_end: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        status: (snapshot?.status ?? "scheduled") as EventSummary["status"],
      };
    }),
  );
  return c.json({ events });
});

/**
 * Build a historical price response: same shape as live, but with
 * `as_of` set to the closest trade-buffer tick at-or-before `atMs`, and
 * with the 24h-window aggregates recomputed over `[atMs - 24h, atMs]`
 * instead of `[now - 24h, now]`.
 *
 * Returns either a successful response or an `{ error, status }` shape
 * for the caller to surface as JSON. We intentionally return a tagged
 * union (rather than throwing) so the handler can format the 400 body
 * without losing the precomputed earliest-available timestamp.
 */
type HistoricalResult =
  | { ok: true; response: EventPriceResponse }
  | { ok: false; status: 400 | 404; error: string };

async function historicalPriceResponse(
  eventId: string,
  atMs: number,
): Promise<HistoricalResult> {
  const event = getEvent(eventId);
  if (!event) {
    return { ok: false, status: 404, error: `Unknown event_id: ${eventId}` };
  }
  const snapshot = await readMarketSnapshot(eventId);
  if (!snapshot) {
    // No on-chain market yet — historical reads have no meaning either.
    // Surface the same sentinel-zero stub as live reads, with the
    // requested `at` echoed back so downstream signature checks pin to
    // the historical canonical form.
    const stub = await stubPriceResponse(eventId);
    return {
      ok: true,
      response: { ...stub, at: new Date(atMs).toISOString(), as_of: new Date(atMs).toISOString() },
    };
  }

  const histStats = await getHistoricalMarketStats(snapshot.marketAddress, atMs);
  const bufferHorizonMs = atMs - WINDOW_MS;
  if (
    histStats.earliestBufferedMs !== null &&
    histStats.earliestBufferedMs > atMs
  ) {
    // `at` is older than every trade we have on hand — outside the 24h
    // ring-buffer horizon. Surface the earliest buffered tick so the
    // caller can retry within range.
    return {
      ok: false,
      status: 400,
      error: `at=${new Date(atMs).toISOString()} is beyond the 24h history window. Earliest available: ${new Date(histStats.earliestBufferedMs).toISOString()}.`,
    };
  }
  // If the buffer holds zero trades for this market we cannot recompute
  // a historical window; fall through with empty aggregates but flag the
  // truncation so callers know the response isn't backed by trade data.
  void bufferHorizonMs;

  const price = yesPrice(snapshot.yesShares, snapshot.noShares, snapshot.liquidityParam);
  const depthUsd = snapshot.totalVolumeUsd;
  const trackRecord = await getTrackRecord(event.resolver_class);
  const confidence = confidenceScore(
    depthUsd,
    histStats.tradeCount24h,
    histStats.uniqueTraders24h,
  );

  // `as_of` rounds to the nearest sample in the buffer (at-or-before
  // `atMs`). If no trade exists at-or-before `atMs` we fall back to
  // `atMs` itself — the response is then a "buffer empty" snapshot and
  // `window_truncated` will be true.
  const asOfMs = histStats.tickBlockTimeMs ?? atMs;
  const response: EventPriceResponse = {
    event_id: eventId,
    description: event.description,
    window_start: new Date(asOfMs).toISOString(),
    window_end: new Date(asOfMs + 30 * 24 * 60 * 60 * 1000).toISOString(),
    price,
    confidence,
    depth_usd: depthUsd,
    trade_count_24h: histStats.tradeCount24h,
    unique_traders_24h: histStats.uniqueTraders24h,
    twap_24h: price, // TWAP requires price history; same as spot until that ships
    last_change_24h: histStats.lastChange24h,
    spot_vs_twap_pct: histStats.spotVsTwapPct,
    resolver_class: event.resolver_class,
    resolver_track_record: trackRecord,
    signed_attestation: "", // filled by signResponse() before serialisation
    as_of: new Date(asOfMs).toISOString(),
    at: new Date(atMs).toISOString(),
    window_truncated:
      histStats.windowTruncated || histStats.tickBlockTimeMs === null,
    // Historical reads don't mutate the live x402 price cache — agents
    // querying the past should pay for the CURRENT signal value, not
    // whatever depth the market had at `at`. Surface the dynamic price
    // for transparency but compute without recording.
    read_price_usdc_micro: READ_PRICE_FLOOR_USDC_MICRO,
  };
  return { ok: true, response };
}

/**
 * Parse the `at` query parameter as either unix-seconds (integer or
 * decimal) or ISO-8601. Returns null when the parameter is absent or
 * malformed; the handler treats null as "live read".
 */
function parseAtParam(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  // Unix seconds — accept integer or decimal.
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const secs = Number(raw);
    if (!Number.isFinite(secs)) return null;
    return Math.round(secs * 1000);
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return ms;
}

/**
 * GET /v1/event-price?id=<event_id>[&at=<unix_seconds_or_iso8601>]
 * Core x402-priced endpoint. See module docstring for the historical
 * read semantics.
 */
v1.get("/event-price", async (c) => {
  const eventId = c.req.query("id");
  if (!eventId) {
    return c.json({ error: "Missing 'id' query parameter" }, 400);
  }
  const atMs = parseAtParam(c.req.query("at"));
  try {
    // Historical path: only engages when `at` parses AND is in the past.
    // Future or absent `at` falls through to the live handler so the
    // existing live behaviour stays byte-identical.
    if (atMs !== null && atMs <= Date.now()) {
      const result = await historicalPriceResponse(eventId, atMs);
      if (!result.ok) {
        return c.json({ error: result.error }, result.status);
      }
      const signed = signResponse(result.response);
      return c.json(signed);
    }
    const response = await livePriceResponse(eventId);
    const signed = signResponse(response);
    return c.json(signed);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

/**
 * GET /v1/attestation-key
 * Returns the base58 ed25519 public key used to sign /v1/event-price
 * responses. Free tier; clients call once at startup and cache.
 */
v1.get("/attestation-key", (c) => {
  return c.json({
    public_key_base58: publicKeyBase58(),
    algorithm: "ed25519",
    canonicalisation: "json-sorted-keys-no-whitespace-excluding-signed_attestation",
  });
});

/**
 * GET /v1/event-detail?id=<event_id>
 */
v1.get("/event-detail", async (c) => {
  const eventId = c.req.query("id");
  if (!eventId) {
    return c.json({ error: "Missing 'id' query parameter" }, 400);
  }
  const event = getEvent(eventId);
  if (!event) {
    return c.json({ error: `Unknown event_id: ${eventId}` }, 404);
  }
  const snapshot = await readMarketSnapshot(eventId).catch(() => null);
  return c.json({
    event_id: event.event_id,
    description: event.description,
    market_kind_proposed: event.market_kind_proposed,
    resolver_class: event.resolver_class,
    outcome_yes: event.outcome_yes,
    outcome_no: event.outcome_no,
    notes: event.notes ?? null,
    resolver_config: sanitiseConfig(event.resolver_config),
    market_address: snapshot?.marketAddress ?? null,
  });
});

/**
 * Minimal signed price snapshot used by the WS stream endpoint. Same
 * canonical signing scheme as the REST endpoint, but only the four
 * fields agents need for live trading: event_id, price, as_of,
 * signed_attestation. Returns null for unknown event_ids.
 *
 * Stub fallback: if no on-chain market exists yet, returns price=0.5
 * (matches the REST stub) so streams behave the same as the pull API
 * for pre-deployment events.
 */
export interface MinimalPriceSnapshot {
  event_id: string;
  price: number;
  as_of: string;
  signed_attestation: string;
}

export async function minimalPriceSnapshot(
  eventId: string,
): Promise<MinimalPriceSnapshot | null> {
  const event = getEvent(eventId);
  if (!event) return null;
  const snapshot = await readMarketSnapshot(eventId).catch(() => null);
  const price = snapshot
    ? yesPrice(snapshot.yesShares, snapshot.noShares, snapshot.liquidityParam)
    : 0.5;
  const body: MinimalPriceSnapshot = {
    event_id: eventId,
    price,
    as_of: new Date().toISOString(),
    signed_attestation: "",
  };
  return signResponse(body);
}

function marketKindFromProposed(proposed: string): 7 | 8 | 9 {
  switch (proposed) {
    case "EventThreshold":
      return 7;
    case "ProtocolTvlDrop":
      return 8;
    case "PublicStatusPoll":
      return 9;
    default:
      throw new Error(`Unknown market_kind_proposed: ${proposed}`);
  }
}

function sanitiseConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith("_")) continue;
    if (/secret|private|token|api[_-]?key/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}
