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

  // Fetch the agent's seed deposit so the UI can render a baseline line on
  // the chart. `seed_amount_busd` is stored in 6dp base units (see
  // packages/backend/src/routes/agents.ts seedAmountBase). It can be a
  // string (numeric column) or number depending on driver — coerce both.
  let seedNavLamports: string | null = null;
  try {
    const r = await dbQuery<AgentSeedRow>(
      `SELECT seed_amount_busd FROM agents WHERE sns = $1 LIMIT 1`,
      [sns],
    );
    const seed = r?.rows[0]?.seed_amount_busd ?? null;
    if (seed !== null && seed !== undefined) {
      seedNavLamports = String(seed);
    }
  } catch {
    // Best-effort; seed is optional in the response.
  }

  // Fetch the agent's FIRST nav snapshot — the real starting NAV (seed +
  // warmup airdrop). This is the honest baseline for "all-time return"
  // since `seed_amount_busd` only tracks the strategy-token stake, not the
  // 5 SOL warmup airdrop that lands before the agent starts trading.
  let startingNavLamports: string | null = null;
  let startingTs: string | null = null;
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

  // For 7d / 30d returns we always reach back beyond the current `range`
  // window — the user can ask for "all" but still want a 7d return badge.
  // Cheap separate scans, each capped to one row.
  async function navAtOrAfter(daysAgo: number): Promise<bigint | null> {
    try {
      const r = await dbQuery<{ nav_lamports: string }>(
        `SELECT nav_lamports
           FROM nav_snapshots
          WHERE agent_sns = $1
            AND ts >= now() - $2::interval
          ORDER BY ts ASC
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
    const start7 = await navAtOrAfter(7);
    const start30 = await navAtOrAfter(30);
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
    // All-time return uses the first-ever snapshot as baseline — this is
    // the honest "is the agent good" number. seed_amount_busd as a base
    // would understate the loss since warmup airdrops bump real NAV well
    // above the strategy stake before the agent starts trading.
    if (startingNavLamports) {
      const startAll = BigInt(startingNavLamports);
      if (startAll > 0n && startAll !== cur) {
        returnAllTimeBps = bpsReturn(startAll, cur);
      }
    }
  }

  const maxDdBps = maxDrawdownBps(navSeries);

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
    },
  });
});
