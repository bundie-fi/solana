/**
 * Discover home — top strategies list (server component).
 *
 * Shape per row, matching the redesign's AgentRow:
 *   [ gradient avatar ] · handle.bundie.sol [verified✓] · TVL · markets
 *                                               sparkline · 30d return
 *
 * Pure render — server-side only, no polling. Caller (`/page.tsx`) fans out
 * /api/agents/:sns/pnl in parallel and feeds the resulting rows in.
 */
import Link from "next/link";

export interface DiscoverAgentRow {
  sns: string;
  displayName: string;
  avatarSeed: number;
  currentNavMicros: number | null;
  return30dPct: number | null;
  series: number[]; // NAV series in USD
  marketCount: number;
  snsVerified: boolean;
}

export function DiscoverAgentList({ rows }: { rows: DiscoverAgentRow[] }) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--de-ink-4)", fontSize: 12.5 }}>
        Live strategies will appear here once the chaos-sim ticks devnet.
      </div>
    );
  }
  return (
    <div style={{ borderTop: "1px solid var(--de-line)" }}>
      {rows.map((r) => (
        <AgentRow key={r.sns} row={r} />
      ))}
    </div>
  );
}

function AgentRow({ row }: { row: DiscoverAgentRow }) {
  const pos = (row.return30dPct ?? 0) >= 0;
  const color = pos ? "var(--pos)" : "var(--neg)";
  const tvl = row.currentNavMicros ? row.currentNavMicros / 1e6 : null;
  return (
    <Link
      href={`/agent/${encodeURIComponent(row.sns)}`}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", borderBottom: "1px solid var(--de-line)",
        textDecoration: "none", color: "var(--de-ink)",
      }}
    >
      <Avatar seed={row.avatarSeed} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.1 }}>
            {row.displayName}
            <span style={{ color: "var(--de-ink-4)", fontWeight: 400 }}>.bundie.sol</span>
          </span>
          {row.snsVerified && (
            <span style={{ fontSize: 11, color: "var(--predict)", fontWeight: 700 }}>✓</span>
          )}
        </div>
        <div
          className="mono"
          style={{
            display: "flex", gap: 8, fontSize: 11,
            color: "var(--de-ink-4)", marginTop: 2, fontVariantNumeric: "tabular-nums",
          }}
        >
          {tvl != null && <span>{fmtUsd(tvl)} TVL</span>}
          {tvl != null && <span>·</span>}
          <span>
            {row.marketCount} {row.marketCount === 1 ? "market" : "markets"}
          </span>
        </div>
      </div>
      <div style={{ width: 64, height: 28 }}>
        <Sparkline data={row.series} width={64} height={28} color={color} strokeWidth={1.25} />
      </div>
      <div style={{ minWidth: 60, textAlign: "right" }}>
        <div
          className="mono"
          style={{
            fontSize: 14, fontWeight: 600, color,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {row.return30dPct != null
            ? `${pos ? "+" : ""}${row.return30dPct.toFixed(1)}%`
            : "—"}
        </div>
        <div style={{ fontSize: 10, color: "var(--de-ink-4)", marginTop: 2 }}>30d</div>
      </div>
    </Link>
  );
}

function Avatar({ seed, size = 44 }: { seed: number; size?: number }) {
  const palettes: [string, string][] = [
    ["#A78BFA", "#5B3FB6"],
    ["#C4B1FF", "#7654D8"],
    ["#8867E8", "#3A1F8A"],
    ["#B39BFF", "#634BB0"],
  ];
  const p = palettes[seed % palettes.length];
  const rot = (seed * 47) % 360;
  const shape = seed % 4;
  const gid = `dlist-${seed}`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ borderRadius: 8, display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p[0]} />
          <stop offset="100%" stopColor={p[1]} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="8" fill={`url(#${gid})`} />
      <g transform={`rotate(${rot} 20 20)`} opacity="0.85">
        {shape === 0 && <circle cx="20" cy="14" r="9" fill="#fff" opacity="0.32" />}
        {shape === 1 && <rect x="6" y="6" width="14" height="28" fill="#fff" opacity="0.28" />}
        {shape === 2 && <polygon points="20,4 36,30 4,30" fill="#fff" opacity="0.32" />}
        {shape === 3 && <rect x="4" y="18" width="32" height="4" fill="#fff" opacity="0.4" />}
      </g>
      <rect x="0.5" y="0.5" width="39" height="39" rx="7.5" fill="none" stroke="rgba(0,0,0,0.06)" />
    </svg>
  );
}

function Sparkline({
  data, width = 64, height = 28, color = "var(--predict)", strokeWidth = 1.25,
}: {
  data: number[]; width?: number; height?: number; color?: string; strokeWidth?: number;
}) {
  if (!data || data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rawSpan = max - min;
  // When NAV hasn't moved at all (brand-new agents, or one that hasn't
  // made a single trade yet), the original "span || 1" math drew the
  // line at y=height-4 (the chart floor) where it visually disappears.
  // Center it instead so users can still see the agent has data — just
  // no movement.
  const flat = rawSpan === 0;
  const span = rawSpan || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => [
    i * stepX,
    flat ? height / 2 : height - 4 - ((v - min) / span) * (height - 8),
  ]);
  const path = pts
    .map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`))
    .join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
