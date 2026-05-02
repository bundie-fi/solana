"use client";

/**
 * Hand-rolled SVG equity curve for the agent profile P&L block.
 *
 * Plots `navLamports` over time with a dashed horizontal anchor line.
 * The anchor prefers `startingNavLamports` (real first-snapshot NAV,
 * which includes the warmup airdrop) and falls back to `seedNavLamports`
 * (strategy-token stake only) when no snapshots exist yet.
 *
 * Hovering (pointer-move) snaps to the nearest snapshot and surfaces a
 * tooltip with timestamp + NAV + per-protocol component breakdown.
 *
 * Why not Recharts: it's not installed and the chart is thin enough to
 * draw directly. Adding a top-level dep for one chart felt heavy.
 *
 * Server-component-friendly: this file is `"use client"`; the parent
 * server component fetches the data and passes the array in. State is
 * limited to the hover index so the chart re-renders only for the
 * tooltip, not on every parent re-render.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PnlSnapshot } from "@/lib/pnl";
import { microsToUsd } from "@/lib/pnl";

interface AgentEquityChartProps {
  snapshots: PnlSnapshot[];
  /** Strategy-token stake from `agents.seed_amount_busd`. Fallback only. */
  seedNavLamports: string | null;
  /** First-snapshot NAV — preferred anchor; reflects warmup airdrop. */
  startingNavLamports?: string | null;
  height?: number;
}

const PADDING = { top: 12, right: 14, bottom: 22, left: 44 };

export function AgentEquityChart({
  snapshots,
  seedNavLamports,
  startingNavLamports,
  height = 220,
}: AgentEquityChartProps) {
  // Prefer the first-snapshot NAV (real starting point) over the
  // strategy-token stake. The latter is only ~$100 of the actual ~$600
  // starting NAV after the warmup airdrop, and using it here would draw
  // the anchor at the wrong height.
  const usingStartingNav = startingNavLamports != null;
  const anchorLamports = startingNavLamports ?? seedNavLamports;
  const anchorLabel = usingStartingNav ? "start" : "seed";
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [width, setWidth] = useState(640);

  // Re-measure on mount + on viewport resize. Bypasses a global
  // ResizeObserver dep — the chart's parent reflows on viewport
  // changes only, so a window 'resize' listener is sufficient.
  useEffect(() => {
    const measure = () => {
      if (wrapRef.current) {
        const w = wrapRef.current.clientWidth;
        if (w) setWidth(w);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const series = useMemo(() => {
    return snapshots
      .map((s) => ({
        ts: new Date(s.ts).getTime(),
        usd: microsToUsd(s.navLamports) ?? 0,
        snap: s,
      }))
      .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.usd))
      .sort((a, b) => a.ts - b.ts);
  }, [snapshots]);

  const seedUsd = useMemo(
    () => microsToUsd(anchorLamports ?? null),
    [anchorLamports],
  );

  if (series.length < 2) {
    return (
      <div
        ref={wrapRef}
        className="card inset"
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          textAlign: "center",
        }}
      >
        <div>
          <div
            className="muted"
            style={{ fontSize: 12, lineHeight: 1.4, marginBottom: 4 }}
          >
            Not enough NAV history yet.
          </div>
          <div className="dim mono-tiny">
            Equity curve appears after the agent commits multiple NAV
            snapshots.
          </div>
        </div>
      </div>
    );
  }

  const w = Math.max(280, width);
  const innerW = w - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const tsMin = series[0].ts;
  const tsMax = series[series.length - 1].ts;
  const tsRange = Math.max(1, tsMax - tsMin);

  // Y range — include seed line in the bounds so the dashed anchor
  // never clips off-frame.
  const usdValues = series.map((p) => p.usd);
  if (seedUsd != null) usdValues.push(seedUsd);
  const yMinRaw = Math.min(...usdValues);
  const yMaxRaw = Math.max(...usdValues);
  const yPad = (yMaxRaw - yMinRaw) * 0.08 || Math.max(1, yMaxRaw * 0.02);
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;
  const yRange = Math.max(1e-9, yMax - yMin);

  const xOf = (ts: number) =>
    PADDING.left + ((ts - tsMin) / tsRange) * innerW;
  const yOf = (usd: number) =>
    PADDING.top + (1 - (usd - yMin) / yRange) * innerH;

  const path = series
    .map((p, i) => {
      const x = xOf(p.ts).toFixed(2);
      const y = yOf(p.usd).toFixed(2);
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  // Area underneath the curve for visual weight.
  const areaPath =
    `${path} L ${xOf(series[series.length - 1].ts).toFixed(2)} ${(
      PADDING.top + innerH
    ).toFixed(2)} L ${xOf(series[0].ts).toFixed(2)} ${(
      PADDING.top + innerH
    ).toFixed(2)} Z`;

  // Y-axis ticks — 4 evenly spaced values rounded to 2dp.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + yRange * t);

  // X ticks — first, middle, last
  const xTicks = [
    series[0],
    series[Math.floor(series.length / 2)],
    series[series.length - 1],
  ];

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    if (x < PADDING.left || x > w - PADDING.right) {
      setHoverIdx(null);
      return;
    }
    // Find nearest snapshot by x
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < series.length; i++) {
      const dx = Math.abs(xOf(series[i].ts) - x);
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  const hover = hoverIdx != null ? series[hoverIdx] : null;
  const hoverX = hover ? xOf(hover.ts) : 0;
  const hoverY = hover ? yOf(hover.usd) : 0;

  // Tooltip — clamp to viewport edges
  let tipLeft = hoverX + 10;
  if (hoverX > w - 180) tipLeft = hoverX - 190;

  const seedY = seedUsd != null ? yOf(seedUsd) : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <svg
        width={w}
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        style={{ display: "block", touchAction: "pan-y" }}
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="equity-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y gridlines + tick labels */}
        {yTicks.map((v, i) => {
          const y = yOf(v);
          return (
            <g key={i}>
              <line
                x1={PADDING.left}
                x2={w - PADDING.right}
                y1={y}
                y2={y}
                stroke="var(--line-1)"
                strokeWidth="0.5"
              />
              <text
                x={PADDING.left - 6}
                y={y + 3}
                fontSize="9"
                textAnchor="end"
                fill="var(--fg-4)"
                fontFamily="var(--font-mono)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </text>
            </g>
          );
        })}

        {/* X tick labels */}
        {xTicks.map((p, i) => {
          const x = xOf(p.ts);
          const d = new Date(p.ts);
          const label = d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
          return (
            <text
              key={i}
              x={x}
              y={height - 6}
              fontSize="9"
              textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
              fill="var(--fg-4)"
              fontFamily="var(--font-mono)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {label}
            </text>
          );
        })}

        {/* Seed NAV anchor line */}
        {seedY != null && (
          <g>
            <line
              x1={PADDING.left}
              x2={w - PADDING.right}
              y1={seedY}
              y2={seedY}
              stroke="var(--fg-4)"
              strokeDasharray="3 3"
              strokeWidth="1"
              opacity="0.7"
            />
            <text
              x={w - PADDING.right - 4}
              y={seedY - 4}
              fontSize="9"
              textAnchor="end"
              fill="var(--fg-3)"
              fontFamily="var(--font-mono)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {anchorLabel}
            </text>
          </g>
        )}

        {/* Area + line */}
        <path d={areaPath} fill="url(#equity-area)" />
        <path
          d={path}
          fill="none"
          stroke="var(--gold)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Hover crosshair */}
        {hover && (
          <g>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PADDING.top}
              y2={height - PADDING.bottom}
              stroke="var(--fg-3)"
              strokeWidth="0.8"
              strokeDasharray="2 3"
              opacity="0.6"
            />
            <circle
              cx={hoverX}
              cy={hoverY}
              r="3.5"
              fill="var(--gold)"
              stroke="var(--bg-0)"
              strokeWidth="1.5"
            />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hover && (
        <div
          className="card"
          style={{
            position: "absolute",
            left: tipLeft,
            top: 8,
            padding: "8px 10px",
            minWidth: 168,
            pointerEvents: "none",
            zIndex: 2,
            boxShadow: "0 2px 8px rgba(22,22,24,0.08)",
          }}
        >
          <div
            className="dim mono-tiny"
            style={{ fontSize: 9.5, marginBottom: 4 }}
          >
            {new Date(hover.ts).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--gold)",
              marginBottom: 6,
            }}
          >
            ${fmtUsdInline(hover.usd)}
            <span
              className="muted"
              style={{ fontSize: 10, fontWeight: 400, marginLeft: 4 }}
            >
              bUSD
            </span>
          </div>
          {hover.snap.components && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto",
                gap: "2px 10px",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <ComponentRow
                label="base"
                micros={hover.snap.components.baseUsdMicros}
                color="#d4a853"
              />
              <ComponentRow
                label="kamino"
                micros={hover.snap.components.kaminoUsdMicros}
                color="#5a8dee"
              />
              <ComponentRow
                label="solend"
                micros={hover.snap.components.solendUsdMicros}
                color="#2c8b79"
              />
              <ComponentRow
                label="perps"
                micros={hover.snap.components.perpsUsdMicros}
                color="#a78bfa"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ComponentRow({
  label,
  micros,
  color,
}: {
  label: string;
  micros: string;
  color: string;
}) {
  let usd = 0;
  try {
    usd = Number(BigInt(micros)) / 1_000_000;
  } catch {
    /* swallow */
  }
  return (
    <>
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span
          style={{
            display: "inline-block",
            width: 7,
            height: 7,
            borderRadius: 1.5,
            background: color,
          }}
        />
        <span style={{ color: "var(--fg-3)" }}>{label}</span>
      </span>
      <span style={{ color: "var(--fg-1)", textAlign: "right" }}>
        ${fmtUsdInline(usd)}
      </span>
    </>
  );
}

function fmtUsdInline(usd: number): string {
  return usd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
