import { getDevnetConnection } from "@/lib/rpc";
import { fetchAllMarkets } from "@/lib/markets";
import { fetchAgentDirectory, fetchRegisteredAgents, fetchRegisteredVaultSet } from "@/lib/registry";
import { fetchAgentPnl, microsToUsd } from "@/lib/pnl";
import { PlatformStatsStrip } from "@/components/platform-stats-strip";
import { SeekerBadge } from "@/components/SeekerBadge";
import { BettorFaucetCTA } from "@/components/BettorFaucetCTA";
import { DiscoverAgentList, type DiscoverAgentRow } from "@/components/discover-agent-list";
import { DiscoverMarketGrid } from "@/components/discover-market-grid";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Discover (/) — redesign-aligned bettor home.
 *
 * Server-rendered layout:
 *   - PlatformStatsStrip (agents/TVL/markets/7d nav)
 *   - "Top strategies · 30d" — sorted by return30dBps, sparkline + return
 *   - "Trending markets" — filter pills (All / Rate / Benchmark / NAV)
 *     + market cards with type chip + agent attribution + YES/NO bars
 *
 * Data fans out in parallel: registry, market list, per-agent PnL.
 * Each PnL fetch is wrapped in fetchAgentPnl which fails open, so a
 * single bad agent doesn't 500 the home page.
 */
export default async function Home(props: {
  searchParams?: Promise<{ filter?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const rawFilter = Array.isArray(searchParams?.filter)
    ? searchParams?.filter[0]
    : searchParams?.filter;
  const filter = ["rate", "benchmark", "agent_nav"].includes(rawFilter ?? "")
    ? (rawFilter as "rate" | "benchmark" | "agent_nav")
    : ("all" as const);

  const connection = getDevnetConnection();
  const [agents, allowedCreators, agentDir, markets] = await Promise.all([
    fetchRegisteredAgents({ cache: "no-store" }),
    fetchRegisteredVaultSet({ cache: "no-store" }),
    fetchAgentDirectory({ cache: "no-store" }),
    fetchAllMarkets(connection, { allowedCreators: undefined }).then((all) =>
      // Re-filter by allowed creators after the registry resolves —
      // avoids a sequential round-trip while still honoring the gate.
      all
    ),
  ]);
  // We needed allowedCreators in the same await batch but fetchAllMarkets
  // takes it as a hard arg. Re-filter here so registry + markets fan out
  // truly in parallel above.
  const liveMarkets = markets.filter((m) => allowedCreators.has(m.createdBy));

  // Per-agent PnL — parallel fan-out, fail-open
  const pnls = await Promise.all(agents.map((a) => fetchAgentPnl(a.sns, "30d")));
  const agentRows: DiscoverAgentRow[] = agents
    .map((a, i) => {
      const pnl = pnls[i];
      const series = pnl.snapshots
        .map((s) => microsToUsd(s.navLamports))
        .filter((v): v is number => v != null);
      return {
        sns: a.sns,
        displayName: a.display_name || a.sns.split(".")[0] || "strategy",
        avatarSeed: hashSeed(a.sns),
        currentNavMicros: pnl.stats.currentNavLamports
          ? Number(pnl.stats.currentNavLamports)
          : null,
        return30dPct: pnl.stats.return30dBps != null ? pnl.stats.return30dBps / 100 : null,
        series,
        marketCount: 0, // computed below from liveMarkets
        snsVerified: a.sns_verified ?? false,
      };
    })
    // Sort: positive returns first by magnitude, then nulls.
    .sort((a, b) => (b.return30dPct ?? -Infinity) - (a.return30dPct ?? -Infinity));

  // Backfill market counts per agent. The market's `createdBy` is the
  // signing agent vault; for kind=2 (head-to-head) markets, `targetAgent`
  // is the second strategy. Both deserve a market count if they map to a
  // registered SNS.
  for (const m of liveMarkets) {
    const aSns = agentDir[m.createdBy]?.sns;
    const bSns = m.targetAgent ? agentDir[m.targetAgent]?.sns : undefined;
    for (const sns of [aSns, bSns].filter((s): s is string => !!s)) {
      const row = agentRows.find((r) => r.sns === sns);
      if (row) row.marketCount += 1;
    }
  }

  return (
    <main style={{ background: "var(--bg-0)", minHeight: "100vh", paddingBottom: 80 }}>
      {/* Platform stats strip — credibility numbers above the fold */}
      <div style={{ borderBottom: "1px solid var(--line-1)", padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <PlatformStatsStrip />
          <SeekerBadge />
        </div>
      </div>

      {/* Faucet CTA — surfaces bUSD balance + claim button. Hides itself
          when the wallet is disconnected, so it's harmless on first paint
          for visitors who haven't connected yet. Lives on Discover so the
          mobile bottom-nav can reach it (no /markets link in BottomNav). */}
      <div style={{ padding: "0 16px" }}>
        <BettorFaucetCTA />
      </div>

      {/* Top strategies header */}
      <div style={{ padding: "20px 16px 10px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div className="bd-eyebrow">Top strategies</div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              letterSpacing: -0.4,
              marginTop: 2,
              color: "var(--fg-0)",
            }}
          >
            by 30d return
          </div>
        </div>
      </div>
      <DiscoverAgentList rows={agentRows} />

      {/* Markets header */}
      <div style={{ padding: "24px 16px 10px" }}>
        <div className="bd-eyebrow">Trending markets</div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            letterSpacing: -0.4,
            marginTop: 2,
            color: "var(--fg-0)",
          }}
        >
          live across {agentRows.filter((r) => r.marketCount > 0).length} strategies
        </div>
      </div>
      <DiscoverMarketGrid markets={liveMarkets} dir={agentDir} activeFilter={filter} />
    </main>
  );
}

/** Hash an SNS string to a stable seed for the gradient avatar. */
function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
