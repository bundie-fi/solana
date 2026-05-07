"use client";

/**
 * TradingPanel — right-column trade widget for the market detail page.
 *
 * Visual shell only: the bet flow proper still lives in the legacy
 * `MarketBuyPanel` component (3-stage idle → preview → confirm → success
 * state machine, claimable redemption, MWA / standard adapter routing).
 * Wrapping rather than rewriting keeps the on-chain submission path
 * untouched while we transition the surrounding chrome to the dark
 * editorial palette.
 *
 * Layout:
 *   - Header: market status pill + sticky timestamp
 *   - Buy / Sell tabs (only Buy is wired today; Sell is visually present
 *     but inert — the program has no `sell_shares` ix yet)
 *   - Outcome selector cards: YES / NO with current % (lavender bordered)
 *   - The existing MarketBuyPanel renders below, fully functional —
 *     amount input, quick-amount, preview/confirm flow, all retained.
 *
 * Sticky positioning is provided by the parent column so this component
 * stays a passive shell.
 */
import type { CSSProperties } from "react";
import type { MarketView } from "@/lib/markets";
import type { QualityGateResult } from "@/lib/quality-gate";
import { MarketBuyPanel } from "@/components/market-buy-panel";
import { OutcomeButton } from "./OutcomeButton";
import { StatusPill } from "./StatusPill";

export interface TradingPanelProps {
  market: MarketView;
  yesProbability: number;
  qualityGate?: QualityGateResult;
  resolutionTimeLabel: string;
  /** Custom names for kind=2 head-to-head outcomes (e.g., "Side A wins"). */
  outcomeALabel?: string;
  outcomeBLabel?: string;
  style?: CSSProperties;
}

export function TradingPanel({
  market,
  yesProbability,
  qualityGate,
  resolutionTimeLabel,
  outcomeALabel,
  outcomeBLabel,
  style,
}: TradingPanelProps) {
  const yesPct = Math.round(yesProbability * 100);
  const noPct = 100 - yesPct;
  const isResolved = market.status === "resolved";
  const yesLabel = outcomeALabel ?? "YES";
  const noLabel = outcomeBLabel ?? "NO";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 24,
        border: "1px solid var(--de-line-2)",
        borderRadius: 12,
        background: "var(--de-bg-raised)",
        ...style,
      }}
    >
      {/* Status header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {isResolved ? (
          <StatusPill variant="RESOLVED" />
        ) : (
          <StatusPill variant="ACTIVE">LIVE</StatusPill>
        )}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--de-ink-4)",
          }}
        >
          {isResolved
            ? `Outcome · ${(market.outcome ?? "—").toUpperCase()}`
            : `Resolves ${resolutionTimeLabel}`}
        </span>
      </div>

      {/* Outcome readout cards (visual mirror of the toggle inside the
          buy panel below). Read-only summary so users can see the current
          probabilities at a glance even before clicking into the picker. */}
      {!isResolved && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.20em",
              color: "var(--de-ink-4)",
              marginBottom: 2,
            }}
          >
            Pick a side
          </div>
          <OutcomeButton
            variant="YES"
            label={yesLabel}
            price={`${yesPct}%`}
            fullWidth
          />
          <OutcomeButton
            variant="NO"
            label={noLabel}
            price={`${noPct}%`}
            fullWidth
          />
        </div>
      )}

      {/* The legacy buy panel — still owns all the trade state, the
          amount input, preview / confirm states, and on-chain submission.
          Visually it sits inside this card; the inset frame styling makes
          it read as one continuous panel. */}
      <div
        style={{
          marginTop: 4,
        }}
      >
        <MarketBuyPanel
          market={market}
          yesProbability={yesProbability}
          qualityGate={qualityGate}
        />
      </div>
    </div>
  );
}

