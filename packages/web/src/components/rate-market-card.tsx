"use client";

import Link from "next/link";
import type { MarketView } from "@/lib/markets";
import type { AgentDirectory } from "@/lib/registry";
import { resolveSns, truncatePubkey } from "@/lib/sns-resolver";
import { ProbBar } from "@/components/prob-bar";

/**
 * Market card , Seeker design with accent top strip, type pill, ProbBar,
 * YES/NO buttons. Matches MarketCard from the design handoff.
 *
 * Pass `dir` from the active agent registry so wizard-launched agents
 * resolve to their .bundie.sol identity instead of a truncated pubkey.
 */
function resolveLabel(
  pubkey: string,
  dir?: AgentDirectory,
): { name: string; emoji: string | null } {
  const fromDir = dir?.[pubkey];
  if (fromDir) return { name: fromDir.displayName, emoji: fromDir.emoji };
  const legacy = resolveSns(pubkey);
  if (legacy?.devnetName) return { name: legacy.devnetName, emoji: null };
  return { name: truncatePubkey(pubkey), emoji: null };
}

function kindLabel(kind: number): string {
  if (kind === 1) return "NAV target";
  if (kind === 2) return "Head-to-head";
  if (kind === 3) return "Drawdown";
  return "Market";
}

export function RateMarketCard({
  market,
  dir,
}: {
  market: MarketView;
  dir?: AgentDirectory;
}) {
  const creator = resolveLabel(market.createdBy, dir);
  // For kinds 1/3 the predicted vault sits on Market.strategy. For
  // kind 2 we additionally have a B side on Market.targetAgent.
  const targetA = market.strategy ? resolveLabel(market.strategy, dir) : null;
  const targetB = market.targetAgent
    ? resolveLabel(market.targetAgent, dir)
    : null;

  const isResolved = market.status === "resolved";

  // Probability from share ratio
  const totalShares = market.yesShares + market.noShares;
  const yesPct = totalShares > 0
    ? Math.round((market.yesShares / totalShares) * 100)
    : 50;
  const noPct = 100 - yesPct;

  const accent = "var(--gold)";
  // Markets are bUSD-collateralized (mint 42LaRiwv…). The variable name
  // is historical — every label rendered to users says bUSD now.
  const volumeBusd = (market.totalVolume / 1e6).toFixed(2);

  // Build a one-line plain-language explainer of what the market is
  // really asking. The on-chain `question` is the brain's free-form
  // string; this gives every market a deterministic, scannable subtitle.
  let predicate: string | null = null;
  if (market.kind === 1 && targetA) {
    const navUi = market.targetNavLamports
      ? (market.targetNavLamports / 1_000_000).toFixed(0)
      : null;
    predicate = navUi
      ? `Will ${targetA.name}'s NAV reach $${navUi}?`
      : `Will ${targetA.name}'s NAV cross the threshold?`;
  } else if (market.kind === 2 && targetA && targetB) {
    predicate = `Will ${targetA.name} outperform ${targetB.name}?`;
  } else if (market.kind === 3 && targetA) {
    const bps = market.drawdownBps ?? 0;
    predicate = bps
      ? `Will ${targetA.name} drawdown ≥ ${(bps / 100).toFixed(0)}%?`
      : `Will ${targetA.name} hit a drawdown threshold?`;
  }

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
          <span className="pill pill-gold">{kindLabel(market.kind)}</span>
          {isResolved && (
            <span className={`pill ${market.outcome === "yes" ? "pill-green" : "pill-red"}`}>
              Resolved · {market.outcome?.toUpperCase() ?? "-"}
            </span>
          )}
        </div>

        {/* Predicate (deterministic subtitle) */}
        {predicate && (
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 17,
              color: "var(--fg-0)",
              letterSpacing: "-0.015em",
              lineHeight: 1.25,
              marginBottom: 6,
            }}
          >
            {predicate}
          </div>
        )}

        {/* Brain question (free-form) */}
        {market.question && (
          <div
            className="muted"
            style={{
              fontSize: 12,
              lineHeight: 1.4,
              marginBottom: 10,
            }}
          >
            {market.question}
          </div>
        )}

        {/* Creator + Target row */}
        <div
          className="muted"
          style={{ fontSize: 11, marginBottom: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
        >
          <span>by</span>
          <span className="mono gold" style={{ fontSize: 10.5 }}>
            {creator.emoji ?? "🤖"} {creator.name}
          </span>
          {targetA && (
            <>
              <span>·</span>
              <span>on</span>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-1)" }}>
                {targetA.emoji ?? "🤖"} {targetA.name}
                {targetB ? ` vs ${targetB.emoji ?? "🤖"} ${targetB.name}` : ""}
              </span>
            </>
          )}
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
            {volumeBusd} bUSD vol
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
