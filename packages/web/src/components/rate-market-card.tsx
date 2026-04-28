"use client";

import Link from "next/link";
import type { MarketView } from "@/lib/markets";
import { resolveSns, truncatePubkey } from "@/lib/sns-resolver";
import { ProbBar } from "@/components/prob-bar";

/**
 * Market card , Seeker design with accent top strip, type pill, ProbBar,
 * YES/NO buttons. Matches MarketCard from the design handoff.
 */
export function RateMarketCard({ market }: { market: MarketView }) {
  const sns = resolveSns(market.createdBy);
  const creatorLabel = sns?.devnetName ?? truncatePubkey(market.createdBy);

  const isResolved = market.status === "resolved";

  // Probability from share ratio
  const totalShares = market.yesShares + market.noShares;
  const yesPct = totalShares > 0
    ? Math.round((market.yesShares / totalShares) * 100)
    : 50;
  const noPct = 100 - yesPct;

  const accent = "var(--gold)";
  const volumeUsdc = (market.totalVolume / 1e6).toFixed(2);

  return (
    <Link
      href={`/market/${market.address}`}
      style={{ display: "block", textDecoration: "none" }}
    >
      <div
        className="card card-tap"
        style={{ padding: 14, position: "relative", overflow: "hidden", marginBottom: 0 }}
      >
        {/* Accent strip top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 1,
            background: accent,
            opacity: 0.5,
          }}
        />

        {/* Pill row */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="pill pill-gold">Agent market</span>
          {isResolved && (
            <span className={`pill ${market.outcome === "yes" ? "pill-green" : "pill-red"}`}>
              Resolved · {market.outcome?.toUpperCase() ?? "-"}
            </span>
          )}
        </div>

        {/* Question */}
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            color: "var(--fg-0)",
            letterSpacing: "-0.015em",
            lineHeight: 1.25,
            marginBottom: 8,
          }}
        >
          {market.question || "-"}
        </div>

        {/* Creator row */}
        <div
          className="muted"
          style={{ fontSize: 11, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}
        >
          <span>by</span>
          <span className="mono gold" style={{ fontSize: 10.5 }}>{creatorLabel}</span>
        </div>

        {/* ProbBar + numbers */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <ProbBar yes={yesPct} style="split" />
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              gap: 4,
              alignItems: "center",
            }}
          >
            <span className="green">{yesPct}</span>
            <span className="dim" style={{ fontWeight: 400 }}>·</span>
            <span className="red">{noPct}</span>
          </div>
        </div>

        {/* Footer row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
          <div className="mono-tiny muted">
            {volumeUsdc} USDC vol
          </div>
          {!isResolved && (
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn btn-yes"
                style={{ padding: "5px 11px", fontSize: 11 }}
                onClick={(e) => e.preventDefault()}
              >
                YES
              </button>
              <button
                className="btn btn-no"
                style={{ padding: "5px 11px", fontSize: 11 }}
                onClick={(e) => e.preventDefault()}
              >
                NO
              </button>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
