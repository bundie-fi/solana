"use client";

import type { CSSProperties } from "react";
import type { AgentPreset } from "@/app/strategists/lib/api";

export type RiskLevel = "low" | "medium" | "high";

const STYLES: Record<RiskLevel, { label: string; fg: string; bg: string }> = {
  low: {
    label: "Low risk",
    fg: "var(--de-mint)",
    bg: "var(--de-mint-tint)",
  },
  medium: {
    label: "Medium risk",
    fg: "var(--amber)",
    bg: "var(--amber-tint)",
  },
  high: {
    label: "High risk",
    fg: "var(--de-rose)",
    bg: "var(--de-rose-tint)",
  },
};

/**
 * Map a wizard preset id to a visible risk tier. Conservative + yield hunter
 * stay in stables / blue chips; balanced mixes strategies; aggressive and
 * perp trader take leverage / directional risk.
 */
export function riskForPreset(preset: AgentPreset | null | undefined): RiskLevel {
  switch (preset) {
    case "conservative":
    case "yield-hunter":
      return "low";
    case "balanced":
      return "medium";
    case "aggressive":
    case "perp-trader":
      return "high";
    default:
      return "medium";
  }
}

export function RiskBadge({
  level,
  style,
}: {
  level: RiskLevel;
  style?: CSSProperties;
}) {
  const cfg = STYLES[level];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px",
        borderRadius: "var(--r-pill)",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.6,
        color: cfg.fg,
        background: cfg.bg,
        border: `1px solid ${cfg.fg}`,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: cfg.fg,
          display: "inline-block",
        }}
      />
      {cfg.label}
    </span>
  );
}
