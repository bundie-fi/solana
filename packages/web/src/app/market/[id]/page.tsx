import Link from "next/link";
import { notFound } from "next/navigation";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchMarketByAddress, fetchMarketsByCreator } from "@/lib/markets";
import {
  resolveSns,
  truncatePubkey,
  HERO_AGENTS,
} from "@/lib/sns-resolver";
import { MarketBuyPanel } from "@/components/market-buy-panel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const connection = getDevnetConnection();
  const market = await fetchMarketByAddress(connection, params.id);

  if (!market) notFound();

  const creatorSns = resolveSns(market.createdBy);
  const creatorLabel =
    creatorSns?.devnetName ?? truncatePubkey(market.createdBy);
  const creatorEmoji =
    HERO_AGENTS.find((a) => a.vault === market.createdBy)?.emoji ?? "🤖";

  const targetSns = market.targetAgent ? resolveSns(market.targetAgent) : null;
  const targetLabel = market.targetAgent
    ? (targetSns?.devnetName ?? truncatePubkey(market.targetAgent))
    : null;
  const targetEmoji = market.targetAgent
    ? (HERO_AGENTS.find((a) => a.vault === market.targetAgent)?.emoji ?? "🤖")
    : null;

  const totalShares = market.yesShares + market.noShares;
  const yesProbability =
    totalShares > 0 ? market.yesShares / totalShares : 0.5;
  const yesPct = Math.round(yesProbability * 100);
  const noPct = 100 - yesPct;
  const yesPrice = yesProbability;
  const noPrice = 1 - yesProbability;

  const allByCreator = await fetchMarketsByCreator(
    connection,
    market.createdBy,
  );
  const creatorResolved = allByCreator.filter(
    (m) => m.status === "resolved",
  );
  const creatorAccuracy =
    creatorResolved.length === 0
      ? null
      : creatorResolved.filter((m) => m.outcome === "no").length /
        creatorResolved.length;

  const resolutionProse: string =
    market.question || "Resolves via program-native NAV reads.";

  const totalVolumeUsdc = (market.totalVolume / 1e6).toFixed(2);

  return (
    <main style={{ background: "var(--bg-0)", minHeight: "100vh" }}>
      {/* Mobile header with back button */}
      <div className="sm:hidden top-header" style={{ paddingLeft: 8 }}>
        <Link
          href="/markets"
          className="btn btn-ghost"
          style={{ padding: "7px 10px", fontSize: 11, gap: 6, textDecoration: "none" }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>‹</span> Markets
        </Link>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="pulse-dot" />
          <span className="mono-tiny" style={{ color: "var(--green-2)" }}>LIVE</span>
        </span>
      </div>

      {/* Desktop back link */}
      <div className="hidden sm:block" style={{ padding: "12px 20px 0" }}>
        <Link
          href="/markets"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            color: "var(--purple)",
            textDecoration: "none",
          }}
        >
          ← All markets
        </Link>
      </div>

      <div className="scroll-area" style={{ overflowY: "auto" }}>
        {/* Question section */}
        <div style={{ padding: "18px 16px 14px" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <span className="pill pill-gold">Agent market</span>
            <span
              className={`pill ${market.status === "active" ? "pill-green" : "pill-muted"}`}
              style={{ fontSize: 9 }}
            >
              {market.status}
              {market.outcome ? ` · ${market.outcome.toUpperCase()}` : ""}
            </span>
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
              color: "var(--fg-0)",
              margin: 0,
            }}
          >
            {market.question || "—"}
          </h1>
        </div>

        {/* Creator / Target row */}
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div
              className="card hairline"
              style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "var(--bg-3)",
                  border: "1px solid var(--line-2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                {creatorEmoji}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <span className="bd-eyebrow" style={{ fontSize: 8.5 }}>Created by</span>
                <span className="mono gold" style={{ fontSize: 11 }}>{creatorLabel}</span>
              </div>
            </div>
            {targetLabel && (
              <div
                className="card hairline"
                style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "var(--bg-3)",
                    border: "1px solid var(--line-2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  {targetEmoji}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  <span className="bd-eyebrow" style={{ fontSize: 8.5 }}>About</span>
                  <span className="mono purple" style={{ fontSize: 11 }}>{targetLabel}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Probability gauge */}
        <div style={{ padding: "0 16px 18px" }}>
          <ProbabilityGauge
            yesPct={yesPct}
            noPct={noPct}
            yesPrice={yesPrice}
            noPrice={noPrice}
            volume={totalVolumeUsdc}
            windowEndSlot={market.windowEndSlot}
          />
        </div>

        {/* Resolution method */}
        <div style={{ padding: "0 16px 18px" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span className="pill pill-green" style={{ fontSize: 9 }}>
              <span style={{ fontSize: 11, lineHeight: 1 }}>✓</span> {resolutionProse.slice(0, 40)}…
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span className="green" style={{ fontSize: 11 }}>✓</span>
            <span className="muted" style={{ lineHeight: 1.4 }}>
              Creator cannot bet on own vault — enforced on-chain
            </span>
          </div>
        </div>

        {/* Bet panel */}
        <div style={{ padding: "0 16px 18px" }}>
          <MarketBuyPanel market={market} yesProbability={yesProbability} />
        </div>

        {/* Resolution data */}
        <div style={{ padding: "0 16px 18px" }}>
          <div className="bd-eyebrow" style={{ marginBottom: 10 }}>Resolution data</div>
          <div className="card inset" style={{ padding: 14 }}>
            <DataRow label="Resolution slot" value={market.resolutionSlot.toLocaleString()} />
            {market.windowEndSlot != null && (
              <DataRow label="Window end" value={market.windowEndSlot.toLocaleString()} />
            )}
            <DataRow label="Fee" value={`${(market.feeBps / 100).toFixed(2)}%`} />
            <DataRow label="Volume" value={`${totalVolumeUsdc} USDC`} />
            <DataRow
              label="Market PDA"
              value={
                <a
                  href={`https://orbmarkets.io/address/${market.address}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--gold)", textDecoration: "underline", fontFamily: "var(--font-mono)", fontSize: 10, wordBreak: "break-all" }}
                >
                  {market.address.slice(0, 12)}…{market.address.slice(-8)}
                </a>
              }
              last
            />
          </div>
        </div>

        {/* Footer breadcrumb */}
        <div style={{ padding: "0 16px 32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="pill pill-blue" style={{ padding: "2px 7px", fontSize: 9 }}>devnet</span>
            <span className="dim mono-tiny">·</span>
            <span className="dim mono-tiny" style={{ fontSize: 9 }}>
              market {market.address.slice(0, 6)}…
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}

function ProbabilityGauge({
  yesPct,
  noPct,
  yesPrice,
  noPrice,
  volume,
  windowEndSlot,
}: {
  yesPct: number;
  noPct: number;
  yesPrice: number;
  noPrice: number;
  volume: string;
  windowEndSlot?: number | null;
}) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 14,
          alignItems: "baseline",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="bd-eyebrow" style={{ fontSize: 9 }}>YES</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 600, color: "var(--green-2)" }}>
            {yesPct}<span style={{ fontSize: 14, fontWeight: 400 }}>%</span>
          </span>
          <span className="mono-tiny dim">◎ {yesPrice.toFixed(2)} / share</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
          <span className="bd-eyebrow" style={{ fontSize: 9 }}>NO</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 600, color: "var(--red-2)" }}>
            {noPct}<span style={{ fontSize: 14, fontWeight: 400 }}>%</span>
          </span>
          <span className="mono-tiny dim">◎ {noPrice.toFixed(2)} / share</span>
        </div>
      </div>

      {/* Inline prob bar */}
      <div className="probbar" style={{ height: 10 }}>
        <div className="yes" style={{ width: `${yesPct}%` }} />
        <div className="hairline" />
        <div className="no" style={{ width: `${noPct}%` }} />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 14,
          fontSize: 11.5,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <span className="muted mono-tiny">Volume</span>
          <span className="hl mono" style={{ fontSize: 11 }}>{volume} USDC</span>
        </div>
        {windowEndSlot != null && (
          <div style={{ display: "flex", gap: 8 }}>
            <span className="muted mono-tiny">Window end</span>
            <span className="hl mono" style={{ fontSize: 11 }}>
              slot {windowEndSlot.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function DataRow({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "7px 0",
        borderBottom: last ? "none" : "1px solid var(--line-1)",
      }}
    >
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
      <span className="mono hl" style={{ fontSize: 12, fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>
        {value}
      </span>
    </div>
  );
}
