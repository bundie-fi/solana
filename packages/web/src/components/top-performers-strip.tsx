/**
 * "Top performers" strip for the home page header.
 *
 * Server component. Pulls the active-agent registry, fetches each
 * agent's 30d P&L in parallel, sorts by `return30dBps` desc, and
 * renders the top 3 as compact cards with a sparkline + return %.
 *
 * Failure mode: any agent with a missing return is dropped from the
 * sort. If fewer than 3 agents have returns, we render whatever we
 * have. If zero, the strip renders nothing — keeps the home feed
 * clean rather than showing a broken empty state.
 *
 * Why server-side: spec says no client API calls. Renders fully SSR
 * with `cache: "no-store"`, then handed off to the client `<HomeFeed>`
 * below.
 */
import Link from "next/link";
import {
  fetchRegisteredAgents,
  type RegisteredAgent,
} from "@/lib/registry";
import {
  fetchAgentPnl,
  fmtReturnBps,
  microsToUsd,
  type PnlResponse,
} from "@/lib/pnl";
import { AgentPnlSparkline } from "@/components/agent-pnl-sparkline";
import { SnsVerifiedBadge } from "@/components/sns-verified-badge";

interface Ranked {
  agent: RegisteredAgent;
  pnl: PnlResponse;
  return30dBps: number;
  series: number[];
}

export async function TopPerformersStrip() {
  const agents = await fetchRegisteredAgents({ cache: "no-store" });
  if (agents.length === 0) return null;

  // Parallel-fetch each agent's 7d window — small enough series for
  // the sparkline, and the 30d return is in `stats` regardless of the
  // requested range so the 7d snapshots double-duty here.
  const pnls = await Promise.all(
    agents.map((a) => fetchAgentPnl(a.sns, "7d")),
  );

  const ranked: Ranked[] = agents
    .map((agent, i) => {
      const pnl = pnls[i];
      const r30 = pnl.stats.return30dBps;
      if (r30 == null) return null;
      const series = pnl.snapshots
        .map((s) => microsToUsd(s.navLamports))
        .filter((v): v is number => v != null);
      return { agent, pnl, return30dBps: r30, series };
    })
    .filter((x): x is Ranked => x != null)
    .sort((a, b) => b.return30dBps - a.return30dBps)
    .slice(0, 3);

  if (ranked.length === 0) return null;

  return (
    <div
      style={{
        padding: "14px 16px",
        borderBottom: "1px solid var(--line-1)",
      }}
    >
      <div className="bd-eyebrow" style={{ marginBottom: 10 }}>
        Top performers · 30d
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0,1fr))",
          gap: 8,
        }}
      >
        {ranked.map(({ agent, return30dBps, series }, i) => (
          <Link
            key={agent.vault_pda}
            href={`/agent/${agent.sns}`}
            className="card"
            style={{
              padding: "10px 10px 8px",
              textDecoration: "none",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
              }}
            >
              <span
                className="dim mono-tiny"
                style={{ fontSize: 9, flexShrink: 0 }}
              >
                #{i + 1}
              </span>
              <span
                className="mono"
                style={{
                  color: "var(--gold)",
                  fontSize: 11,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {agent.sns.split(".")[0]}
              </span>
              <SnsVerifiedBadge verified={agent.sns_verified} size={10} />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 6,
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color:
                    return30dBps >= 0 ? "var(--pos)" : "var(--red-2)",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.1,
                }}
              >
                {fmtReturnBps(return30dBps)}
              </span>
              <AgentPnlSparkline
                series={series}
                width={60}
                height={20}
                tone={return30dBps >= 0 ? "pos" : "neg"}
              />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
