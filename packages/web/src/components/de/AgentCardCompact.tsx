/**
 * AgentCardCompact — the canonical "agent identity" badge for the dark
 * editorial surface.
 *
 * Used in:
 *   - leaderboard rows (full row, with metadata pills + sparkline slot)
 *   - market card creator badges (bare: avatar + handle only)
 *   - agent detail page header
 *
 * Two display modes:
 *   - mode="row"   → flex row with avatar, names, optional pills (default)
 *   - mode="badge" → inline minimal: avatar + display name only
 *
 * Avatar uses the same hash-seeded gradient logic as the legacy
 * `discover-agent-list.tsx` Avatar so identities stay visually stable across
 * old + new surfaces.
 *
 * Server-renderable. No client APIs; hover styling is CSS only.
 */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export interface AgentCardCompactProps {
  /** SNS handle (e.g. "kaito.bundie.sol"). Used as the row identity. */
  sns: string;
  /** Human-friendly name. Falls back to the SNS first segment. */
  displayName?: string;
  /** Stable avatar seed; pass `hashSeed(sns)` from the caller. */
  avatarSeed: number;
  /** SNS-verified checkmark. */
  snsVerified?: boolean;
  /** When true, renders as a clickable Link to /agent/[sns]. */
  href?: string;
  /** "row" | "badge". Default "row". */
  mode?: "row" | "badge";
  /** Avatar diameter. Default 32 in row mode, 22 in badge mode. */
  avatarSize?: number;
  /** Optional right-aligned content (sparkline + return — leaderboard slot). */
  trailing?: ReactNode;
  /** Optional metadata pills row (TVL, return, market count). */
  meta?: ReactNode;
  style?: CSSProperties;
}

export function AgentCardCompact({
  sns,
  displayName,
  avatarSeed,
  snsVerified,
  href,
  mode = "row",
  avatarSize,
  trailing,
  meta,
  style,
}: AgentCardCompactProps) {
  const size = avatarSize ?? (mode === "row" ? 32 : 22);
  const name = displayName || sns.split(".")[0] || "agent";
  const handleSuffix = sns.replace(name, "").replace(/^\./, "");

  const inner = (
    <>
      <DeAvatar seed={avatarSeed} size={size} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: mode === "row" ? 14 : 12.5,
              fontWeight: 500,
              color: "var(--de-ink)",
              letterSpacing: "-0.005em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: mode === "row" ? 11 : 10.5,
              color: "var(--de-ink-3)",
              letterSpacing: "0.02em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {handleSuffix ? `.${handleSuffix}` : ""}
          </span>
          {snsVerified && (
            <span
              aria-label="SNS verified"
              style={{
                fontSize: 11,
                color: "var(--de-lavender)",
                fontWeight: 700,
              }}
            >
              ✓
            </span>
          )}
        </div>
        {meta && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--de-ink-3)",
              letterSpacing: "0.02em",
              marginTop: 3,
              fontVariantNumeric: "tabular-nums",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {meta}
          </div>
        )}
      </div>
      {trailing}
    </>
  );

  const baseStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: mode === "row" ? 12 : 8,
    minWidth: 0,
    textDecoration: "none",
    color: "inherit",
    ...style,
  };

  if (href) {
    return (
      <Link
        href={href}
        style={baseStyle}
        className="de-agent-card-link"
      >
        {inner}
        <style>{`
          .de-agent-card-link { transition: opacity 160ms ease; }
          .de-agent-card-link:hover { opacity: 0.92; }
        `}</style>
      </Link>
    );
  }

  return <div style={baseStyle}>{inner}</div>;
}

/**
 * DeAvatar — gradient avatar tile for the dark editorial palette.
 *
 * Hash-seeded; stable across renders. Palette uses lavender gradients tuned
 * for the dark navy background — contrast stays readable, no neon spikes.
 */
export function DeAvatar({
  seed,
  size = 32,
}: {
  seed: number;
  size?: number;
}) {
  const palettes: [string, string][] = [
    ["#A899F5", "#5C49B8"],
    ["#BDB1F8", "#6B58D4"],
    ["#A8E6CF", "#3F8C73"],
    ["#E8C58A", "#8C6730"],
    ["#8AB6F0", "#3D6796"],
    ["#E8A5A5", "#8C5252"],
  ];
  const p = palettes[seed % palettes.length];
  const rot = (seed * 47) % 360;
  const shape = seed % 4;
  const gid = `de-av-${seed}`;
  const radius = Math.round(size / 5);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ borderRadius: radius, display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p[0]} />
          <stop offset="100%" stopColor={p[1]} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx={(radius * 40) / size} fill={`url(#${gid})`} />
      <g transform={`rotate(${rot} 20 20)`} opacity="0.78">
        {shape === 0 && <circle cx="20" cy="14" r="9" fill="#fff" opacity="0.32" />}
        {shape === 1 && <rect x="6" y="6" width="14" height="28" fill="#fff" opacity="0.26" />}
        {shape === 2 && <polygon points="20,4 36,30 4,30" fill="#fff" opacity="0.30" />}
        {shape === 3 && <rect x="4" y="18" width="32" height="4" fill="#fff" opacity="0.4" />}
      </g>
      <rect
        x="0.5"
        y="0.5"
        width="39"
        height="39"
        rx={(radius * 40) / size - 0.5}
        fill="none"
        stroke="rgba(0,0,0,0.18)"
      />
    </svg>
  );
}

/** Hash an SNS string to a stable seed. Mirrors the helper in legacy `page.tsx`. */
export function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
