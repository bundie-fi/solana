/**
 * Client helpers for the Bundie v1 event-markets API.
 *
 * The backend exposes /v1/events, /v1/event-price, /v1/event-detail (see
 * packages/backend/src/v1/event-price.ts). In v1 the price endpoints are
 * free during devnet beta; production wraps them with x402 micropayments.
 *
 * Same NEXT_PUBLIC_BACKEND_URL pattern as the other lib clients.
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://backend.solana.bundie.fi";

/** Mirrors the backend's MARKET_KIND constants. */
export type MarketKind = 7 | 8 | 9;

export interface EventSummary {
  event_id: string;
  description: string;
  market_kind: MarketKind;
  resolver_class: string;
  price: number;
  depth_usd: number;
  window_end: string;
  status: "active" | "resolved" | "scheduled";
  /** Product category: stablecoin / price / tvl / ai / cloud / network. */
  category?: string;
}

export interface EventPrice {
  event_id: string;
  description: string;
  window_start: string;
  window_end: string;
  price: number;
  confidence: number;
  depth_usd: number;
  trade_count_24h: number;
  unique_traders_24h: number;
  twap_24h: number;
  last_change_24h: number;
  spot_vs_twap_pct: number;
  resolver_class: string;
  resolver_track_record: { total: number; disputed: number; lost: number };
  signed_attestation: string;
  as_of: string;
  /** Dynamic read price in USDC base units (6dp). Scales with market depth. */
  read_price_usdc_micro: number;
}

export interface EventDetail {
  event_id: string;
  description: string;
  market_kind_proposed: string;
  resolver_class: string;
  outcome_yes: string;
  outcome_no: string;
  notes: string | null;
  resolver_config: Record<string, unknown>;
  /** Live on-chain market address, or null if not yet deployed. */
  market_address: string | null;
}

/** GET /v1/events, list all registered events. */
export async function listEvents(): Promise<EventSummary[]> {
  const res = await fetch(`${BACKEND_URL}/v1/events`, {
    next: { revalidate: 30, tags: ["events"] },
  });
  if (!res.ok) {
    throw new Error(`Failed to list events: ${res.status}`);
  }
  const body = (await res.json()) as { events: EventSummary[] };
  return body.events;
}

/** GET /v1/event-price?id=..., live market price. */
export async function getEventPrice(eventId: string): Promise<EventPrice> {
  const res = await fetch(
    `${BACKEND_URL}/v1/event-price?id=${encodeURIComponent(eventId)}`,
    { next: { revalidate: 5, tags: [`event:${eventId}`] } },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch event price: ${res.status}`);
  }
  return (await res.json()) as EventPrice;
}

/** GET /v1/event-detail?id=..., full event metadata. */
export async function getEventDetail(eventId: string): Promise<EventDetail> {
  const res = await fetch(
    `${BACKEND_URL}/v1/event-detail?id=${encodeURIComponent(eventId)}`,
    { next: { revalidate: 300, tags: [`event-detail:${eventId}`] } },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch event detail: ${res.status}`);
  }
  return (await res.json()) as EventDetail;
}

/** Render a probability as a percentage string. */
export function formatPrice(price: number): string {
  if (price < 0 || price > 1) return "·";
  return `${(price * 100).toFixed(1)}%`;
}

/** Render USD depth with a thousand-separator. */
export function formatDepth(usd: number): string {
  if (usd === 0) return "·";
  if (usd < 1000) return `$${usd.toFixed(0)}`;
  if (usd < 1_000_000) return `$${(usd / 1000).toFixed(1)}k`;
  return `$${(usd / 1_000_000).toFixed(2)}M`;
}

/** Product categories shown on /launch and used to group /markets. */
export const CATEGORIES = [
  {
    key: "stablecoin",
    label: "Stablecoin price",
    blurb: "Will a stablecoin lose its peg, and for how long?",
  },
  {
    key: "price",
    label: "Asset prices",
    blurb: "Major-token price thresholds. Powered by Pyth feeds.",
  },
  {
    key: "tvl",
    label: "Protocol TVL",
    blurb: "Capital flight from a protocol. Fast withdrawals, depositor exits.",
  },
  {
    key: "ai",
    label: "AI infrastructure",
    blurb: "Downtime on OpenAI, Anthropic, Gemini, and other LLM APIs.",
  },
  {
    key: "cloud",
    label: "Cloud uptime",
    blurb: "Region-level outages on AWS, GCP, Cloudflare, GitHub.",
  },
  {
    key: "network",
    label: "Network health",
    blurb: "L1 + L2 sequencer health, mainnet outages, validator events.",
  },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export function categoryLabel(key: string | undefined): string {
  if (!key) return "Other";
  const c = CATEGORIES.find((c) => c.key === key);
  return c ? c.label : "Other";
}

/** Human-friendly market-kind label. */
export function marketKindLabel(kind: MarketKind): string {
  switch (kind) {
    case 7:
      return "Threshold";
    case 8:
      return "TVL Drop";
    case 9:
      return "Status Poll";
    default:
      return "·";
  }
}

/** Friendly resolver-class label. */
export function resolverClassLabel(cls: string): string {
  return cls
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Compute the sha256 of an event_id slug for use as the market PDA seed
 * AND as the `event_id_hash` argument to `buy_event_shares` / `sell_event_shares`
 * / `redeem_event`. Matches the on-chain seed derivation in `create_event`.
 *
 * Uses Web Crypto so it runs in both browser and Edge runtimes. Returns
 * a 32-byte Uint8Array.
 */
export async function computeEventIdHash(eventId: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(eventId);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return new Uint8Array(buf);
}
