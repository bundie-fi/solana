/**
 * Minimal SVG sparkline. No axes, no labels. currentColor, so it inherits
 * from the wrapper (gold, purple, success, danger).
 *
 * Note: StrategyDisplay.performance only has scalar {day, week, month, all}
 * values today. Callers should synthesize a short series until snapshot
 * history is wired through `lib/chain.ts`. See DESIGN.md §5.
 */
export function Sparkline({
  data,
  width = 72,
  height = 22,
  strokeWidth = 1.5,
  className = "",
}: {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}) {
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / Math.max(1, data.length - 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    // Invert Y so higher values render higher on the SVG canvas
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });

  const d = points
    .map(([x, y], i) => (i === 0 ? `M${x.toFixed(2)} ${y.toFixed(2)}` : `L${x.toFixed(2)} ${y.toFixed(2)}`))
    .join(" ");

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
    >
      <path
        d={d}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Given the scalar performance buckets we currently have, fabricate a
 * believable 12-point series ending at `all` with variance reflecting the
 * shorter-window deltas. This is a placeholder until snapshot history lands.
 */
export function synthSeries(performance: {
  day: number;
  week: number;
  month: number;
  all: number;
}): number[] {
  const { day, week, month, all } = performance;
  const n = 12;
  const start = all - month; // approximate baseline 30d ago
  const end = all;
  const noise = Math.max(Math.abs(day), Math.abs(week) / 4, 0.05);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // Slight S-curve from start → end + deterministic pseudo-noise
    const base = start + (end - start) * (t * t * (3 - 2 * t));
    const wobble = noise * Math.sin(i * 1.7) * 0.5;
    out.push(base + wobble);
  }
  return out;
}
