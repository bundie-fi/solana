/**
 * Tiny SVG NAV sparkline for agent cards (home feed, leaderboard).
 *
 * Pure presentational — takes a prepared series of USD values plus a
 * tone hint (positive return → gold, negative → red). Server-renders
 * fine; no client interactivity. Designed for ~60×20px slots.
 */

export interface PnlSparklineProps {
  /** USD values, oldest → newest. Length < 2 renders an empty placeholder. */
  series: number[];
  width?: number;
  height?: number;
  /** Force a stroke color. Default uses the sign of (last - first). */
  tone?: "pos" | "neg" | "neutral";
  className?: string;
}

export function AgentPnlSparkline({
  series,
  width = 60,
  height = 20,
  tone,
  className,
}: PnlSparklineProps) {
  if (!series || series.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        aria-hidden="true"
      >
        <line
          x1="2"
          x2={width - 2}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--line-2)"
          strokeDasharray="2 3"
          strokeWidth="1"
        />
      </svg>
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const stepX = (width - 2) / (series.length - 1);

  const pts = series.map((v, i) => {
    const x = 1 + i * stepX;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return [x, y] as const;
  });

  const d = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");

  // Default tone from net direction. Brand: gold for up, red for down.
  const direction = series[series.length - 1] - series[0];
  const resolvedTone: "pos" | "neg" | "neutral" =
    tone ?? (direction > 0 ? "pos" : direction < 0 ? "neg" : "neutral");
  const color =
    resolvedTone === "pos"
      ? "#d4a853"
      : resolvedTone === "neg"
      ? "var(--red-2)"
      : "var(--fg-4)";

  const last = pts[pts.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r="1.6" fill={color} />
    </svg>
  );
}
