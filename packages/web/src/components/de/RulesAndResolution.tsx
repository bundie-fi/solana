/**
 * RulesAndResolution — explainer panel for the market detail page.
 *
 * Renders the resolution mechanic in editorial language:
 *   - kind chip + status pill across the top
 *   - "Resolves to" headline with the outcome name + a one-sentence
 *     description
 *   - "Resolution mechanism" line ("Reads on-chain NAV at slot N. No
 *     oracle, no committee.")
 *   - Optional "see all rules" link in monospace caps
 *
 * Pure server component. Pass derived `resolutionProse` and `slot` from
 * the page so the wording stays consistent with the rest of the surface.
 */
import type { CSSProperties, ReactNode } from "react";

const KIND_META: Record<
  number,
  { label: string; outcomeName: string; mechanic: string }
> = {
  1: {
    label: "NAV TARGET",
    outcomeName: "NAV reaches target",
    mechanic:
      "On-chain NAV is read directly from the agent vault account at the resolution slot.",
  },
  2: {
    label: "HEAD TO HEAD",
    outcomeName: "Side A beats side B",
    mechanic:
      "Both vaults are read at the resolution slot; whichever has higher NAV growth from baseline wins.",
  },
  3: {
    label: "DRAWDOWN",
    outcomeName: "NAV falls past threshold",
    mechanic:
      "On-chain NAV is read directly from the agent vault account at the resolution slot.",
  },
};

export interface RulesAndResolutionProps {
  kind: number;
  /** One-sentence resolution explainer, fully resolved by the caller. */
  resolutionProse: string;
  /** Resolution slot for the "Reads on-chain NAV at slot N" line. */
  resolutionSlot: number;
  /** Friendly time-to-resolution label, e.g. "in ~5h". */
  resolutionTimeLabel: string;
  /** Optional href for the "See all rules" link. */
  seeAllRulesHref?: string;
  /** Trailing slot for an inline "creator accuracy" or supplementary line. */
  trailing?: ReactNode;
  style?: CSSProperties;
}

export function RulesAndResolution({
  kind,
  resolutionProse,
  resolutionSlot,
  resolutionTimeLabel,
  seeAllRulesHref,
  trailing,
  style,
}: RulesAndResolutionProps) {
  const meta = KIND_META[kind] ?? {
    label: "MARKET",
    outcomeName: "Market outcome",
    mechanic:
      "Resolution reads program-native state at the resolution slot — no oracle, no committee.",
  };

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: 28,
        border: "1px solid var(--de-line-2)",
        borderRadius: 12,
        background: "var(--de-bg-raised)",
        ...style,
      }}
    >
      {/* Header strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.20em",
            color: "var(--de-ink-3)",
          }}
        >
          Rules &amp; Resolution
        </div>
        {seeAllRulesHref && (
          <a
            href={seeAllRulesHref}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              color: "var(--de-lavender)",
              textDecoration: "none",
            }}
          >
            See all rules →
          </a>
        )}
      </div>

      {/* Kind label */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          color: "var(--de-lavender)",
          padding: "3px 8px",
          background: "var(--de-lavender-tint)",
          border: "1px solid rgba(168,153,245,0.28)",
          borderRadius: 4,
          alignSelf: "flex-start",
        }}
      >
        {meta.label}
      </div>

      {/* Resolves to */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.20em",
            color: "var(--de-ink-4)",
          }}
        >
          Resolves to
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            lineHeight: 1.25,
            letterSpacing: "-0.015em",
            color: "var(--de-ink)",
          }}
        >
          {meta.outcomeName}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            lineHeight: 1.55,
            color: "var(--de-ink-2)",
          }}
        >
          {resolutionProse}
        </p>
      </div>

      {/* Resolution mechanism */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "14px 16px",
          background: "var(--de-bg-3)",
          border: "1px solid var(--de-line)",
          borderRadius: 8,
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
          }}
        >
          Resolution mechanism
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.55,
            color: "var(--de-ink-2)",
            letterSpacing: "0.01em",
          }}
        >
          Reads on-chain NAV at slot{" "}
          <span style={{ color: "var(--de-lavender)" }}>
            {resolutionSlot.toLocaleString()}
          </span>
          . {meta.mechanic}
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            color: "var(--de-mint)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          <span>✓ No oracle</span>
          <span style={{ color: "var(--de-ink-5)" }}>·</span>
          <span>No committee</span>
          <span style={{ color: "var(--de-ink-5)" }}>·</span>
          <span style={{ color: "var(--de-ink-3)" }}>
            Resolves {resolutionTimeLabel}
          </span>
        </div>
      </div>

      {trailing}
    </section>
  );
}
