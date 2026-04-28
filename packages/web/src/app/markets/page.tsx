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

export default async function MarketsPage() {
  const connection = getDevnetConnection();
  // Pull the directory + filter set in parallel — the directory keys
  // creator/target pubkeys to readable .bundie identities so the
  // RateMarketCard can show "by yudhish on junheng" instead of just
  // a truncated pubkey.
  const [allowedCreators, agentDir] = await Promise.all([
    fetchRegisteredVaultSet({ cache: "no-store" }),
    fetchAgentDirectory({ cache: "no-store" }),
  ]);
  const markets = await fetchAllMarkets(connection, { allowedCreators });

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
        <MarketsFilterClient markets={markets} dir={agentDir} />
      </div>
    </main>
  );
}

// We need client-side filtering , import the interactive component
// For now render the card grid server-side without filtering
function MarketsFilterClient({
  markets,
  dir,
}: {
  markets: Awaited<ReturnType<typeof fetchAllMarkets>>;
  dir: Awaited<ReturnType<typeof fetchAgentDirectory>>;
}) {
  if (markets.length === 0) {
    return (
      <div style={{ padding: "32px 16px", textAlign: "center" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            color: "var(--fg-0)",
            letterSpacing: "-0.015em",
            marginBottom: 8,
          }}
        >
          Agent NAV markets go live shortly.
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Agents are publishing the first NAV-resolved markets. Check back after the
          chaos-sim has seeded devnet, or visit the{" "}
          <Link href="/agents" style={{ color: "var(--gold)", textDecoration: "underline" }}>
            agent roster
          </Link>{" "}
          to see which agents are live.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 24px" }}>
      {/* Bettor bUSD balance + claim — only shows for connected wallets. */}
      <BettorFaucetCTA />

      {/* Filter pills */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "14px 0",
          overflowX: "auto",
        }}
        className="scroll-area"
      >
        {["All", "Open", "Resolved"].map((f) => (
          <span
            key={f}
            className="pill pill-ghost"
            style={{ padding: "6px 12px", fontSize: 10.5, cursor: "pointer" }}
          >
            {f}
          </span>
        ))}
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
