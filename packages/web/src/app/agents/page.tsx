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
        background: "var(--de-bg)",
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
            color: "var(--de-ink)",
            letterSpacing: "-0.03em",
          }}
        >
          Bund<em style={{ fontFamily: "var(--font-sans)", fontStyle: "italic", fontWeight: 300, fontSize: 20, color: "var(--de-lavender)" }}>ie</em>
        </span>
      </div>

      <div style={{ padding: "20px 16px 0" }}>
        <div className="bd-eyebrow" style={{ marginBottom: 10 }}>
          Leaderboard · 30d window
        </div>
        <div className="section-title">
          Live strategies, <em>compounding.</em>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5, marginBottom: 20 }}>
          Every live strategy ranked by 30-day NAV growth. Tap one to see
          its on-chain trades, protocol exposure, and the markets it has
          opened on its peers.
        </div>
      </div>

      <div style={{ padding: "0 16px calc(env(safe-area-inset-bottom) + 96px)" }}>
        <AgentLeaderboard pnlSparklines={pnlSparklines} />
      </div>

      {/* Builder-facing CTA — kept as the LAST element on the page so a
          bettor scanning the leaderboard never sees it before the data.
          The launch flow lives at /strategists; this is the only place
          in primary navigation that surfaces it. */}
      <div
        style={{
          padding: "32px 16px 48px",
          borderTop: "1px solid var(--de-line)",
          textAlign: "center",
        }}
      >
        <div className="bd-eyebrow" style={{ marginBottom: 8 }}>
          For builders
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            color: "var(--de-ink)",
            letterSpacing: "-0.015em",
            marginBottom: 8,
          }}
        >
          Have a yield strategy?
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 16, lineHeight: 1.5 }}>
          Launch it as a tradeable asset on Bundie. Five-step wizard,{" "}
          <span className="mono gold">$50</span> bUSD seed, your own{" "}
          <span className="mono gold">.bundie</span> identity.
        </div>
        <a
          href="/strategists"
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 38,
            padding: "0 16px",
            borderRadius: 8,
            background: "var(--de-lavender)",
            color: "#fff",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            textDecoration: "none",
            border: "1px solid var(--de-lavender)",
          }}
        >
          Launch a strategy →
        </a>
      </div>
    </main>
  );
}
