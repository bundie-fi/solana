/**
 * stats.ts — platform-wide aggregate metrics for the home page strip.
 *
 * GET /api/stats/platform
 *
 * Returns a single JSON snapshot the home page renders as a five-tile strip
 * across the top of the feed:
 *   - active / total agents
 *   - total TVL (sum of latest nav_lamports per active agent, 6dp bUSD)
 *   - markets total / open / resolved
 *   - 7d weighted platform NAV growth (bps)
 *   - generatedAt (ISO)
 *
 * The aggregations hit nav_snapshots with `DISTINCT ON (agent_sns)`, which
 * is cheap enough but not free — we cache the response in-process for 30s
 * to keep the home page from hammering the DB on every visit.
 *
 * Markets totals come from the `markets` table — a Postgres mirror of
 * on-chain Market accounts, refreshed once per supervisor cycle by
 * chaos-sim's markets-indexer (packages/programs/scripts/chaos-sim/src/lib/
 * markets-indexer.ts). On-chain remains the source of truth; this route
 * trades a few seconds of staleness for sub-millisecond reads.
 */
import { Hono } from "hono";
import { dbQuery, getPool } from "../lib/db.js";

export const stats = new Hono();

interface PlatformStats {
  agentsActive: number;
  agentsTotal: number;
  /** bigint as string, 6dp bUSD (matches nav_lamports / nav_snapshots). */
  totalTvlLamports: string;
  marketsTotal: number;
  marketsOpen: number;
  marketsResolved: number;
  /** Weighted-by-current-TVL 7d return in bps. Null if <2 agents have history. */
  totalNavGrowth7dBps: number | null;
  generatedAt: string;
}

// ── In-process cache ───────────────────────────────────────────────────────
// 30s TTL. Cheap micro-cache — multiple home-page hits in quick succession
// (next dev hot reload, multi-tab) all share one DB round-trip.
const CACHE_TTL_MS = 30_000;
let cache: { data: PlatformStats; expiresAt: number } | null = null;

function emptyStats(): PlatformStats {
  return {
    agentsActive: 0,
    agentsTotal: 0,
    totalTvlLamports: "0",
    marketsTotal: 0,
    marketsOpen: 0,
    marketsResolved: 0,
    totalNavGrowth7dBps: null,
    generatedAt: new Date().toISOString(),
  };
}

stats.get("/api/stats/platform", async (c) => {
  // Serve from cache if fresh.
  if (cache && cache.expiresAt > Date.now()) {
    return c.json(cache.data);
  }

  if (!getPool()) {
    // No DB configured → return an empty snapshot at 200 so the UI strip
    // can render "—" tiles rather than break the page.
    const data = emptyStats();
    return c.json(data);
  }

  // ── Agent counts ─────────────────────────────────────────────────────
  let agentsActive = 0;
  let agentsTotal = 0;
  try {
    const r = await dbQuery<{ active: string; total: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') AS active,
         COUNT(*)                                  AS total
       FROM agents`,
    );
    const row = r?.rows[0];
    if (row) {
      agentsActive = Number(row.active);
      agentsTotal = Number(row.total);
    }
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  // ── Total TVL = sum of latest nav_lamports per active agent ─────────
  // DISTINCT ON picks the most recent snapshot per agent_sns; we then
  // sum those across the active subset only.
  let totalTvlLamports = "0";
  try {
    const r = await dbQuery<{ total: string | null }>(
      `SELECT COALESCE(SUM(latest.nav_lamports), 0)::text AS total
         FROM (
           SELECT DISTINCT ON (agent_sns) agent_sns, nav_lamports
             FROM nav_snapshots
            WHERE agent_sns IN (
              SELECT sns FROM agents WHERE status = 'active'
            )
            ORDER BY agent_sns, ts DESC
         ) latest`,
    );
    totalTvlLamports = r?.rows[0]?.total ?? "0";
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  // ── Markets totals ──────────────────────────────────────────────────
  // The `markets` table is a Postgres mirror of on-chain Market accounts,
  // refreshed once per supervisor cycle by chaos-sim's markets-indexer.
  // Single aggregate query — `COUNT(*) FILTER (...)` keeps it to one
  // table scan instead of three round-trips.
  let marketsTotal = 0;
  let marketsOpen = 0;
  let marketsResolved = 0;
  try {
    const r = await dbQuery<{
      total: string;
      open: string;
      resolved: string;
    }>(
      `SELECT
         COUNT(*)                                 AS total,
         COUNT(*) FILTER (WHERE status = 'open')      AS open,
         COUNT(*) FILTER (WHERE status = 'resolved')  AS resolved
       FROM markets`,
    );
    const row = r?.rows[0];
    if (row) {
      marketsTotal = Number(row.total);
      marketsOpen = Number(row.open);
      marketsResolved = Number(row.resolved);
    }
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  // ── 7d weighted NAV growth ──────────────────────────────────────────
  // For each active agent: pull current nav and the first snapshot at or
  // after now()-7d, then compute a TVL-weighted average return:
  //   sum(current * (current - past) / past) / sum(current)
  // All math in bigint (lamports fit easily). Null if <2 agents qualify.
  let totalNavGrowth7dBps: number | null = null;
  try {
    const r = await dbQuery<{
      agent_sns: string;
      current_nav: string;
      past_nav: string | null;
    }>(
      `WITH active AS (
         SELECT sns FROM agents WHERE status = 'active'
       ),
       latest AS (
         SELECT DISTINCT ON (agent_sns) agent_sns, nav_lamports AS current_nav
           FROM nav_snapshots
          WHERE agent_sns IN (SELECT sns FROM active)
          ORDER BY agent_sns, ts DESC
       ),
       past AS (
         -- Most recent snapshot from at least 7 days ago. Agents with no
         -- snapshot older than 7 days don't qualify and get NULL via the
         -- LEFT JOIN below, so the JS reducer skips them. This is the
         -- correct baseline for a 7d return — comparing today's NAV to
         -- a value from a week ago, not the earliest NAV inside the
         -- last week (which for a 30-minute-old agent would be a
         -- pre-warmup transient and produce 1000%+ phantom growth).
         SELECT DISTINCT ON (agent_sns) agent_sns, nav_lamports AS past_nav
           FROM nav_snapshots
          WHERE agent_sns IN (SELECT sns FROM active)
            AND ts <= now() - INTERVAL '7 days'
          ORDER BY agent_sns, ts DESC
       )
       SELECT l.agent_sns, l.current_nav::text AS current_nav, p.past_nav::text AS past_nav
         FROM latest l
         LEFT JOIN past p USING (agent_sns)`,
    );
    const rows = r?.rows ?? [];
    let qualifying = 0;
    let weightedNum = 0n;   // sum(current * (current - past) / past), in bps
    let weightSum = 0n;     // sum(current)
    for (const row of rows) {
      if (!row.past_nav) continue;
      const cur = BigInt(row.current_nav);
      const past = BigInt(row.past_nav);
      // Drop agents whose only snapshot in the window equals current — no
      // meaningful 7d delta to weight. Also guard against zero start NAV.
      if (past <= 0n) continue;
      if (past === cur) continue;
      // Per-agent return in bps, scaled by weight (current). Multiply by
      // 10000n before dividing to retain bps precision in integer math.
      const returnBpsScaled = ((cur - past) * 10000n) / past;
      weightedNum += cur * returnBpsScaled;
      weightSum += cur;
      qualifying += 1;
    }
    if (qualifying >= 2 && weightSum > 0n) {
      totalNavGrowth7dBps = Number(weightedNum / weightSum);
    }
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  const data: PlatformStats = {
    agentsActive,
    agentsTotal,
    totalTvlLamports,
    marketsTotal,
    marketsOpen,
    marketsResolved,
    totalNavGrowth7dBps,
    generatedAt: new Date().toISOString(),
  };
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return c.json(data);
});
