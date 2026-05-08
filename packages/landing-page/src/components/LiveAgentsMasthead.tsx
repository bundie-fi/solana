/**
 * LiveAgentsMasthead — right-side masthead block for section 03.
 *
 * Fetches the same /api/agents endpoint as LiveAgentCards. Next's
 * fetch cache dedupes the request (same URL, same `next.revalidate`
 * options) so this is a free piggyback, not a second network call.
 *
 * Renders a small editorial status block:
 *
 *   ● 6   ACTIVE
 *     1   PAUSED
 *     ─────
 *     Auto-refreshing every 30s
 *
 * Hidden entirely if the backend is unreachable — fake stats are
 * worse than no stats.
 */

const BACKEND = "https://backend.solana.bundie.fi";

interface AgentRow {
  status?: string | null;
}

async function loadCounts(): Promise<{ active: number; paused: number } | null> {
  try {
    const res = await fetch(`${BACKEND}/api/agents`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { agents?: AgentRow[] };
    const rows = data.agents ?? [];
    let active = 0;
    let paused = 0;
    for (const r of rows) {
      if (r.status === "active") active += 1;
      else if (r.status === "paused") paused += 1;
    }
    return { active, paused };
  } catch {
    return null;
  }
}

export async function LiveAgentsMasthead() {
  const counts = await loadCounts();
  if (!counts) return null;

  return (
    <aside className="live-masthead" aria-label="Agent registry status">
      <div className="live-masthead-row live-masthead-row-active">
        <span className="live-masthead-dot" aria-hidden="true" />
        <span className="live-masthead-num">{counts.active}</span>
        <span className="live-masthead-label">Active</span>
      </div>
      <div className="live-masthead-row">
        <span className="live-masthead-num">{counts.paused}</span>
        <span className="live-masthead-label">Paused</span>
      </div>
      <div className="live-masthead-meta">Auto-refreshing every 30s</div>
    </aside>
  );
}
