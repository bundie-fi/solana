/**
 * pnl.ts — equity-curve / P&L feed for the agent profile page.
 *
 * The chaos-sim daemon writes one `nav_snapshots` row per successful
 * `commit_nav` (see packages/programs/scripts/chaos-sim/src/agents/shared-tick.ts).
 * This route fans them back out as a chartable time-series, plus headline
 * stats (return, max drawdown) computed server-side so every client agrees
 * on the numbers.
 *
 * GET /api/agents/:sns/pnl?range=7d|30d|all
 *
 * Default range: 30d. Cap: 5000 rows ASC by ts. Returns empty `snapshots[]`
 * + null stats when the agent has no snapshots yet (still 200 — the UI
 * renders a flat line rather than an error state).
 */
import { Hono } from "hono";
import { dbQuery, getPool } from "../lib/db.js";

export const pnl = new Hono();

const MAX_ROWS = 5000;
const VALID_RANGES = new Set(["7d", "30d", "all"] as const);
type Range = "7d" | "30d" | "all";

interface NavSnapshotRow {
  ts: string;
  nav_epoch: number | string;
  nav_lamports: string;
  base_usd_micros: string | null;
  kamino_usd_micros: string | null;
  solend_usd_micros: string | null;
  perps_usd_micros: string | null;
}

interface AgentSeedRow {
  seed_amount_busd: number | string | null;
  post_warmup_starting_nav_lamports: string | number | null;
  post_warmup_starting_ts: string | Date | null;
}

interface SnapshotDto {
  ts: string;
  epoch: number;
  navLamports: string;
  components: {
    baseUsdMicros: string;
    kaminoUsdMicros: string;
    solendUsdMicros: string;
    perpsUsdMicros: string;
  } | null;
}

/**
 * Compute return in basis points between two NAV values. Returns null if
 * the start NAV is zero/missing — division by zero would yield Infinity,
 * and bps over a zero base aren't meaningful for the UI.
 */
function bpsReturn(startLamports: bigint, endLamports: bigint): number | null {
  if (startLamports <= 0n) return null;
  // (end - start) / start, scaled to bps (×10000). Do the math in bigint
  // to avoid float drift on values up to ~1e18 (way below the lamport cap).
  const num = (endLamports - startLamports) * 10000n;
  // Round-half-down via integer division; the sign comes from the numerator.
  return Number(num / startLamports);
}

/**
 * Walk a series tracking running peak; return the max (peak - cur) / peak
 * in bps. Returns 0 for monotonically-non-decreasing series. Series must
 * be ordered ascending by ts.
 */
function maxDrawdownBps(series: bigint[]): number {
  if (series.length === 0) return 0;
  let peak = series[0];
  let worstBps = 0n;
  for (const v of series) {
    if (v > peak) peak = v;
    if (peak > 0n) {
      const ddBps = ((peak - v) * 10000n) / peak;
      if (ddBps > worstBps) worstBps = ddBps;
    }
  }
  return Number(worstBps);
}

pnl.get("/api/agents/:sns/pnl", async (c) => {
  const sns = c.req.param("sns");
  const rangeParam = c.req.query("range") ?? "30d";
  const range: Range = VALID_RANGES.has(rangeParam as Range)
    ? (rangeParam as Range)
    : "30d";

  if (!getPool()) {
    return c.json(
      {
        range,
        current: null,
        snapshots: [],
        stats: {
          seedNavLamports: null,
          startingNavLamports: null,
          currentNavLamports: null,
          return7dBps: null,
          return30dBps: null,
          returnAllTimeBps: null,
          maxDrawdownBps: 0,
        },
      },
      503,
    );
  }

  // Translate the range param into a Postgres interval predicate. The
  // `ts` column is `timestamptz`, indexed by (agent_sns, ts desc), so the
  // planner can satisfy this with an index range scan.
  let whereTs = "";
  const params: unknown[] = [sns];
  if (range !== "all") {
    const days = range === "7d" ? 7 : 30;
    params.push(`${days} days`);
    whereTs = `AND ts > now() - $${params.length}::interval`;
  }
  // Always cap row count, ordered ASC for chart consumption.
  params.push(MAX_ROWS);
  const limitIdx = params.length;

  let rows: NavSnapshotRow[] = [];
  try {
    const r = await dbQuery<NavSnapshotRow>(
      `SELECT ts, nav_epoch, nav_lamports,
              base_usd_micros, kamino_usd_micros,
              solend_usd_micros, perps_usd_micros
         FROM nav_snapshots
        WHERE agent_sns = $1 ${whereTs}
        ORDER BY ts ASC
        LIMIT $${limitIdx}`,
      params,
    );
    rows = r?.rows ?? [];
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  // Fetch the agent's seed deposit + post-warmup starting NAV in a single
  // round-trip. `seed_amount_busd` is stored in 6dp base units (see
  // packages/backend/src/routes/agents.ts seedAmountBase). It can be a
  // string (numeric column) or number depending on driver — coerce both.
  // `post_warmup_starting_*` is captured exactly once per agent on the
  // first commit_nav after warmup completes (see chaos-sim shared-tick.ts).
  let seedNavLamports: string | null = null;
  let postWarmupStartingNavLamports: string | null = null;
  let postWarmupStartingTs: string | null = null;
  try {
    const r = await dbQuery<AgentSeedRow>(
      `SELECT seed_amount_busd,
              post_warmup_starting_nav_lamports,
              post_warmup_starting_ts
         FROM agents WHERE sns = $1 LIMIT 1`,
      [sns],
    );
    const row = r?.rows[0];
    if (row) {
      const seed = row.seed_amount_busd ?? null;
      if (seed !== null && seed !== undefined) {
        seedNavLamports = String(seed);
      }
      if (
        row.post_warmup_starting_nav_lamports !== null &&
        row.post_warmup_starting_nav_lamports !== undefined
      ) {
        postWarmupStartingNavLamports = String(
          row.post_warmup_starting_nav_lamports,
        );
      }
      if (row.post_warmup_starting_ts) {
        postWarmupStartingTs = new Date(row.post_warmup_starting_ts).toISOString();
      }
    }
  } catch {
    // Best-effort; these are optional in the response.
  }

  // Resolve the all-time baseline: prefer the post-warmup capture (honest
  // post-airdrop NAV) and fall back to the FIRST nav_snapshots row for
  // legacy agents that haven't ticked since the migration shipped. The
  // first-snapshot fallback IS misleading on fresh agents (it picks up the
  // pre-warmup ~$12 transient and inflates returnAllTimeBps to +4894),
  // but for any agent that's run a single post-warmup tick the new column
  // overrides it.
  let startingNavLamports: string | null = postWarmupStartingNavLamports;
  let startingTs: string | null = postWarmupStartingTs;
  if (startingNavLamports === null) {
    try {
      const r = await dbQuery<{ nav_lamports: string; ts: string }>(
        `SELECT nav_lamports, ts
           FROM nav_snapshots
          WHERE agent_sns = $1
          ORDER BY ts ASC
          LIMIT 1`,
        [sns],
      );
      const first = r?.rows[0];
      if (first) {
        startingNavLamports = String(first.nav_lamports);
        startingTs = new Date(first.ts).toISOString();
      }
    } catch {
      // Best-effort; null falls back to seedNavLamports on the client.
    }
  }

  const snapshots: SnapshotDto[] = rows.map((row) => {
    const hasComponents =
      row.base_usd_micros !== null ||
      row.kamino_usd_micros !== null ||
      row.solend_usd_micros !== null ||
      row.perps_usd_micros !== null;
    return {
      ts: new Date(row.ts).toISOString(),
      epoch: Number(row.nav_epoch),
      navLamports: String(row.nav_lamports),
      components: hasComponents
        ? {
            baseUsdMicros: String(row.base_usd_micros ?? "0"),
            kaminoUsdMicros: String(row.kamino_usd_micros ?? "0"),
            solendUsdMicros: String(row.solend_usd_micros ?? "0"),
            perpsUsdMicros: String(row.perps_usd_micros ?? "0"),
          }
        : null,
    };
  });

  // ── Headline stats ──────────────────────────────────────────────────
  const navSeries = snapshots.map((s) => BigInt(s.navLamports));
  const currentNavLamports =
    navSeries.length > 0 ? String(navSeries[navSeries.length - 1]) : null;
  const current =
    snapshots.length > 0
      ? {
          navLamports: snapshots[snapshots.length - 1].navLamports,
          epoch: snapshots[snapshots.length - 1].epoch,
          ts: snapshots[snapshots.length - 1].ts,
        }
      : null;

  // For 7d / 30d returns we want the most recent snapshot from at LEAST
  // `daysAgo` days ago — i.e. a value from outside the window — so the
  // baseline is "where NAV stood a week ago" not "the earliest NAV inside
  // the last week". Same fix that landed for the platform-wide 7d strip
  // in commit 25bc423: a 2-day-old agent asked for return30dBps would
  // otherwise anchor to its pre-warmup ~$11 transient and report +5570%.
  // Agents without a snapshot older than the window get NULL and the
  // caller leaves the return field unset.
  async function navAtLeastNDaysAgo(daysAgo: number): Promise<bigint | null> {
    try {
      const r = await dbQuery<{ nav_lamports: string }>(
        `SELECT nav_lamports
           FROM nav_snapshots
          WHERE agent_sns = $1
            AND ts <= now() - $2::interval
          ORDER BY ts DESC
          LIMIT 1`,
        [sns, `${daysAgo} days`],
      );
      const v = r?.rows[0]?.nav_lamports;
      return v !== undefined ? BigInt(v) : null;
    } catch {
      return null;
    }
  }

  let return7dBps: number | null = null;
  let return30dBps: number | null = null;
  let returnAllTimeBps: number | null = null;
  if (navSeries.length >= 2 && currentNavLamports) {
    const cur = BigInt(currentNavLamports);
    const start7 = await navAtLeastNDaysAgo(7);
    const start30 = await navAtLeastNDaysAgo(30);
    // Need at least two distinct points inside the window for a return —
    // a single snapshot returned by `navAtOrAfter` could BE the current
    // one, which would render as 0 bps. Compare epoch via ts instead:
    // if the start row equals current we treat the window as too small.
    if (start7 !== null && start7 !== cur) {
      return7dBps = bpsReturn(start7, cur);
    }
    if (start30 !== null && start30 !== cur) {
      return30dBps = bpsReturn(start30, cur);
    }
    // All-time return uses the post-warmup starting NAV as baseline (or
    // the first-ever snapshot for legacy agents that predate the
    // post-warmup capture). This is the honest "is the agent good"
    // number. The FIRST nav_snapshots row on its own would anchor to the
    // pre-warmup ~$12 fee buffer and report wildly inflated returns the
    // moment the 5 SOL + 100 USDC airdrop lands.
    if (startingNavLamports) {
      const startAll = BigInt(startingNavLamports);
      if (startAll > 0n && startAll !== cur) {
        returnAllTimeBps = bpsReturn(startAll, cur);
      }
    }
  }

  const maxDdBps = maxDrawdownBps(navSeries);
  const { winRatePct, sharpeApprox } = qualityStats(
    navSeries,
    snapshots.map((s) => s.ts),
  );

  return c.json({
    range,
    current,
    snapshots,
    stats: {
      seedNavLamports,
      startingNavLamports,
      startingTs,
      currentNavLamports,
      return7dBps,
      return30dBps,
      returnAllTimeBps,
      maxDrawdownBps: maxDdBps,
      // Quality stats — null when there isn't enough data to be meaningful.
      // The 6-cell stats grid on the agent profile renders "—" for nulls.
      winRatePct,
      sharpeApprox,
    },
  });
});

/**
 * Tick-level win rate + annualized Sharpe from the NAV series.
 *
 * winRatePct: percentage of consecutive snapshot pairs where NAV ticked up.
 * The shared-tick daemon writes ~every 15s when active so this is a
 * "% of ticks that were positive" — directly comparable across agents
 * because they all read off the same snapshot cadence.
 *
 * sharpeApprox: annualized Sharpe ratio computed empirically from the
 * snapshot timestamps. Steps:
 *
 *   1. tick_returns = (NAV[i] - NAV[i-1]) / NAV[i-1], unitless
 *   2. mean = average tick return; std = stddev of tick returns
 *   3. tick_dt = MEDIAN delta-t between consecutive snapshots, in seconds.
 *      Median (not mean) is robust to single outliers — fork resets
 *      occasionally produce 30-min gaps and we don't want one of those
 *      gaps to halve everyone's Sharpe.
 *   4. ticks_per_year = 31_557_600 / tick_dt
 *   5. sharpe_annual = (mean / std) * sqrt(ticks_per_year)
 *
 * For 15s ticks, ticks_per_year ≈ 2.1M, sqrt ≈ 1450 — meaningful only when
 * mean/std is genuinely small (sub-bp). This produces Sharpes comparable
 * in shape to trad-fi numbers (typically -2 to +5 for live strategies).
 *
 * Both null below 30 paired ticks or when std==0.
 */
function qualityStats(
  navSeries: bigint[],
  isoTimestamps: string[],
): {
  winRatePct: number | null;
  sharpeApprox: number | null;
} {
  if (navSeries.length < 31) return { winRatePct: null, sharpeApprox: null };

  const returns: number[] = [];
  for (let i = 1; i < navSeries.length; i++) {
    const prev = navSeries[i - 1];
    const cur = navSeries[i];
    if (prev <= 0n) continue;
    // (cur - prev) / prev, in float — fine for stats, the bigint precision
    // is overkill for ratios this small.
    const r = Number(cur - prev) / Number(prev);
    if (Number.isFinite(r)) returns.push(r);
  }
  if (returns.length < 30) return { winRatePct: null, sharpeApprox: null };

  const wins = returns.filter((r) => r > 0).length;
  const winRatePct = (wins / returns.length) * 100;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std <= 0) return { winRatePct, sharpeApprox: null };

  // Empirical tick cadence (median delta-t between snapshots, seconds).
  const deltas: number[] = [];
  for (let i = 1; i < isoTimestamps.length; i++) {
    const a = Date.parse(isoTimestamps[i - 1]);
    const b = Date.parse(isoTimestamps[i]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      deltas.push((b - a) / 1000);
    }
  }
  if (deltas.length === 0) return { winRatePct, sharpeApprox: null };
  deltas.sort((a, b) => a - b);
  const medianDt = deltas[Math.floor(deltas.length / 2)];
  if (medianDt <= 0) return { winRatePct, sharpeApprox: null };

  const SECONDS_PER_YEAR = 31_557_600;
  const ticksPerYear = SECONDS_PER_YEAR / medianDt;
  const sharpeApprox = (mean / std) * Math.sqrt(ticksPerYear);

  return { winRatePct, sharpeApprox };
}
