import { AgentLeaderboard } from "@/components/agent-leaderboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AgentsPage() {
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
        <AgentLeaderboard />
      </div>
    </main>
  );
}
