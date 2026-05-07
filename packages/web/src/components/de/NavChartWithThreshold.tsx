/**
 * NavChartWithThreshold — large NAV trajectory chart with a horizontal
 * resolution-threshold line drawn in.
 *
 * The chart background is divided into two zones by the threshold:
 *   - mint tint (`--de-mint-tint`) above the threshold (YES outcome zone)
 *   - rose tint (`--de-rose-tint`) below the threshold (NO outcome zone)
 *
 * The NAV stroke runs on top in lavender so it stays neutral vs the zone
 * coloring. The threshold itself renders as a dashed lavender hairline.
 *
 * Pure SVG, no external chart library. Server-renderable. The component
 * accepts arbitrary x-axis labels (e.g. "Mon", "Tue") computed by the
 * caller, but only the labels at the start / mid / end positions are
 * drawn so dense series stay legible.
 *
 * Failure mode: when the series has fewer than two points, the chart
 * renders a centered "Not enough history yet" placeholder that still
 * occupies the slot, so the page layout doesn't shift.
 */
import type { CSSProperties } from "react";

export interface NavChartWithThresholdProps {
  /** NAV values in bUSD, oldest → newest. */
  series: number[];
  /** Optional ISO timestamps (parallel to `series`) for hover tooltips and
   *  axis label generation. Currently used to compute axis labels. */
  timestamps?: string[];
  /** Resolution threshold in bUSD. When omitted, no threshold line / zone
   *  is drawn (e.g. for kind=2 head-to-head where the threshold isn't
   *  a single number). */
  thresholdBusd?: number | null;
  /** Caption shown below the chart (e.g. "NAV currently 4.8 bUSD,
   *  threshold 5.2 bUSD"). When omitted, no caption renders. */
  caption?: string;
  /** Total chart height in px. Default 280. */
  height?: number;
  style?: CSSProperties;
}

export function NavChartWithThreshold({
  series,
  timestamps,
  thresholdBusd,
  caption,
  height = 280,
  style,
}: NavChartWithThresholdProps) {
  const hasData = series.length >= 2;
  const w = 1000; // viewBox width — scales freely via preserveAspectRatio
  const h = height;
  const padL = 56;
  const padR = 16;
  const padT = 24;
  const padB = 32;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  if (!hasData) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          ...style,
        }}
      >
        <div
          style={{
            height,
            border: "1px solid var(--de-line-2)",
            borderRadius: 12,
            background: "var(--de-bg-raised)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--de-ink-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Not enough NAV history yet
        </div>
      </div>
    );
  }

  // Domain — include the threshold so it stays inside the visible plot.
  const seriesMin = Math.min(...series);
  const seriesMax = Math.max(...series);
  const domainMinRaw =
    thresholdBusd != null ? Math.min(seriesMin, thresholdBusd) : seriesMin;
  const domainMaxRaw =
    thresholdBusd != null ? Math.max(seriesMax, thresholdBusd) : seriesMax;
  // Add 6% headroom on top + bottom so the line never kisses the edge.
  const span = domainMaxRaw - domainMinRaw || 1;
  const pad = span * 0.06;
  const domainMin = domainMinRaw - pad;
  const domainMax = domainMaxRaw + pad;
  const domainSpan = domainMax - domainMin;

  const xFor = (i: number) =>
    padL + (i * innerW) / Math.max(1, series.length - 1);
  const yFor = (v: number) =>
    padT + innerH - ((v - domainMin) / domainSpan) * innerH;

  // NAV path
  const pts = series.map((v, i) => [xFor(i), yFor(v)] as const);
  const linePath = pts
    .map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`))
    .join(" ");

  // Zones — render rectangles split by the threshold so the chart reads
  // YES-above / NO-below at a glance. When no threshold, paint a single
  // neutral lavender-tinted plot background.
  const tY = thresholdBusd != null ? yFor(thresholdBusd) : null;

  // Tick generation — pick 4 evenly spaced values across the domain for the
  // y-axis. Round to a sensible precision based on span.
  const yTicks = pickYTicks(domainMin, domainMax, 4);

  // X-axis labels — only first / middle / last entries to avoid clutter.
  const lastIdx = series.length - 1;
  const midIdx = Math.floor(lastIdx / 2);
  const xLabels = timestamps
    ? [
        { i: 0, t: shortDate(timestamps[0]) },
        { i: midIdx, t: shortDate(timestamps[midIdx]) },
        { i: lastIdx, t: shortDate(timestamps[lastIdx]) },
      ]
    : [];

  // Threshold callout — small chip on the right edge of the line.
  const lastVal = series[lastIdx];
  const isAbove =
    thresholdBusd != null ? lastVal >= thresholdBusd : true;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...style,
      }}
    >
      <div
        style={{
          position: "relative",
          border: "1px solid var(--de-line-2)",
          borderRadius: 12,
          background: "var(--de-bg-raised)",
          overflow: "hidden",
        }}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height, display: "block" }}
        >
          <defs>
            <linearGradient id="navchart-mint-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(168,230,207,0.18)" />
              <stop offset="100%" stopColor="rgba(168,230,207,0.04)" />
            </linearGradient>
            <linearGradient id="navchart-rose-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(232,165,165,0.04)" />
              <stop offset="100%" stopColor="rgba(232,165,165,0.18)" />
            </linearGradient>
          </defs>

          {/* Outcome zones — split by threshold or neutral fill */}
          {tY != null ? (
            <>
              <rect
                x={padL}
                y={padT}
                width={innerW}
                height={Math.max(0, tY - padT)}
                fill="url(#navchart-mint-fill)"
              />
              <rect
                x={padL}
                y={tY}
                width={innerW}
                height={Math.max(0, padT + innerH - tY)}
                fill="url(#navchart-rose-fill)"
              />
            </>
          ) : (
            <rect
              x={padL}
              y={padT}
              width={innerW}
              height={innerH}
              fill="rgba(168,153,245,0.04)"
            />
          )}

          {/* Y-axis horizontal grid */}
          {yTicks.map((t, i) => {
            const y = yFor(t);
            return (
              <g key={`y-${i}`}>
                <line
                  x1={padL}
                  x2={padL + innerW}
                  y1={y}
                  y2={y}
                  stroke="var(--de-line)"
                  strokeWidth={1}
                />
                <text
                  x={padL - 8}
                  y={y + 3}
                  fill="var(--de-ink-4)"
                  fontFamily="var(--font-mono)"
                  fontSize={10}
                  textAnchor="end"
                  letterSpacing="0.04em"
                >
                  {fmtBusd(t)}
                </text>
              </g>
            );
          })}

          {/* Threshold line */}
          {tY != null && (
            <g>
              <line
                x1={padL}
                x2={padL + innerW}
                y1={tY}
                y2={tY}
                stroke="var(--de-lavender)"
                strokeWidth={1.25}
                strokeDasharray="6 5"
                opacity={0.85}
              />
              <text
                x={padL + innerW - 8}
                y={tY - 6}
                fill="var(--de-lavender)"
                fontFamily="var(--font-mono)"
                fontSize={10}
                textAnchor="end"
                letterSpacing="0.10em"
              >
                THRESHOLD · {fmtBusd(thresholdBusd ?? 0)}
              </text>
            </g>
          )}

          {/* NAV line */}
          <path
            d={linePath}
            fill="none"
            stroke="var(--de-ink)"
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Endpoint dot — colored by current zone */}
          <circle
            cx={pts[lastIdx][0]}
            cy={pts[lastIdx][1]}
            r={4}
            fill={isAbove ? "var(--de-mint)" : "var(--de-rose)"}
            stroke="var(--de-bg-raised)"
            strokeWidth={2}
          />

          {/* X-axis labels */}
          {xLabels.map((lbl, i) => (
            <text
              key={`x-${i}`}
              x={xFor(lbl.i)}
              y={padT + innerH + 18}
              fill="var(--de-ink-4)"
              fontFamily="var(--font-mono)"
              fontSize={10}
              textAnchor={
                i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"
              }
              letterSpacing="0.04em"
            >
              {lbl.t}
            </text>
          ))}
        </svg>
      </div>

      {caption && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--de-ink-3)",
            letterSpacing: "0.06em",
          }}
        >
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <LegendDot color="var(--de-mint)" label="ABOVE" />
            <LegendDot color="var(--de-rose)" label="BELOW" />
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--de-ink-4)",
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 0,
                  borderTop: "1.5px dashed var(--de-lavender)",
                  display: "inline-block",
                }}
              />
              THRESHOLD
            </span>
          </div>
          <div style={{ color: "var(--de-ink-2)" }}>{caption}</div>
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 8px ${color}`,
          display: "inline-block",
        }}
      />
      <span style={{ color: "var(--de-ink-4)" }}>{label}</span>
    </span>
  );
}

function pickYTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const span = max - min;
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

function fmtBusd(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // e.g. "Mar 4"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
