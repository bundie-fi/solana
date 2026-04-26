/**
 * Home-feed event model.
 *
 * This module converts a snapshot of prediction-market state + per-agent
 * vault balances into a reverse-chronological list of `FeedEvent`s. The
 * caller is responsible for polling — see `app/page.tsx` for the 15s tick.
 *
 * Three event shapes:
 *   - MARKET_CREATED   when a Market account appears (ordered by createdAt)
 *   - MARKET_RESOLVED  when a Market has status=resolved
 *   - VAULT_DELTA      when an agent's lamport balance moved >1% since the
 *                      previous tick (the caller threads in the previous
 *                      snapshot so we can diff)
 *
 * All events produce stable `id`s so React list reconciliation is clean
 * across polls.
 */
import { MarketView } from "./markets";
import { HERO_AGENTS, resolveSns, truncatePubkey } from "./sns-resolver";

export type FeedEventKind =
  | "MARKET_CREATED"
  | "MARKET_RESOLVED"
  | "VAULT_DELTA";

export interface FeedEvent {
  id: string;
  kind: FeedEventKind;
  /** Unix seconds — for sort + relative-time rendering. */
  timestamp: number;
  emoji: string;
  /** One-line human-readable summary. */
  headline: string;
  /** Optional secondary line (e.g. market question). */
  detail?: string;
  /** Route to open when the card is tapped; null → render as read-only. */
  href?: string;
  /** SNS name of the "actor" (agent) — used for the avatar pill. */
  actorSns?: string;
  /** Emoji for the actor pill; falls back to 🤖 when unknown. */
  actorEmoji?: string;
}

/**
 * Convert a MarketView into the "market created" feed event.
 */
export function marketCreatedEvent(m: MarketView): FeedEvent {
  const creatorSns = resolveSns(m.createdBy);
  const creatorLabel =
    creatorSns?.devnetName ?? truncatePubkey(m.createdBy);
  const targetSns = m.targetAgent ? resolveSns(m.targetAgent) : null;

  let headline: string;
  if (m.kind === 2 && m.targetAgent) {
    const targetLabel =
      targetSns?.devnetName ?? truncatePubkey(m.targetAgent);
    headline = `${creatorLabel} opened a head-to-head market on ${targetLabel}`;
  } else if (m.kind === 1) {
    headline = `${creatorLabel} opened a NAV target market`;
  } else if (m.kind === 3) {
    headline = `${creatorLabel} opened a drawdown market`;
  } else {
    headline = `${creatorLabel} opened a market`;
  }

  const actorEmoji = HERO_AGENTS.find((a) => a.vault === m.createdBy)?.emoji;

  return {
    id: `created:${m.address}`,
    kind: "MARKET_CREATED",
    timestamp: m.createdAt,
    emoji: "🎯",
    headline,
    detail: m.question || undefined,
    href: `/market/${m.address}`,
    actorSns: creatorSns?.devnetName,
    actorEmoji: actorEmoji ?? "🤖",
  };
}

/**
 * Convert a resolved Market into the "resolved" feed event. Uses
 * `createdAt` as a pessimistic timestamp — the program doesn't surface
 * `resolved_at` in the generated IDL consistently across kinds, so
 * sorting the feed by created-time is good enough for a visual stream.
 */
export function marketResolvedEvent(m: MarketView): FeedEvent {
  const creatorSns = resolveSns(m.createdBy);
  const actorEmoji = HERO_AGENTS.find((a) => a.vault === m.createdBy)?.emoji;
  return {
    // Distinct ID so a market appears once as "created" and once as
    // "resolved" in the same feed.
    id: `resolved:${m.address}`,
    kind: "MARKET_RESOLVED",
    timestamp: m.createdAt + 1, // nudge so it sorts above its own creation
    emoji: "✅",
    headline: `Resolved: ${(m.outcome ?? "?").toUpperCase()}`,
    detail: m.question || undefined,
    href: `/market/${m.address}`,
    actorSns: creatorSns?.devnetName,
    actorEmoji: actorEmoji ?? "🤖",
  };
}

export interface VaultSnapshot {
  vault: string;
  lamports: number;
}

export interface VaultDeltaEvent {
  vault: string;
  deltaLamports: number;
  newLamports: number;
}

/**
 * Compare two vault snapshots and produce delta events for any vault
 * whose lamport balance moved more than `thresholdPct` percent (default 1%).
 *
 * Callers pass the current and previous snapshots; we only emit an event
 * when we have a previous value for the vault (first poll has nothing to
 * diff against).
 */
export function diffVaultSnapshots(
  prev: Map<string, number>,
  next: VaultSnapshot[],
  thresholdPct: number = 1,
): VaultDeltaEvent[] {
  const events: VaultDeltaEvent[] = [];
  for (const snap of next) {
    const previousLamports = prev.get(snap.vault);
    if (previousLamports == null) continue;
    if (previousLamports === 0) continue;
    const delta = snap.lamports - previousLamports;
    const pct = Math.abs(delta) / previousLamports;
    if (pct * 100 >= thresholdPct) {
      events.push({
        vault: snap.vault,
        deltaLamports: delta,
        newLamports: snap.lamports,
      });
    }
  }
  return events;
}

export function vaultDeltaFeedEvent(
  ev: VaultDeltaEvent,
  timestamp: number,
): FeedEvent {
  const sns = resolveSns(ev.vault);
  const label = sns?.devnetName ?? truncatePubkey(ev.vault);
  const actorEmoji = HERO_AGENTS.find((a) => a.vault === ev.vault)?.emoji;
  const sign = ev.deltaLamports >= 0 ? "+" : "";
  const sol = (ev.deltaLamports / 1e9).toFixed(4);
  return {
    id: `vault:${ev.vault}:${timestamp}`,
    kind: "VAULT_DELTA",
    timestamp,
    emoji: "💰",
    headline: `${label} vault updated`,
    detail: `${sign}${sol} SOL · now ${(ev.newLamports / 1e9).toFixed(4)} SOL`,
    href: `/agent/${sns?.devnetName ?? ev.vault}`,
    actorSns: sns?.devnetName,
    actorEmoji: actorEmoji ?? "🤖",
  };
}

/**
 * Human-readable relative time — "2m ago", "5h ago". Prefer this over
 * Intl.RelativeTimeFormat because we want to keep the feed text compact.
 */
export function formatRelative(timestamp: number, now: number = Date.now() / 1000): string {
  if (!timestamp || timestamp <= 0) return "—";
  const delta = Math.max(0, Math.floor(now - timestamp));
  if (delta < 45) return `${delta}s ago`;
  if (delta < 60 * 60) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 60 * 60 * 24) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}
