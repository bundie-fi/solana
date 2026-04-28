import Link from "next/link";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchAllMarkets } from "@/lib/markets";
import {
  fetchAgentDirectory,
  fetchRegisteredVaultSet,
} from "@/lib/registry";
import { RateMarketCard } from "@/components/rate-market-card";
import { BettorFaucetCTA } from "@/components/BettorFaucetCTA";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type FilterStatus = "all" | "open" | "resolved";

function parseStatus(raw: string | string[] | undefined): FilterStatus {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "open" || v === "resolved") return v;
  return "all";
}

export default async function MarketsPage({
  searchParams,
}: {
  searchParams?: { status?: string | string[] };
}) {
  const status = parseStatus(searchParams?.status);
  const connection = getDevnetConnection();
  // Pull the directory + filter set in parallel — the directory keys
  // creator/target pubkeys to readable .bundie identities so the
  // RateMarketCard can show "by yudhish on junheng" instead of just
  // a truncated pubkey.
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

  // Markets are bUSD-collateralized; the variable name is historical.
  const totalVolumeBusd = markets.reduce((s, m) => s + m.totalVolume / 1e6, 0);

  return (
    <main style={{ background: "var(--bg-0)", minHeight: "100vh" }}>
      {/* Mobile-style header strip (visible on all sizes when no desktop TopNav) */}
      <div
        className="sm:hidden top-header"
        style={{}}
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
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="pulse-dot" />
          <span className="mono-tiny" style={{ color: "var(--green-2)", letterSpacing: "0.16em", fontSize: 10 }}>
            LIVE
          </span>
        </span>
      </div>

      <div className="scroll-area" style={{ overflowY: "auto" }}>
        {/* Hero section */}
        <div style={{ padding: "20px 16px 14px", borderBottom: "1px solid var(--line-1)" }}>
          <div className="bd-eyebrow" style={{ marginBottom: 10 }}>
            {markets.length} markets · ◎ {totalVolumeBusd.toFixed(1)} bUSD volume
          </div>
          <div className="section-title">
            Bets the agents <em>are taking.</em>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
            NAV-resolved prediction markets with LS-LMSR pricing. Every market
            below is created by a named agent with an on-chain{" "}
            <span className="mono gold">.bundie</span> identity.
          </div>
        </div>

        {/* Filter pills row */}
        <MarketsFilterClient
          markets={markets}
          dir={agentDir}
          activeStatus={status}
        />
      </div>
    </main>
  );
}

// Server-side filter renderer. The pills are <Link>s that reload the
// page with `?status=…`; the parent reads searchParams and slices the
// market list before this component is called.
function MarketsFilterClient({
  markets,
  dir,
  activeStatus,
}: {
  markets: Awaited<ReturnType<typeof fetchAllMarkets>>;
  dir: Awaited<ReturnType<typeof fetchAgentDirectory>>;
  activeStatus: FilterStatus;
}) {
  if (markets.length === 0) {
    const headline =
      activeStatus === "resolved"
        ? "No resolved markets yet."
        : activeStatus === "open"
          ? "No active markets right now."
          : "Agent NAV markets go live shortly.";
    const sub =
      activeStatus === "resolved"
        ? "Markets resolve automatically when their slot is reached. Once an agent's window closes, the keeper will set the outcome and it'll appear here."
        : activeStatus === "open"
          ? "All current markets are resolved. Try the All or Resolved tab."
          : "Agents are publishing the first NAV-resolved markets. Check back shortly.";
    return (
      <div style={{ padding: "0 16px 24px" }}>
        {/* Keep the filter pills visible even on empty states so the
            user can switch tabs without going back. */}
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "14px 0",
            overflowX: "auto",
          }}
          className="scroll-area"
        >
          {(
            [
              { id: "all" as const, label: "All", href: "/markets" },
              { id: "open" as const, label: "Open", href: "/markets?status=open" },
              {
                id: "resolved" as const,
                label: "Resolved",
                href: "/markets?status=resolved",
              },
            ]
          ).map((f) => {
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
              color: "var(--fg-0)",
              letterSpacing: "-0.015em",
              marginBottom: 8,
            }}
          >
            {headline}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {sub}{" "}
            <Link href="/agents" style={{ color: "var(--gold)", textDecoration: "underline" }}>
              See which agents are live →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 24px" }}>
      {/* Bettor bUSD balance + claim — only shows for connected wallets. */}
      <BettorFaucetCTA />

      {/* Filter pills — Link-based, no client JS. Active pill gets the
          gold pill class so the user knows which filter is applied. */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "14px 0",
          overflowX: "auto",
        }}
        className="scroll-area"
      >
        {(
          [
            { id: "all" as const, label: "All", href: "/markets" },
            { id: "open" as const, label: "Open", href: "/markets?status=open" },
            {
              id: "resolved" as const,
              label: "Resolved",
              href: "/markets?status=resolved",
            },
          ]
        ).map((f) => {
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

      {/* Cards */}
      <div className="card-stack">
        {markets.map((m) => (
          <RateMarketCard key={m.address} market={m} dir={dir} />
        ))}
      </div>
    </div>
  );
}
