/**
 * ConvictionBar — horizontal probability bar.
 *
 * Renders the YES probability as a filled portion of a dark muted track.
 * If YES > 50%, fill is lavender; otherwise rose. The percentage label sits
 * on the right in display-serif. Animated transitions on width changes are
 * driven by a CSS transition (`width 320ms`).
 *
 * Pure presentational — server-renderable.
 */
import type { CSSProperties } from "react";

export interface ConvictionBarProps {
  /** YES probability in [0, 1]. */
  yes: number;
  /** Optional override for the right-side percent label. */
  label?: string;
  /** Bar height. Default 6. */
  height?: number;
  /** Hide the percentage label (keep just the bar). */
  hideLabel?: boolean;
  style?: CSSProperties;
}

export function ConvictionBar({
  yes,
  label,
  height = 6,
  hideLabel,
  style,
}: ConvictionBarProps) {
  const clamped = Math.max(0, Math.min(1, yes));
  const pct = Math.round(clamped * 100);
  const positive = clamped > 0.5;
  const color = positive ? "var(--de-lavender)" : "var(--de-rose)";
  const glow = positive ? "var(--de-lavender-glow)" : "var(--de-rose-glow)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        ...style,
      }}
    >
      <div
        style={{
          flex: 1,
          height,
          background: "var(--de-bg-3)",
          borderRadius: 999,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: color,
            boxShadow: `0 0 8px ${glow}`,
            transition: "width 320ms cubic-bezier(0.25,0.4,0.25,1), background 200ms ease",
          }}
        />
      </div>
      {!hideLabel && (
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 14,
            color: "var(--de-ink)",
            fontVariantNumeric: "tabular-nums",
            minWidth: 36,
            textAlign: "right",
            letterSpacing: "-0.01em",
          }}
        >
          {label ?? `${pct}%`}
        </span>
      )}
    </div>
  );
}
