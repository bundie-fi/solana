/**
 * 7-day track-record quality gate for the bettor "buy shares" CTA.
 *
 * Why this exists: the platform shipped before any track-record protection
 * for predictors. Before this gate, anyone could open a market backed by an
 * agent that had been alive for 1 hour, then route their friends to bet on
 * it , a credibility hole flagged in product feedback. The gate disables
 * the buy CTA when the underlying agent has < 7 days of NAV history and
 * surfaces an explainer instead of hiding the market entirely.
 *
 * Server-only: the fetch hits the backend P&L route (which requires a
 * known-SNS lookup) and we want to keep that call off the client. The
 * result is computed in market detail / market card server components and
 * passed to the client buy panel as a serialised prop.
 *
 * Failure mode: if `startingTs` is unavailable for ANY reason (backend
 * doesn't yet ship the field, agent has no snapshots, fetch fails) we
 * return `passes=true` with `daysOfHistory=0` , a "track record loading"
 * pass-through so we never gate-block during a deploy ordering window
 * where the frontend rolls out before the backend exposes the field.
 */
import { fetchAgentPnl } from "@/lib/pnl";

/**
 * Minimum days of NAV history before bet CTAs unlock for an agent's
 * markets. The hard 7-day default that shipped with the gate made every
 * brand-new agent un-bettable, which blocks demos and the early-stage
 * platform experience where almost no agent is more than a few days old.
 *
 * Default lowered to 0 (gate effectively off) so the platform stays
 * open by default. Operators can re-enable the protection by setting
 * NEXT_PUBLIC_QUALITY_GATE_MIN_DAYS to a non-zero value (e.g. 7) once
 * there's a meaningful track-record cohort to protect bettors against.
 */
export const QUALITY_GATE_MIN_DAYS = (() => {
  const raw = process.env.NEXT_PUBLIC_QUALITY_GATE_MIN_DAYS;
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
})();

export interface QualityGateResult {
  /** True when the agent has >= QUALITY_GATE_MIN_DAYS of NAV history (or
   *  when we couldn't determine — fail-open). */
  passes: boolean;
  /** Floored integer days of NAV history. 0 when unknown. */
  daysOfHistory: number;
  /** Human-readable reason when `passes` is false. Always undefined when
   *  passes is true. */
  reason?: string;
}

/**
 * Check whether an agent (referenced by SNS) has enough NAV history to
 * back a prediction market that bettors can buy into.
 *
 * Pass `null` / empty string when the caller couldn't resolve the creator
 * to an SNS — we fail-open in that case (some markets are created by
 * vaults that pre-date the registry).
 */
export async function checkAgentQualityGate(
  sns: string | null | undefined,
): Promise<QualityGateResult> {
  // No SNS to look up — can't gate, fail-open.
  if (!sns) {
    return { passes: true, daysOfHistory: 0 };
  }

  let pnl;
  try {
    pnl = await fetchAgentPnl(sns, "all");
  } catch {
    // Network / parse error — fail-open so a flaky backend doesn't block
    // every bet on the platform.
    return { passes: true, daysOfHistory: 0 };
  }

  const startingTs = pnl?.stats?.startingTs;
  // Backend deploy ordering: a parallel worker is adding `startingTs` to
  // the PNL route. If our code hits production before theirs, fail-open.
  if (!startingTs) {
    return { passes: true, daysOfHistory: 0 };
  }

  const startMs = Date.parse(startingTs);
  if (!Number.isFinite(startMs)) {
    return { passes: true, daysOfHistory: 0 };
  }

  const ageMs = Date.now() - startMs;
  const daysOfHistory = Math.max(0, Math.floor(ageMs / 86_400_000));

  if (daysOfHistory >= QUALITY_GATE_MIN_DAYS) {
    return { passes: true, daysOfHistory };
  }

  return {
    passes: false,
    daysOfHistory,
    reason: `Track record building, ${daysOfHistory}/${QUALITY_GATE_MIN_DAYS} days`,
  };
}
