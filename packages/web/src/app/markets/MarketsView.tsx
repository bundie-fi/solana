import Link from "next/link";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchAllMarkets } from "@/lib/markets";
import {
  fetchAgentDirectory,
  fetchRegisteredVaultSet,
} from "@/lib/registry";
import { RateMarketCard } from "@/components/rate-market-card";
import { BettorFaucetCTA } from "@/components/BettorFaucetCTA";
import { PlatformStatsStrip } from "@/components/platform-stats-strip";
import { SeekerBadge } from "@/components/SeekerBadge";

export type FilterStatus = "all" | "open" | "resolved";

export function parseStatus(raw: string | string[] | undefined): FilterStatus {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "open" || v === "resolved") return v;
  return "all";
}

/**
 * Markets surface — rendered by both `/` (the new default landing) and
 * `/markets` (kept as an explicit alias for nav clarity). Lists every
 * NAV-resolved prediction market in reverse-chronological order with a
 * status-filter pill row. The `basePath` prop controls where the filter
 * pills link to so `/?status=open` and `/markets?status=open` both work
 * without sharing state across surfaces.
 */
export async function MarketsView({
  status,
  basePath,
}: {
  status: FilterStatus;
  basePath: "/" | "/markets";
}) {
  const connection = getDevnetConnection();
  const [allowedCreators, agentDir] = await Promise.all([
    fetchRegisteredVaultSet({ cache: "no-store" }),
    fetchAgentDirectory({ cache: "no-store" }),
  ]);
  const allMarkets = await fetchAllMarkets(connection, { allowedCreators });
  const markets =
    status === "open"
      ? allMarkets.filter((m) => m.status === "active")
      : status === "resolved"
        ? allMarkets.filter((m) => m.status === "resolved")
        : allMarkets;

  const totalVolumeBusd = markets.reduce((s, m) => s + m.totalVolume / 1e6, 0);

  // Filter pill hrefs depend on which surface we're rendered on so the
  // active-pill Link doesn't bounce the user across `/` vs `/markets`.
  const baseQuery = basePath === "/" ? "/" : "/markets";
  const filterLinks = [
    { id: "all" as const, label: "All", href: baseQuery },
    { id: "open" as const, label: "Open", href: `${baseQuery}?status=open` },
    { id: "resolved" as const, label: "Resolved", href: `${baseQuery}?status=resolved` },
  ];

  return (
    <main style={{ background: "var(--de-bg)", minHeight: "100vh" }}>
      {/* Mobile-style header strip (visible on all sizes when no desktop TopNav) */}
      <div className="sm:hidden top-header" style={{}}>
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
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="pulse-dot" />
          <span className="mono-tiny" style={{ color: "var(--de-mint)", letterSpacing: "0.16em", fontSize: 10 }}>
            LIVE
          </span>
        </span>
      </div>

      <div className="scroll-area" style={{ overflowY: "auto" }}>
        {/* Platform stats strip — credibility numbers above the fold so a
            first-time visitor sees scale + activity before the market list. */}
        <div style={{ borderBottom: "1px solid var(--de-line)", padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <PlatformStatsStrip />
            <SeekerBadge />
          </div>
        </div>

        {/* Hero section — "what is this surface" in one line */}
        <div style={{ padding: "20px 16px 14px", borderBottom: "1px solid var(--de-line)" }}>
          <div className="bd-eyebrow" style={{ marginBottom: 10 }}>
            {markets.length} markets · ◎ {totalVolumeBusd.toFixed(1)} bUSD volume
          </div>
          <div className="section-title">
            Bet on which yield strategy <em>wins.</em>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
            Each market resolves from on-chain NAV — no oracle, no committee.
            Live DeFi strategies trade real Solana protocols; you predict
            which ones outperform.
          </div>
        </div>

        {/* Filter pills + cards */}
        <MarketsList
          markets={markets}
          dir={agentDir}
          activeStatus={status}
          filterLinks={filterLinks}
        />
      </div>
    </main>
  );
}

function MarketsList({
  markets,
  dir,
  activeStatus,
  filterLinks,
}: {
  markets: Awaited<ReturnType<typeof fetchAllMarkets>>;
  dir: Awaited<ReturnType<typeof fetchAgentDirectory>>;
  activeStatus: FilterStatus;
  filterLinks: { id: FilterStatus; label: string; href: string }[];
}) {
  if (markets.length === 0) {
    const headline =
      activeStatus === "resolved"
        ? "No resolved markets yet."
        : activeStatus === "open"
          ? "No active markets right now."
          : "Strategy NAV markets go live shortly.";
    const sub =
      activeStatus === "resolved"
        ? "Markets resolve automatically when their slot is reached. Once a strategy's window closes, the keeper will set the outcome and it'll appear here."
        : activeStatus === "open"
          ? "All current markets are resolved. Try the All or Resolved tab."
          : "Strategies are publishing the first NAV-resolved markets. Check back shortly.";
    return (
      <div style={{ padding: "0 16px 24px" }}>
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "14px 0",
            overflowX: "auto",
          }}
          className="scroll-area"
        >
          {filterLinks.map((f) => {
            const isActive = activeStatus === f.id;
            return (
              <Link
                key={f.id}
                href={f.href}
                className={`pill ${isActive ? "pill-gold" : "pill-ghost"}`}
                style={{
                  padding: "6px 12px",
                  fontSize: 10.5,
                  cursor: "pointer",
                  textDecoration: "none",
                }}
              >
                {f.label}
              </Link>
            );
          })}
        </div>

        <div style={{ padding: "32px 0", textAlign: "center" }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              color: "var(--de-ink)",
              letterSpacing: "-0.015em",
              marginBottom: 8,
            }}
          >
            {headline}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {sub}{" "}
            <Link href="/agents" style={{ color: "var(--de-lavender)", textDecoration: "underline" }}>
              See live strategies →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 24px" }}>
      <BettorFaucetCTA />

      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "14px 0",
          overflowX: "auto",
        }}
        className="scroll-area"
      >
        {filterLinks.map((f) => {
          const isActive = activeStatus === f.id;
          return (
            <Link
              key={f.id}
              href={f.href}
              className={`pill ${isActive ? "pill-gold" : "pill-ghost"}`}
              style={{
                padding: "6px 12px",
                fontSize: 10.5,
                cursor: "pointer",
                textDecoration: "none",
              }}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="card-stack">
        {markets.map((m) => (
          <RateMarketCard key={m.address} market={m} dir={dir} />
        ))}
      </div>
    </div>
  );
}
