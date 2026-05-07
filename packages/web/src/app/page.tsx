import Link from "next/link";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchAllMarkets, type MarketView } from "@/lib/markets";
import {
  fetchAgentDirectory,
  fetchRegisteredAgents,
  fetchRegisteredVaultSet,
} from "@/lib/registry";
import { fetchAgentPnl, microsToUsd } from "@/lib/pnl";
import {
  AgentCardCompact,
  ConvictionBar,
  DeMarketCard,
  DeSparkline,
  StatusPill,
  hashSeed,
} from "@/components/de";
import { TrendingFilters, type TrendingFilterId } from "@/components/de/TrendingFilters";
import { BettorFaucetCTA } from "@/components/BettorFaucetCTA";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Discover (/) — dark editorial home, redesigned per the XO-Market-inspired
 * IA. Replaces the warm-paper top-strategies + trending-markets stack with:
 *
 *   1. Platform stats strip (4 metric cards, monospace caps + serif numbers)
 *   2. Featured agent hero (top 30d performer, large NAV chart) +
 *      sidebar with featured market + editorial promo card
 *   3. Top strategies leaderboard (5–10 rows, sparkline + return)
 *   4. Trending markets section (filter pills + 3-col card grid)
 *   5. "List your agent" CTA strip (links /strategists)
 *
 * Data fetching mirrors the legacy page exactly — server-side parallel fan-out
 * for registry / markets / per-agent PnL, with a per-agent fail-open. The
 * platform-stats strip is fetched inline here because the dark editorial
 * layout differs from the legacy `<PlatformStatsStrip>` paper-card row.
 */
export default async function Home(props: {
  searchParams?: Promise<{ filter?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const rawFilter = Array.isArray(searchParams?.filter)
    ? searchParams?.filter[0]
    : searchParams?.filter;
  const filter: TrendingFilterId = ["rate", "benchmark", "agent_nav"].includes(
    rawFilter ?? "",
  )
    ? (rawFilter as TrendingFilterId)
    : "all";

  const connection = getDevnetConnection();
  const [agents, allowedCreators, agentDir, markets, platformStats] =
    await Promise.all([
      fetchRegisteredAgents({ cache: "no-store" }),
      fetchRegisteredVaultSet({ cache: "no-store" }),
      fetchAgentDirectory({ cache: "no-store" }),
      fetchAllMarkets(connection, { allowedCreators: undefined }),
      fetchPlatformStats(),
    ]);

  // Re-filter markets here so registry + markets fan out fully in parallel above.
  const liveMarkets = markets.filter((m) => allowedCreators.has(m.createdBy));

  // Per-agent PnL — parallel fan-out, fail-open
  const pnls = await Promise.all(
    agents.map((a) => fetchAgentPnl(a.sns, "30d")),
  );
  type AgentRow = {
    sns: string;
    displayName: string;
    avatarSeed: number;
    currentNavMicros: number | null;
    return30dPct: number | null;
    series: number[];
    marketCount: number;
    snsVerified: boolean;
  };
  const agentRows: AgentRow[] = agents
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
        return30dPct:
          pnl.stats.return30dBps != null ? pnl.stats.return30dBps / 100 : null,
        series,
        marketCount: 0,
        snsVerified: a.sns_verified ?? false,
      };
    })
    .sort((a, b) => (b.return30dPct ?? -Infinity) - (a.return30dPct ?? -Infinity));

  // Backfill market counts: both market.createdBy and (for kind=2) targetAgent.
  for (const m of liveMarkets) {
    const aSns = agentDir[m.createdBy]?.sns;
    const bSns = m.targetAgent ? agentDir[m.targetAgent]?.sns : undefined;
    for (const sns of [aSns, bSns].filter((s): s is string => !!s)) {
      const row = agentRows.find((r) => r.sns === sns);
      if (row) row.marketCount += 1;
    }
  }

  // Featured = top performer with a populated NAV series.
  const featured =
    agentRows.find((r) => r.series.length >= 2 && (r.return30dPct ?? 0) > 0) ??
    agentRows[0] ??
    null;

  // Featured market = highest-volume open market created by the featured agent
  // (fall back to the highest-volume open market overall).
  const featuredMarket: MarketView | null = (() => {
    const open = liveMarkets.filter((m) => m.status === "active");
    if (open.length === 0) return null;
    if (featured) {
      const ofFeatured = open
        .filter((m) => agentDir[m.createdBy]?.sns === featured.sns)
        .sort((a, b) => b.totalVolume - a.totalVolume);
      if (ofFeatured.length > 0) return ofFeatured[0];
    }
    return [...open].sort((a, b) => b.totalVolume - a.totalVolume)[0];
  })();

  // Trending grid = open markets matching active filter, sorted by volume.
  const trending = filterTrending(liveMarkets, filter);
  const liveAgentCount = agentRows.filter((r) => r.marketCount > 0).length;

  return (
    <main
      style={{
        background: "var(--de-bg)",
        minHeight: "100vh",
        paddingBottom: 96,
        color: "var(--de-ink)",
      }}
    >
      {/* Lavender ambient glow at the top of the page — sets the editorial tone. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 480,
          background:
            "radial-gradient(50% 35% at 20% 0%, rgba(168,153,245,0.14), transparent)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1280,
          margin: "0 auto",
          padding: "0 24px",
        }}
      >
        {/* Section 1: platform stats strip */}
        <section style={{ paddingTop: 32 }}>
          <PlatformStatsRow
            agentsActive={platformStats.agentsActive}
            totalTvlLamports={platformStats.totalTvlLamports}
            marketsOpen={platformStats.marketsOpen}
            marketsResolved={platformStats.marketsResolved}
            totalNavGrowth7dBps={platformStats.totalNavGrowth7dBps}
          />
        </section>

        {/* Faucet CTA — keeps wallet bUSD claim accessible from the home page. */}
        <div style={{ marginTop: 16 }}>
          <BettorFaucetCTA />
        </div>

        {/* Section 2: featured hero + sidebar */}
        <section
          className="de-hero-grid"
          style={{
            marginTop: 32,
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 16,
          }}
        >
          {featured ? (
            <FeaturedAgentHero row={featured} />
          ) : (
            <FeaturedAgentEmpty />
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {featuredMarket ? (
              <DeMarketCard
                market={featuredMarket}
                dir={agentDir}
                size="compact"
              />
            ) : null}
            <EditorialPromoCard />
          </div>
        </section>

        {/* Section 3: leaderboard */}
        <section style={{ marginTop: 64 }}>
          <SectionHeader
            eyebrow="TOP STRATEGIES"
            title="by 30d return"
            subtitle={null}
          />
          <Leaderboard rows={agentRows} />
        </section>

        {/* Section 4: trending markets */}
        <section style={{ marginTop: 64 }}>
          <SectionHeader
            eyebrow="TRENDING MARKETS"
            title={`live across ${liveAgentCount} ${liveAgentCount === 1 ? "agent" : "agents"}`}
            subtitle={null}
          />
          <div style={{ marginTop: 16 }}>
            <TrendingFilters active={filter} />
          </div>
          {trending.length === 0 ? (
            <div
              style={{
                marginTop: 24,
                padding: "48px 16px",
                textAlign: "center",
                color: "var(--de-ink-3)",
                fontSize: 13,
                background: "var(--de-bg-raised)",
                border: "1px solid var(--de-line)",
                borderRadius: 12,
              }}
            >
              No markets in this category yet. Try All.
            </div>
          ) : (
            <div className="de-market-grid" style={{ marginTop: 20 }}>
              {trending.map((m) => (
                <DeMarketCard key={m.address} market={m} dir={agentDir} />
              ))}
            </div>
          )}
        </section>

        {/* Section 5: list-your-agent CTA */}
        <section
          style={{
            marginTop: 80,
            padding: "24px 28px",
            border: "1px solid var(--de-line)",
            borderRadius: 12,
            background: "var(--de-bg-raised)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              color: "var(--de-ink)",
              letterSpacing: "-0.01em",
            }}
          >
            Are you running a trading agent on Solana?
          </div>
          <Link
            href="/strategists"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--de-lavender)",
              textDecoration: "none",
              letterSpacing: "0.01em",
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid rgba(168,153,245,0.42)",
              background: "var(--de-lavender-tint)",
              transition: "background 160ms ease, border-color 160ms ease",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            List your agent →
          </Link>
        </section>
      </div>

      {/* Responsive grid rules — the hero swaps to side-by-side on desktop;
          the market grid expands from 1→2→3 columns at the standard
          breakpoints. Keeping these inline so the page bundle ships its
          own layout rules without depending on globals.css edits. */}
      <style>{`
        @media (min-width: 1024px) {
          .de-hero-grid {
            grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr) !important;
          }
        }
        .de-market-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 768px) {
          .de-market-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (min-width: 1280px) {
          .de-market-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
      `}</style>
    </main>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.20em",
            color: "var(--de-ink-3)",
            marginBottom: 8,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontStyle: "italic",
            letterSpacing: "-0.02em",
            color: "var(--de-ink)",
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: 13,
            color: "var(--de-ink-3)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

function PlatformStatsRow({
  agentsActive,
  totalTvlLamports,
  marketsOpen,
  marketsResolved,
  totalNavGrowth7dBps,
}: {
  agentsActive: number;
  totalTvlLamports: string;
  marketsOpen: number;
  marketsResolved: number;
  totalNavGrowth7dBps: number | null;
}) {
  const growthLabel =
    totalNavGrowth7dBps == null
      ? "—"
      : fmtSignedPct(totalNavGrowth7dBps / 100);
  const growthTone: "pos" | "neg" | "neutral" =
    totalNavGrowth7dBps == null
      ? "neutral"
      : totalNavGrowth7dBps >= 0
      ? "pos"
      : "neg";

  return (
    <div
      className="de-stats-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      <StatTile label="Live agents" value={String(agentsActive)} />
      <StatTile label="Total TVL" value={fmtTvlUsd(totalTvlLamports)} sub="bUSD" />
      <StatTile
        label="Open markets"
        value={String(marketsOpen)}
        sub={`${marketsResolved} resolved`}
      />
      <StatTile label="7d platform NAV" value={growthLabel} tone={growthTone} />
      <style>{`
        @media (min-width: 768px) {
          .de-stats-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
          }
        }
      `}</style>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg" | "neutral";
}) {
  const valueColor =
    tone === "pos"
      ? "var(--de-mint)"
      : tone === "neg"
      ? "var(--de-rose)"
      : "var(--de-ink)";
  return (
    <div
      style={{
        padding: "20px 22px",
        background: "var(--de-bg-raised)",
        border: "1px solid var(--de-line)",
        borderRadius: 12,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          color: "var(--de-ink-3)",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 32,
            color: valueColor,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.05,
          }}
        >
          {value}
        </span>
        {sub && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--de-ink-3)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

function FeaturedAgentHero({
  row,
}: {
  row: {
    sns: string;
    displayName: string;
    avatarSeed: number;
    currentNavMicros: number | null;
    return30dPct: number | null;
    series: number[];
    marketCount: number;
    snsVerified: boolean;
  };
}) {
  const tvl = row.currentNavMicros ? row.currentNavMicros / 1_000_000 : null;
  const tone: "pos" | "neg" | "neutral" =
    row.return30dPct == null
      ? "neutral"
      : row.return30dPct >= 0
      ? "pos"
      : "neg";

  return (
    <Link
      href={`/agent/${encodeURIComponent(row.sns)}`}
      className="de-hero"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: 32,
        background: "var(--de-bg-raised)",
        border: "1px solid var(--de-line-2)",
        borderRadius: 16,
        textDecoration: "none",
        color: "var(--de-ink)",
        overflow: "hidden",
        minHeight: 480,
        transition: "border-color 200ms ease, transform 200ms ease",
      }}
    >
      {/* Soft gradient backdrop tied to the agent identity. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(80% 50% at 0% 0%, rgba(168,153,245,0.10), transparent), radial-gradient(40% 40% at 100% 100%, rgba(168,230,207,0.06), transparent)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <StatusPill variant="LIVE">LIVE</StatusPill>
        <StatusPill variant="DEVNET">DEVNET</StatusPill>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--de-ink-3)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          NAV {row.series.length} ticks
        </span>
      </div>

      <div style={{ position: "relative" }}>
        <AgentCardCompact
          sns={row.sns}
          displayName={row.displayName}
          avatarSeed={row.avatarSeed}
          snsVerified={row.snsVerified}
          mode="row"
          avatarSize={48}
        />
      </div>

      {/* Large NAV chart — the hero visual. */}
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 160,
          display: "flex",
          alignItems: "center",
        }}
      >
        <DeSparkline
          series={row.series}
          variant="large"
          width={undefined}
          height={180}
          showFill
          tone={tone}
          style={{ width: "100%", height: 180 }}
        />
      </div>

      <div style={{ position: "relative" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 36,
            letterSpacing: "-0.025em",
            color: "var(--de-ink)",
            lineHeight: 1.05,
          }}
        >
          {row.displayName}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 14,
            color: "var(--de-ink-2)",
            maxWidth: 520,
            lineHeight: 1.5,
          }}
        >
          The top-performing strategy on the platform over the last 30 days.
          NAV updates on every commit. Markets self-resolve from the chart you
          see above.
        </div>
      </div>

      {/* Metadata pills row */}
      <div
        style={{
          position: "relative",
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <HeroPill label="30D RETURN" value={fmtSignedPct(row.return30dPct)} tone={tone} />
        <HeroPill label="TVL" value={tvl != null ? fmtUsd(tvl) : "—"} />
        <HeroPill label="OPEN MARKETS" value={String(row.marketCount)} />
        <HeroPill label="NAV TICKS" value={String(row.series.length)} />
      </div>

      <div style={{ position: "relative", display: "flex" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 18px",
            borderRadius: 8,
            background: "var(--de-lavender-tint)",
            border: "1px solid rgba(168,153,245,0.42)",
            color: "var(--de-lavender)",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          View agent →
        </span>
      </div>

      <style>{`
        .de-hero:hover {
          border-color: rgba(168,153,245,0.42);
          transform: translateY(-1px);
        }
      `}</style>
    </Link>
  );
}

function FeaturedAgentEmpty() {
  return (
    <div
      style={{
        padding: 32,
        background: "var(--de-bg-raised)",
        border: "1px solid var(--de-line-2)",
        borderRadius: 16,
        minHeight: 360,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--de-ink-3)",
        fontSize: 14,
        textAlign: "center",
      }}
    >
      Live strategies will appear here once agents begin trading on devnet.
    </div>
  );
}

function HeroPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "neutral";
}) {
  const valueColor =
    tone === "pos"
      ? "var(--de-mint)"
      : tone === "neg"
      ? "var(--de-rose)"
      : "var(--de-ink)";
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          color: "var(--de-ink-3)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.015em",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function EditorialPromoCard() {
  return (
    <div
      style={{
        padding: 24,
        background: "var(--de-bg-raised)",
        border: "1px solid var(--de-line)",
        borderRadius: 12,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(60% 60% at 100% 0%, rgba(168,153,245,0.10), transparent)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "relative",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.20em",
          color: "var(--de-ink-3)",
          marginBottom: 12,
        }}
      >
        How it works
      </div>
      <div
        style={{
          position: "relative",
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 18,
          lineHeight: 1.4,
          letterSpacing: "-0.01em",
          color: "var(--de-ink)",
          marginBottom: 14,
        }}
      >
        Markets read the NAV chart, not an oracle.
      </div>
      <div
        style={{
          position: "relative",
          fontSize: 13,
          color: "var(--de-ink-2)",
          lineHeight: 1.5,
        }}
      >
        Every Bundie market settles by reading the strategy&apos;s on-chain NAV
        snapshot at resolution slot. No external oracle, no manual operator.
        The chart you see decides the outcome.
      </div>
    </div>
  );
}

function Leaderboard({
  rows,
}: {
  rows: {
    sns: string;
    displayName: string;
    avatarSeed: number;
    currentNavMicros: number | null;
    return30dPct: number | null;
    series: number[];
    marketCount: number;
    snsVerified: boolean;
  }[];
}) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          marginTop: 24,
          padding: "32px 16px",
          textAlign: "center",
          color: "var(--de-ink-3)",
          fontSize: 13,
          background: "var(--de-bg-raised)",
          border: "1px solid var(--de-line)",
          borderRadius: 12,
        }}
      >
        Live strategies will appear here once agents begin trading on devnet.
      </div>
    );
  }
  return (
    <div
      style={{
        marginTop: 20,
        background: "var(--de-bg-raised)",
        border: "1px solid var(--de-line)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {rows.slice(0, 10).map((r, i) => (
        <LeaderboardRow key={r.sns} row={r} index={i + 1} isLast={i === Math.min(rows.length, 10) - 1} />
      ))}
    </div>
  );
}

function LeaderboardRow({
  row,
  index,
  isLast,
}: {
  row: {
    sns: string;
    displayName: string;
    avatarSeed: number;
    currentNavMicros: number | null;
    return30dPct: number | null;
    series: number[];
    marketCount: number;
    snsVerified: boolean;
  };
  index: number;
  isLast: boolean;
}) {
  const tvl = row.currentNavMicros ? row.currentNavMicros / 1_000_000 : null;
  const tone: "pos" | "neg" | "neutral" =
    row.return30dPct == null
      ? "neutral"
      : row.return30dPct >= 0
      ? "pos"
      : "neg";
  const returnColor =
    tone === "pos"
      ? "var(--de-mint)"
      : tone === "neg"
      ? "var(--de-rose)"
      : "var(--de-ink-3)";

  return (
    <Link
      href={`/agent/${encodeURIComponent(row.sns)}`}
      className="de-leaderboard-row"
      style={{
        display: "grid",
        gridTemplateColumns: "32px minmax(0, 1.4fr) minmax(0, 1fr) 140px 80px",
        alignItems: "center",
        gap: 16,
        padding: "16px 24px",
        borderBottom: isLast ? "none" : "1px solid var(--de-line)",
        textDecoration: "none",
        color: "var(--de-ink)",
        transition: "background 160ms ease",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--de-ink-4)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.06em",
        }}
      >
        {String(index).padStart(2, "0")}
      </div>
      <AgentCardCompact
        sns={row.sns}
        displayName={row.displayName}
        avatarSeed={row.avatarSeed}
        snsVerified={row.snsVerified}
        mode="row"
        avatarSize={32}
      />
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--de-ink-3)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.04em",
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span>
          <span style={{ color: "var(--de-ink-4)" }}>TVL </span>
          <span style={{ color: "var(--de-ink-2)" }}>
            {tvl != null ? fmtUsd(tvl) : "—"}
          </span>
        </span>
        <span style={{ color: "var(--de-ink-5)" }}>·</span>
        <span>
          <span style={{ color: "var(--de-ink-4)" }}>MKTS </span>
          <span style={{ color: "var(--de-ink-2)" }}>{row.marketCount}</span>
        </span>
      </div>
      <div style={{ height: 32, display: "flex", alignItems: "center" }}>
        <DeSparkline
          series={row.series}
          variant="small"
          width={140}
          height={32}
          tone={tone}
        />
      </div>
      <div
        style={{
          textAlign: "right",
          fontFamily: "var(--font-display)",
          fontSize: 18,
          fontVariantNumeric: "tabular-nums",
          color: returnColor,
          letterSpacing: "-0.01em",
        }}
      >
        {fmtSignedPct(row.return30dPct)}
      </div>
      <style>{`
        .de-leaderboard-row:hover {
          background: var(--de-bg-2);
        }
        @media (max-width: 767px) {
          .de-leaderboard-row {
            grid-template-columns: minmax(0, 1.6fr) 80px !important;
          }
          .de-leaderboard-row > :nth-child(1),
          .de-leaderboard-row > :nth-child(3),
          .de-leaderboard-row > :nth-child(4) {
            display: none !important;
          }
        }
      `}</style>
    </Link>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filterTrending(
  markets: MarketView[],
  filter: TrendingFilterId,
): MarketView[] {
  const open = markets.filter((m) => m.status === "active");
  const matchesKind = (k: number) => {
    if (filter === "all") return true;
    if (filter === "rate") return k === 3;
    if (filter === "benchmark") return k === 2;
    if (filter === "agent_nav") return k === 1;
    return true;
  };
  return open
    .filter((m) => matchesKind(m.kind))
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 9);
}

function fmtSignedPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtTvlUsd(lamports: string): string {
  try {
    const n = BigInt(lamports);
    const whole = n / 1_000_000n;
    const remainder = n % 1_000_000n;
    const usd = Number(whole) + Number(remainder) / 1_000_000;
    return fmtUsd(usd);
  } catch {
    return "—";
  }
}

// ─── Platform stats fetcher (dark editorial layout takes precedence over the
//     legacy <PlatformStatsStrip> paper-card row, so we duplicate the fetch
//     here instead of importing from the legacy component) ─────────────────

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000";

interface PlatformStats {
  agentsActive: number;
  agentsTotal: number;
  totalTvlLamports: string;
  marketsTotal: number;
  marketsOpen: number;
  marketsResolved: number;
  totalNavGrowth7dBps: number | null;
  generatedAt: string;
}

const EMPTY_PLATFORM_STATS: PlatformStats = {
  agentsActive: 0,
  agentsTotal: 0,
  totalTvlLamports: "0",
  marketsTotal: 0,
  marketsOpen: 0,
  marketsResolved: 0,
  totalNavGrowth7dBps: null,
  generatedAt: new Date().toISOString(),
};

async function fetchPlatformStats(): Promise<PlatformStats> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/stats/platform`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return EMPTY_PLATFORM_STATS;
    const body = (await res.json()) as Partial<PlatformStats>;
    return {
      agentsActive: body.agentsActive ?? 0,
      agentsTotal: body.agentsTotal ?? 0,
      totalTvlLamports: body.totalTvlLamports ?? "0",
      marketsTotal: body.marketsTotal ?? 0,
      marketsOpen: body.marketsOpen ?? 0,
      marketsResolved: body.marketsResolved ?? 0,
      totalNavGrowth7dBps: body.totalNavGrowth7dBps ?? null,
      generatedAt: body.generatedAt ?? new Date().toISOString(),
    };
  } catch {
    return EMPTY_PLATFORM_STATS;
  }
}
