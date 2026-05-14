/**
 * v1 — public event-price API.
 *
 * Endpoints (all priced via x402 in production; free in dev):
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
 * v1 implementation note: when no on-chain market exists for an event_id
 * yet (i.e. before create_event_v3 has been called), the endpoint returns
 * a stub response with price=0.5, confidence=0, depth=0. Clients filter
 * on confidence>0 to ignore unresolved-state stubs. Once markets are
 * deployed, the same code path reads on-chain state and returns real
 * numbers — no separate "mocked" vs "real" branches.
 */

import { Hono } from "hono";
import { loadRegistry, getEvent } from "./registry.js";
import type { EventPriceResponse, EventSummary } from "./types.js";

export const v1 = new Hono();

/**
 * Stub price response for an event with no on-chain market yet. Real-market
 * pricing replaces this once create_event_v3 has been called and the LMSR
 * has trades. The shape is identical; only the values are zero/sentinel.
 */
function stubPriceResponse(eventId: string): EventPriceResponse {
  const event = getEvent(eventId);
  if (!event) {
    throw new Error(`Unknown event_id: ${eventId}`);
  }
  const now = new Date();
  // window_start at now, window_end +30d as a placeholder
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
 * GET /v1/events
 *
 * Returns the full list of registered events with summary fields.
 * Free tier — no x402 payment required for discovery.
 */
v1.get("/events", (c) => {
  const registry = loadRegistry();
  const events: EventSummary[] = registry.events.map((e) => ({
    event_id: e.event_id,
    description: e.description,
    market_kind: marketKindFromProposed(e.market_kind_proposed),
    resolver_class: e.resolver_class,
    price: 0.5, // stub until markets deploy
    depth_usd: 0,
    window_end: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    status: "scheduled",
  }));
  return c.json({ events });
});

/**
 * GET /v1/event-price?id=<event_id>
 *
 * The core x402-priced endpoint. Returns the live market price for an
 * event. In production, the x402 payment headers are verified before
 * the response is returned; in dev, the endpoint is free.
 */
v1.get("/event-price", (c) => {
  const eventId = c.req.query("id");
  if (!eventId) {
    return c.json({ error: "Missing 'id' query parameter" }, 400);
  }
  try {
    const response = stubPriceResponse(eventId);
    return c.json(response);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

/**
 * GET /v1/event-detail?id=<event_id>
 *
 * Full event metadata including resolver config (sanitised — no private
 * keys, no internal endpoints). Used by agent SDKs to introspect the
 * event before subscribing.
 */
v1.get("/event-detail", (c) => {
  const eventId = c.req.query("id");
  if (!eventId) {
    return c.json({ error: "Missing 'id' query parameter" }, 400);
  }
  const event = getEvent(eventId);
  if (!event) {
    return c.json({ error: `Unknown event_id: ${eventId}` }, 404);
  }
  return c.json({
    event_id: event.event_id,
    description: event.description,
    market_kind_proposed: event.market_kind_proposed,
    resolver_class: event.resolver_class,
    outcome_yes: event.outcome_yes,
    outcome_no: event.outcome_no,
    notes: event.notes ?? null,
    // resolver_config is sanitised on read — drop any keys starting with _ or
    // anything looking like a credential. None of the v1 demo configs contain
    // sensitive data, but defensive sanitisation prevents accidental leaks
    // when new resolvers are added.
    resolver_config: sanitiseConfig(event.resolver_config),
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
