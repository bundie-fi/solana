/**
 * NavChartLarge — full-bleed interactive NAV chart for the agent detail page.
 *
 * Server component, no chart library: SVG path drawing only. Range tabs are
 * rendered as anchor links that update the `?range=` searchParam, mirroring
 * the SSR-driven toggle pattern used by AgentPerformanceBlock so the entire
 * surface stays server-side.
 *
 * Stroke colour follows the trajectory's sign:
 *   last > first → `--de-lavender`
 *   last ≤ first → `--de-rose`
 * Empty / single-point series render a faint dashed midline + an editorial
 * empty-state caption underneath. The caller chooses whether to show the
 * caption (e.g. brand-new agents with no NAV history yet).
 *
 * Visual hierarchy mirrors the design spec:
 *   - 400px tall canvas
 *   - faint horizontal grid (4 lines) keyed off `--de-ink-5`
 *   - lavender / rose gradient fill below the curve
 *   - last point dot for emphasis
 *   - range tabs sit above the chart, mono caps, lavender when active
 */
import Link from "next/link";
import type { CSSProperties } from "react";

export type NavChartRange = "1H" | "24H" | "7D" | "30D" | "ALL";

export interface NavChartLargeProps {
  series: Array<{ ts: number; nav: number }>;
  range: NavChartRange;
  /** Base path for tab links (preserves existing query string). */
  basePath: string;
  /** Optional dotted threshold lines (resolution targets for open markets). */
  thresholds?: Array<{ value: number; label?: string; tone?: "mint" | "rose" }>;
  /** Heading caption ("LIVE NAV", "AGENT NAV", etc). */
  eyebrow?: string;
  height?: number;
  /** ?range= URL key. Lets two charts on one page coexist. */
  rangeParamKey?: string;
}

const RANGES: NavChartRange[] = ["1H", "24H", "7D", "30D", "ALL"];

export function NavChartLarge({
  series,
  range,
  basePath,
  thresholds,
  eyebrow = "AGENT NAV",
  height = 400,
  rangeParamKey = "range",
}: NavChartLargeProps) {
  const W = 1000; // virtual width — we render with viewBox + preserveAspectRatio
  const H = height;
  const padX = 16;
  const padY = 24;

  const navs = series.map((p) => p.nav).filter((v) => Number.isFinite(v));
  const hasData = navs.length >= 2;

  // Combine series + thresholds into the y-domain so target lines stay visible.
  const allValues = [...navs, ...(thresholds?.map((t) => t.value) ?? [])];
  const min = allValues.length ? Math.min(...allValues) : 0;
  const max = allValues.length ? Math.max(...allValues) : 1;
  const rawSpan = max - min;
  const flat = rawSpan === 0;
  const span = rawSpan || 1;

  const yFor = (v: number) => {
    if (flat) return H / 2;
    return H - padY - ((v - min) / span) * (H - padY * 2);
  };
  const xFor = (i: number) => {
    if (series.length <= 1) return W / 2;
    return padX + (i / (series.length - 1)) * (W - padX * 2);
  };

  let linePath = "";
  let areaPath = "";
  let lastPt: [number, number] | null = null;
  if (hasData) {
    const pts = series.map((p, i) => [xFor(i), yFor(p.nav)] as const);
    linePath = pts
      .map(([x, y], i) =>
        `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`,
      )
      .join(" ");
    const last = pts[pts.length - 1];
    const first = pts[0];
    areaPath = `${linePath} L ${last[0].toFixed(2)} ${H} L ${first[0].toFixed(2)} ${H} Z`;
    lastPt = [last[0], last[1]];
  }

  const direction = hasData ? series[series.length - 1].nav - series[0].nav : 0;
  const tone: "pos" | "neg" | "neutral" =
    direction > 0 ? "pos" : direction < 0 ? "neg" : "neutral";
  const stroke =
    tone === "pos"
      ? "var(--de-lavender)"
      : tone === "neg"
      ? "var(--de-rose)"
      : "var(--de-ink-3)";
  const gid = `de-navchart-grad-${Math.random().toString(36).slice(2, 9)}`;

  // Faint horizontal grid (4 lines + baseline).
  const gridLines = [0.2, 0.4, 0.6, 0.8].map((frac) => {
    const y = padY + frac * (H - padY * 2);
    return (
      <line
        key={frac}
        x1={padX}
        x2={W - padX}
        y1={y}
        y2={y}
        stroke="var(--de-ink-5)"
        strokeWidth={0.5}
      />
    );
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Range tabs + eyebrow row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--de-ink-3)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          {eyebrow}
        </span>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "inline-flex",
            gap: 2,
            padding: 3,
            borderRadius: 8,
            border: "1px solid var(--de-line-2)",
            background: "var(--de-bg-3)",
          }}
        >
          {RANGES.map((r) => {
            const active = r === range;
            const href = `${basePath}?${rangeParamKey}=${r.toLowerCase()}`;
            return (
              <Link
                key={r}
                href={href}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: active ? "var(--de-lavender-tint)" : "transparent",
                  color: active ? "var(--de-lavender)" : "var(--de-ink-3)",
                  border: active
                    ? "1px solid rgba(168,153,245,0.42)"
                    : "1px solid transparent",
                }}
              >
                {r}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Chart body */}
      <div
        style={
          {
            position: "relative",
            width: "100%",
            height,
            borderRadius: 12,
            border: "1px solid var(--de-line-2)",
            background:
              "radial-gradient(60% 80% at 50% 0%, var(--de-lavender-glow), transparent), var(--de-bg-raised)",
            overflow: "hidden",
          } as CSSProperties
        }
      >
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ display: "block" }}
          aria-hidden="true"
        >
          {/* Grid */}
          {gridLines}

          {/* Threshold lines */}
          {thresholds?.map((t, i) => {
            const y = yFor(t.value);
            const color =
              t.tone === "rose"
                ? "var(--de-rose)"
                : "var(--de-mint)";
            return (
              <g key={i}>
                <line
                  x1={padX}
                  x2={W - padX}
                  y1={y}
                  y2={y}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray="4 6"
                  opacity={0.55}
                />
              </g>
            );
          })}

          {hasData ? (
            <>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={areaPath} fill={`url(#${gid})`} stroke="none" />
              <path
                d={linePath}
                fill="none"
                stroke={stroke}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {lastPt && (
                <circle
                  cx={lastPt[0]}
                  cy={lastPt[1]}
                  r={4}
                  fill={stroke}
                  stroke="var(--de-bg-raised)"
                  strokeWidth={2}
                />
              )}
            </>
          ) : (
            <line
              x1={padX}
              x2={W - padX}
              y1={H / 2}
              y2={H / 2}
              stroke="var(--de-ink-5)"
              strokeDasharray="4 8"
              strokeWidth={1}
            />
          )}
        </svg>

        {!hasData && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 24,
              textAlign: "center",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 18,
                color: "var(--de-ink-2)",
                lineHeight: 1.3,
              }}
            >
              No NAV history yet.
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--de-ink-4)",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            >
              First commit_nav will land soon
            </span>
          </div>
        )}
      </div>

      {/* Threshold legend */}
      {thresholds && thresholds.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--de-ink-3)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          {thresholds.map((t, i) => (
            <span
              key={i}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 14,
                  height: 0,
                  borderTop: `1.5px dashed ${
                    t.tone === "rose"
                      ? "var(--de-rose)"
                      : "var(--de-mint)"
                  }`,
                }}
              />
              {t.label ?? `target ${t.value.toFixed(2)}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
