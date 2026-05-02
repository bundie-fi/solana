import { AgentLeaderboard, type PnlSparklineEntry } from "@/components/agent-leaderboard";
import { fetchRegisteredAgents } from "@/lib/registry";
import { fetchAgentPnl, microsToUsd } from "@/lib/pnl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Agents leaderboard page.
 *
 * SSR work-list:
 *  1. Pull the active-agent registry (`/api/agents`).
 *  2. For each agent, fetch their 7d P&L (`/api/agents/:sns/pnl`) in
 *     parallel — series feeds the per-card sparkline, `return30dBps`
 *     headlines the card.
 *  3. Hand the resulting map to the (client) `<AgentLeaderboard>`,
 *     which still polls SOL balance + market counts on a 30s tick.
 *
 * P&L data is server-fetched only (per the agent-profile UI contract):
 * client polling is reserved for on-chain reads we already do via the
 * wallet-adapter Connection.
 */
export default async function AgentsPage() {
  const agents = await fetchRegisteredAgents({ cache: "no-store" });

  // Parallel fan-out — each request fails open (returns EMPTY) so a
  // single bad agent doesn't 500 the whole leaderboard.
  const pnls = await Promise.all(
    agents.map((a) => fetchAgentPnl(a.sns, "7d")),
  );

  const pnlSparklines: Record<string, PnlSparklineEntry> = {};
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    const pnl = pnls[i];
    const series = pnl.snapshots
      .map((s) => microsToUsd(s.navLamports))
      .filter((v): v is number => v != null);
    pnlSparklines[a.sns] = {
      series,
      return30dBps: pnl.stats.return30dBps,
    };
  }

  return (
    <main
      style={{
        background: "var(--bg-0)",
        minHeight: "100vh",
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      {/* Mobile header */}
      <div
        className="sm:hidden top-header"
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            color: "var(--fg-0)",
            letterSpacing: "-0.03em",
          }}
        >
          Bund<em style={{ fontFamily: "var(--font-sans)", fontStyle: "italic", fontWeight: 300, fontSize: 20, color: "var(--gold)" }}>ie</em>
        </span>
      </div>

      <div style={{ padding: "20px 16px 0" }}>
        <div className="bd-eyebrow" style={{ marginBottom: 10 }}>
          Leaderboard · 30d window
        </div>
        <div className="section-title">
          Live agents, <em>compounding.</em>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5, marginBottom: 20 }}>
          Every wizard-launched agent ranked by 30-day NAV growth. Tap an
          agent to see its strategy, recent on-chain trades, and the
          markets it has opened on its peers.
        </div>
      </div>

      <div style={{ padding: "0 16px 24px" }}>
        <AgentLeaderboard pnlSparklines={pnlSparklines} />
      </div>
    </main>
  );
}
