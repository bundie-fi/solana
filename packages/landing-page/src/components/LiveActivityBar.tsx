/**
 * LiveActivityBar — server-rendered activity strip below the hero.
 *
 * Pulls from the live backend so visitors see real numbers, not lorem ipsum.
 * Renders nothing if the fetch fails or every stat is empty (no broken
 * "0 agents" state ever shown to a user).
 *
 * Data sources:
 *   GET /api/agents — count where status === "active", read navLamports if present
 *
 * The "markets open" stat is intentionally omitted: the markets endpoint
 * still returns mock data and we'd rather undersell than lie. Re-add when
 * the prediction-market program is live and seeded with real markets.
 *
 * Cached for 30s via the segment-level `revalidate` re-export so the page
 * stays SEO-friendly and never spinners on first paint.
 */

const BACKEND = "https://backend.solana.bundie.fi";

export const revalidate = 30;

interface AgentRow {
  sns?: string;
  display_name?: string;
  status?: string;
  navLamports?: number | string | null;
  nav_lamports?: number | string | null;
}

interface ActivityStats {
  agentsLive: number | null;
  topAgent: { name: string; gainPct: number } | null;
}

const NAV_BASELINE = 1_000_000;

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND}${path}`, {
      next: { revalidate: 30 },
      // Don't let a slow backend block the page render forever.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function loadStats(): Promise<ActivityStats | null> {
  const agentsRes = await fetchJson<{ agents: AgentRow[] }>("/api/agents");
  if (!agentsRes) return null;

  const agents = agentsRes.agents ?? [];
  const agentsLive = agents.filter((a) => a.status === "active").length;

  // Top agent: highest navLamports above the seed baseline. If nav data is
  // not yet exposed by the backend, this stat hides itself.
  let topAgent: ActivityStats["topAgent"] = null;
  let topGain = 0;
  for (const a of agents) {
    const nav = toNumber(a.navLamports ?? a.nav_lamports);
    if (nav === null || nav <= NAV_BASELINE) continue;
    const gainPct = ((nav - NAV_BASELINE) / NAV_BASELINE) * 100;
    if (gainPct > topGain) {
      topGain = gainPct;
      topAgent = {
        name: a.display_name || a.sns?.split(".")[0] || "agent",
        gainPct,
      };
    }
  }

  return {
    agentsLive: agentsLive > 0 ? agentsLive : null,
    topAgent,
  };
}

function formatGain(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(pct >= 10 ? 1 : 2)}%`;
}

export default async function LiveActivityBar() {
  const stats = await loadStats();
  if (!stats) return null;

  // If literally nothing has signal, hide the whole bar. The "Live on Solana
  // devnet" pill is not enough on its own to justify a full row.
  const hasAnyDynamic =
    stats.agentsLive !== null || stats.topAgent !== null;
  if (!hasAnyDynamic) return null;

  return (
    <div className="activity-bar-wrap">
      <div className="wrap">
        <div className="activity-bar" role="status" aria-label="Live activity">
          {stats.agentsLive !== null && (
            <div className="activity-stat">
              <span className="activity-num">{stats.agentsLive}</span>
              <span className="activity-label">agents live</span>
            </div>
          )}
          {stats.topAgent && (
            <div className="activity-stat">
              <span className="activity-num">
                {stats.topAgent.name.toLowerCase()}{" "}
                <span className="activity-gain">
                  {formatGain(stats.topAgent.gainPct)}
                </span>
              </span>
              <span className="activity-label">top agent NAV</span>
            </div>
          )}
          <div className="activity-stat activity-stat-pill">
            <span className="activity-pill">
              <span className="activity-dot" />
              Live on Solana devnet
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
