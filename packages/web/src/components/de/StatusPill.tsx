/**
 * StatusPill — small monospace caps badge.
 *
 * Used across the dark-editorial surfaces to mark market lifecycle, agent
 * runtime state, and provenance. Always reads `--de-*` tokens; never inherits
 * legacy `--gold` / `--purple` colors.
 *
 * Variants:
 *   LIVE      → mint solid (background tint + mint ink), used for active agents
 *   ACTIVE    → lavender outline, used for running market kinds
 *   RESOLVED  → muted ink, used for closed markets
 *   DEVNET    → lavender outline, surfaces the network we're on
 */
import type { CSSProperties, ReactNode } from "react";

export type StatusPillVariant =
  | "LIVE"
  | "ACTIVE"
  | "RESOLVED"
  | "DEVNET";

const VARIANT_STYLE: Record<
  StatusPillVariant,
  { bg: string; fg: string; border: string; dot?: boolean }
> = {
  LIVE: {
    bg: "var(--de-mint-tint)",
    fg: "var(--de-mint)",
    border: "rgba(168,230,207,0.32)",
    dot: true,
  },
  ACTIVE: {
    bg: "transparent",
    fg: "var(--de-lavender)",
    border: "rgba(168,153,245,0.42)",
  },
  RESOLVED: {
    bg: "var(--de-bg-3)",
    fg: "var(--de-ink-3)",
    border: "var(--de-line-2)",
  },
  DEVNET: {
    bg: "transparent",
    fg: "var(--de-lavender)",
    border: "rgba(168,153,245,0.32)",
  },
};

export function StatusPill({
  variant,
  children,
  style,
}: {
  variant: StatusPillVariant;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const v = VARIANT_STYLE[variant];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderRadius: 999,
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.16em",
        whiteSpace: "nowrap",
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        lineHeight: 1.2,
        ...style,
      }}
    >
      {v.dot && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: v.fg,
            boxShadow: `0 0 6px ${v.fg}`,
            display: "inline-block",
          }}
        />
      )}
      {children ?? variant}
    </span>
  );
}
