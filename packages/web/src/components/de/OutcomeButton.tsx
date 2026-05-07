/**
 * OutcomeButton — large rectangular CTA for market YES / NO / NAMED outcomes.
 *
 * Two states:
 *   - unselected: subtle tint background, full label visible
 *   - selected:   filled background with high-contrast text
 *
 * Variants:
 *   YES   → mint
 *   NO    → rose
 *   NAMED → lavender (use for kind=2 vs-benchmark with custom labels)
 *
 * Pure presentational — wire `onClick` from the parent. Server-friendly via
 * standard <button>.
 */
import type { CSSProperties, MouseEvent, ReactNode } from "react";

export type OutcomeVariant = "YES" | "NO" | "NAMED";

const VARIANT_COLOR: Record<
  OutcomeVariant,
  { ink: string; tint: string; solid: string; border: string; solidInk: string }
> = {
  YES: {
    ink: "var(--de-mint)",
    tint: "var(--de-mint-tint)",
    solid: "var(--de-mint)",
    border: "rgba(168,230,207,0.32)",
    solidInk: "#0A1A14",
  },
  NO: {
    ink: "var(--de-rose)",
    tint: "var(--de-rose-tint)",
    solid: "var(--de-rose)",
    border: "rgba(232,165,165,0.32)",
    solidInk: "#1A0E0E",
  },
  NAMED: {
    ink: "var(--de-lavender)",
    tint: "var(--de-lavender-tint)",
    solid: "var(--de-lavender)",
    border: "rgba(168,153,245,0.32)",
    solidInk: "#10081E",
  },
};

export interface OutcomeButtonProps {
  variant: OutcomeVariant;
  label?: ReactNode;
  /** Optional sub-line (e.g., price in cents `42¢`). */
  price?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** When true, the button sizes itself flexibly to its parent. */
  fullWidth?: boolean;
  style?: CSSProperties;
}

export function OutcomeButton({
  variant,
  label,
  price,
  selected,
  disabled,
  onClick,
  fullWidth,
  style,
}: OutcomeButtonProps) {
  const c = VARIANT_COLOR[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 8,
        background: selected ? c.solid : c.tint,
        color: selected ? c.solidInk : c.ink,
        border: `1px solid ${selected ? c.solid : c.border}`,
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? "100%" : "auto",
        flex: fullWidth ? 1 : undefined,
        transition:
          "background 160ms ease, border-color 160ms ease, transform 100ms ease",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (disabled || selected) return;
        e.currentTarget.style.background = c.tint;
        e.currentTarget.style.borderColor = c.solid;
      }}
      onMouseLeave={(e) => {
        if (disabled || selected) return;
        e.currentTarget.style.background = c.tint;
        e.currentTarget.style.borderColor = c.border;
      }}
    >
      <span>{label ?? variant}</span>
      {price != null && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          {price}
        </span>
      )}
    </button>
  );
}
