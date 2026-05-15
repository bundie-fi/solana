/**
 * v1 — Bundie public API types.
 *
 * The v1 surface is the x402-priced public oracle. Every priced endpoint
 * returns a structured response with confidence + depth so agents can
 * filter on data quality before acting.
 *
 * The same types are exported via @bundie/sdk (Codama-generated in v1.5);
 * for now, hand-maintained here is fine.
 */

/**
 * Comparator codes for EventThreshold markets. Numeric values are part of
 * the on-chain ABI (see MARKET_KIND_EVENT_THRESHOLD payload layout in
 * programs/prediction-market/src/state/market.rs).
 */
export const COMPARATOR = {
  LT: 0,
  LTE: 1,
  GT: 2,
  GTE: 3,
  EQ: 4,
} as const;

export type ComparatorCode = (typeof COMPARATOR)[keyof typeof COMPARATOR];

/** On-chain market kind discriminators (mirrors src/state/market.rs). */
export const MARKET_KIND = {
  EVENT_THRESHOLD: 7,
  PROTOCOL_TVL_DROP: 8,
  PUBLIC_STATUS_POLL: 9,
} as const;

export type MarketKindCode = (typeof MARKET_KIND)[keyof typeof MARKET_KIND];

/**
 * Resolver class IDs (mirrors scripts/resolvers/sources.json
 * resolver_class field). Numeric IDs are used in MARKET_KIND_PUBLIC_STATUS_POLL
 * payload[24..32] to route the on-chain settlement back to the off-chain
 * resolver implementation.
 */
export const RESOLVER_CLASS = {
  PYTH_THRESHOLD_DURATION: 1,
  ONCHAIN_TVL_ROLLING_WINDOW: 2,
  STATUSPAGE_V2_INCIDENT_DURATION: 3,
  AWS_HEALTH_DASHBOARD_INCIDENT: 4,
} as const;

export type ResolverClassId = (typeof RESOLVER_CLASS)[keyof typeof RESOLVER_CLASS];

/**
 * Public response shape for GET /v1/event-price. Confidence + depth +
 * trader count are first-class so agents can reject thin markets at the
 * client layer. signed_attestation lets on-chain consumers verify the
 * price came from Bundie.
 */
export interface EventPriceResponse {
  event_id: string;
  description: string;
  window_start: string; // ISO-8601 UTC
  window_end: string; // ISO-8601 UTC
  /** YES share price, [0, 1]. Equivalent to market-implied probability. */
  price: number;
  /** 0..1 — function of depth, trade count, unique trader count. */
  confidence: number;
  depth_usd: number;
  trade_count_24h: number;
  unique_traders_24h: number;
  /** Time-weighted average price over the last 24h, [0, 1]. */
  twap_24h: number;
  last_change_24h: number;
  spot_vs_twap_pct: number;
  resolver_class: string;
  resolver_track_record: {
    total: number;
    disputed: number;
    lost: number;
  };
  /** Base64 ed25519 signature over canonical-form response body. */
  signed_attestation: string;
  /** ISO-8601 UTC timestamp of the on-chain state read. */
  as_of: string;
  /**
   * Echoed `at` query parameter (ISO-8601 UTC) when the response was
   * served by the historical read path (`GET /v1/event-price?at=...`).
   * Absent on live reads. Included in the signed-attestation canonical
   * form so historical signatures are not replayable as live ones.
   */
  at?: string;
  /**
   * Only present on historical reads. `true` when the trade-event buffer
   * does not extend back to `at - 24h`, in which case the 24h-window
   * aggregates cover the available subset and not a full 24h.
   */
  window_truncated?: boolean;
  /**
   * Read price for this event in USDC base units (6dp). Dynamic — scales
   * with market depth via the curve in pricing.ts. Agents reading the
   * response see what their NEXT call to this event will cost and can
   * bid the right amount in their x402 X-PAYMENT.
   */
  read_price_usdc_micro: number;
}

/** Summary entry returned by GET /v1/events. */
export interface EventSummary {
  event_id: string;
  description: string;
  market_kind: MarketKindCode;
  resolver_class: string;
  /** Current YES share price. */
  price: number;
  depth_usd: number;
  window_end: string;
  /** "active" | "resolved" | "scheduled" */
  status: "active" | "resolved" | "scheduled";
  /**
   * Product category from `sources.json` (`stablecoin`, `price`, `tvl`,
   * `ai`, `cloud`, `network`). The webapp groups + filters by this.
   * Optional because legacy events may not have it tagged yet.
   */
  category?: string;
}

/**
 * Generic resolver interface. Each resolver class (Pyth threshold, on-chain
 * TVL, status page, AWS health, etc.) implements this so the runner can
 * dispatch uniformly.
 */
export interface Resolver<TConfig> {
  /** Matches resolver_class field in sources.json. */
  readonly className: string;
  /** Matches RESOLVER_CLASS entry. */
  readonly classId: ResolverClassId;
  /**
   * Poll the resolver's data source. Returns:
   *   - null    -> trigger condition not met yet
   *   - "yes"   -> trigger met → market should resolve YES
   *   - "no"    -> window expired without trigger → resolve NO
   */
  poll(eventId: string, config: TConfig, now: Date): Promise<"yes" | "no" | null>;
}

/** Pyth threshold-duration resolver config (parsed from sources.json). */
export interface PythThresholdDurationConfig {
  feed_network_key: string; // e.g. "pyth_feeds.USDC_USD"
  threshold_price: number;
  comparator: "lt" | "lte" | "gt" | "gte" | "eq";
  min_duration_seconds: number;
  window_seconds: number;
  poll_interval_seconds: number;
}

/** Generic event registry entry shape (parsed from sources.json). */
export interface RegistryEvent {
  event_id: string;
  description: string;
  market_kind_proposed: string;
  resolver_class: string;
  resolver_config: Record<string, unknown>;
  outcome_yes: string;
  outcome_no: string;
  demo_eligible?: boolean;
  verify_before_mainnet?: boolean;
  notes?: string;
}

export interface RegistryNetwork {
  pyth_program: string;
  pyth_feeds: Record<string, string>;
  _verify_note?: string;
}

export interface ResolverRegistry {
  version: string;
  comment: string;
  networks: {
    devnet: RegistryNetwork;
    mainnet: RegistryNetwork;
  };
  events: RegistryEvent[];
  next_to_add: string[];
}
