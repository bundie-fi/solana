/**
 * v1 — public event-price API.
 *
 * Endpoints (priced via x402 in production; free in dev):
 *
 *   GET /v1/events
 *     List all registered events with current market state.
 *
 *   GET /v1/event-price?id=<event_id>
 *     Returns the live LMSR market price + confidence + depth + TWAP.
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
import type { EventPriceResponse, EventSummary } from "./types.js";

export const v1 = new Hono();

/**
 * Stub price response for an event with no on-chain market yet. Real-market
 * pricing replaces this once `create_event` has been called and the LMSR
 * has trades. The shape is identical; only the values are sentinel zeros.
 */
function stubPriceResponse(eventId: string): EventPriceResponse {
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
    resolver_track_record: { total: 0, disputed: 0, lost: 0 },
    signed_attestation: "",
    as_of: now.toISOString(),
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
  // Trade-count / unique-trader stats require an indexer; v1 surfaces 0
  // until packages/backend/src/indexer/ is wired. Confidence still works
  // off depth alone — thin markets self-report low confidence.
  const tradeCount24h = 0;
  const uniqueTraders24h = 0;
  const confidence = confidenceScore(depthUsd, tradeCount24h, uniqueTraders24h);

  const now = new Date();
  return {
    event_id: eventId,
    description: event.description,
    window_start: now.toISOString(),
    window_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    price,
    confidence,
    depth_usd: depthUsd,
    trade_count_24h: tradeCount24h,
    unique_traders_24h: uniqueTraders24h,
    twap_24h: price, // TWAP requires history; same as spot until indexer ships
    last_change_24h: 0,
    spot_vs_twap_pct: 0,
    resolver_class: event.resolver_class,
    resolver_track_record: { total: 0, disputed: 0, lost: 0 },
    signed_attestation: "", // signer wires in v1.5
    as_of: now.toISOString(),
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
 * GET /v1/event-price?id=<event_id>
 * Core x402-priced endpoint.
 */
v1.get("/event-price", async (c) => {
  const eventId = c.req.query("id");
  if (!eventId) {
    return c.json({ error: "Missing 'id' query parameter" }, 400);
  }
  try {
    const response = await livePriceResponse(eventId);
    return c.json(response);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
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
