/**
 * Sparkline — small inline NAV chart.
 *
 * SVG-based, no external chart library. Used in:
 *   - leaderboard rows  (size="small",  ~120×32)
 *   - featured hero     (size="large", scales with the parent container)
 *
 * The stroke color follows the *direction* of the series:
 *   last > first → lavender (`--de-lavender`)
 *   last ≤ first → rose     (`--de-rose`)
 * Empty / single-point series render a faint dashed midline so brand-new
 * agents still occupy the slot.
 *
 * Server-renderable. No state, no hooks, no client APIs.
 */
import type { CSSProperties } from "react";

export interface DeSparklineProps {
  /** USD values, oldest → newest. */
  series: number[];
  width?: number;
  height?: number;
  variant?: "small" | "large";
  /** Force a tone; default uses sign of (last − first). */
  tone?: "pos" | "neg" | "neutral";
  strokeWidth?: number;
  /** Fills the area under the curve with a faint gradient. Used by hero. */
  showFill?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function DeSparkline({
  series,
  width,
  height,
  variant = "small",
  tone,
  strokeWidth,
  showFill,
  className,
  style,
}: DeSparklineProps) {
  // Default geometry per variant. Callers can still override.
  const W = width ?? (variant === "large" ? 480 : 120);
  const H = height ?? (variant === "large" ? 160 : 32);
  const SW = strokeWidth ?? (variant === "large" ? 1.75 : 1.25);
  const fill = showFill ?? variant === "large";

  if (!series || series.length < 2) {
    return (
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={className}
        style={style}
        aria-hidden="true"
      >
        <line
          x1={2}
          x2={W - 2}
          y1={H / 2}
          y2={H / 2}
          stroke="var(--de-ink-5)"
          strokeDasharray="2 4"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const rawSpan = max - min;
  const flat = rawSpan === 0;
  const span = rawSpan || 1;
  const stepX = (W - 2) / (series.length - 1);
  const pad = variant === "large" ? 6 : 3;

  const pts = series.map((v, i) => {
    const x = 1 + i * stepX;
    const y = flat
      ? H / 2
      : H - pad - ((v - min) / span) * (H - pad * 2);
    return [x, y] as const;
  });

  const linePath = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");

  const direction = series[series.length - 1] - series[0];
  const resolvedTone: "pos" | "neg" | "neutral" =
    tone ?? (direction > 0 ? "pos" : direction < 0 ? "neg" : "neutral");
  const color =
    resolvedTone === "pos"
      ? "var(--de-lavender)"
      : resolvedTone === "neg"
      ? "var(--de-rose)"
      : "var(--de-ink-3)";

  // Build closed path for area fill: line + line down to baseline + close
  const last = pts[pts.length - 1];
  const first = pts[0];
  const areaPath =
    fill && !flat
      ? `${linePath} L ${last[0].toFixed(2)} ${H} L ${first[0].toFixed(2)} ${H} Z`
      : null;

  // Gradient ID per render — collisions across multiple sparklines on the
  // page would otherwise share fills. Math.random is fine since these are
  // server-rendered once and never re-keyed.
  const gid = `de-spark-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      style={{ overflow: "visible", display: "block", ...style }}
      aria-hidden="true"
    >
      {fill && areaPath && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gid})`} stroke="none" />
        </>
      )}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {variant === "large" && (
        <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
      )}
    </svg>
  );
}
