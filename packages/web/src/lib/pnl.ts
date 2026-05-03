/**
 * Agent P&L API client.
 *
 * Talks to the backend route that aggregates `commit_nav` snapshots into
 * a time-series, plus headline stats (current NAV, 7d/30d return, max
 * drawdown). Backend route is built in parallel; this module is the
 * single source of truth for the contract on the frontend side.
 *
 * Failure mode: empty snapshots + null stats. Caller renders graceful
 * empty state. Never throws.
 *
 * navLamports / *_micros are bigint strings — divide by 1_000_000 to
 * get USD UI value (the prediction market collateral is bUSD, 6dp).
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000";

export type PnlRange = "7d" | "30d" | "all";

export interface PnlComponents {
  baseUsdMicros: string;
  kaminoUsdMicros: string;
  solendUsdMicros: string;
  perpsUsdMicros: string;
}

export interface PnlSnapshot {
  ts: string;
  epoch: number;
  navLamports: string;
  components: PnlComponents | null;
}

export interface PnlStats {
  seedNavLamports: string | null;
  /**
   * The first-ever nav_snapshot for this agent, in lamports (bigint string).
   * This is the honest baseline for "all-time return" — `seedNavLamports`
   * only tracks the user's strategy-token stake, not the warmup airdrop
   * that bumps real NAV before the agent starts trading. Null when the
   * agent has no snapshots yet.
   */
  startingNavLamports: string | null;
  /** ISO timestamp of the `startingNavLamports` snapshot. Null when empty. */
  startingTs: string | null;
  currentNavLamports: string | null;
  return7dBps: number | null;
  return30dBps: number | null;
  /**
   * `(currentNav - startingNav) / startingNav` in bps. Null when there's
   * no starting snapshot, when the start NAV is zero, or when only one
   * snapshot exists (start == current).
   */
  returnAllTimeBps: number | null;
  maxDrawdownBps: number;
  /** Percentage of consecutive NAV ticks that closed positive. Null when
   *  the agent has fewer than 30 paired ticks of history. */
  winRatePct?: number | null;
  /** mean(per-tick return) / std(per-tick return). Same-cadence ratio,
   *  not annualized — see backend pnl.ts for the rationale. Null below
   *  30 ticks or when std==0. */
  sharpeApprox?: number | null;
}

export interface PnlResponse {
  range: PnlRange;
  current: { navLamports: string; epoch: number; ts: string } | null;
  snapshots: PnlSnapshot[];
  stats: PnlStats;
}

const EMPTY: PnlResponse = {
  range: "30d",
  current: null,
  snapshots: [],
  stats: {
    seedNavLamports: null,
    startingNavLamports: null,
    startingTs: null,
    currentNavLamports: null,
    return7dBps: null,
    return30dBps: null,
    returnAllTimeBps: null,
    maxDrawdownBps: 0,
    winRatePct: null,
    sharpeApprox: null,
  },
};

/**
 * Fetch a single agent's P&L payload. Always returns a value — on any
 * failure (404, network, parse error) we return an EMPTY response so
 * the UI can still render placeholder slots.
 *
 * Server-only: we always pass `cache: "no-store"` because NAV updates
 * every commit_nav slot and stale data here defeats the whole point of
 * the chart.
 */
export async function fetchAgentPnl(
  sns: string,
  range: PnlRange = "30d",
): Promise<PnlResponse> {
  try {
    const url = `${BACKEND_URL}/api/agents/${encodeURIComponent(
      sns,
    )}/pnl?range=${range}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ...EMPTY, range };
    const body = (await res.json()) as PnlResponse;
    // Defensive: backend might omit fields if it changes shape.
    return {
      range: body.range ?? range,
      current: body.current ?? null,
      snapshots: Array.isArray(body.snapshots) ? body.snapshots : [],
      stats: body.stats ?? EMPTY.stats,
    };
  } catch {
    return { ...EMPTY, range };
  }
}

// ─── Formatters ──────────────────────────────────────────────────────────

/** Convert a bUSD micros bigint string to a UI USD number. */
export function microsToUsd(micros: string | null | undefined): number | null {
  if (micros == null) return null;
  try {
    return Number(BigInt(micros)) / 1_000_000;
  } catch {
    return null;
  }
}

/** Format USD with 2dp + comma separators. Null → "—". */
export function fmtUsd(usd: number | null): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  return usd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a basis-point return as a signed % string with 2dp. Null → "—".
 * 1 bp = 0.01%. So `bps / 100` is the percent value.
 */
export function fmtReturnBps(bps: number | null): string {
  if (bps == null || !Number.isFinite(bps)) return "—";
  const pct = bps / 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/** Format a drawdown bps as a (always non-negative) % string. */
export function fmtDrawdownBps(bps: number): string {
  if (!Number.isFinite(bps)) return "—";
  return `-${(bps / 100).toFixed(2)}%`;
}
