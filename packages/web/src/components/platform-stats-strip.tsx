/**
 * Platform-wide stats strip — server component.
 *
 * Five-tile horizontal strip rendered above the top-performers strip on
 * the home feed. Surfaces the aggregate "the platform is real" numbers:
 *   1. active agents
 *   2. total TVL (USD, sum of latest nav per active agent)
 *   3. markets total + open
 *   4. 7d weighted platform NAV growth
 *   5. last-updated relative timestamp
 *
 * Data source: backend `/api/stats/platform` (in-process cached for 30s).
 * We mirror that on the Next side with a 30s revalidate so dev mode plus
 * production both pull fresh data at most twice a minute.
 *
 * Failure mode: empty / non-OK response renders a skeleton row of "—"
 * tiles rather than throwing — keeps the home page rendering even when
 * the backend is down.
 */
import { fmtReturnBps } from "@/lib/pnl";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://backend.solana.bundie.fi";

interface PlatformStats {
  agentsActive: number;
  agentsTotal: number;
  totalTvlLamports: string;
  marketsTotal: number;
  marketsOpen: number;
  marketsResolved: number;
  totalNavGrowth7dBps: number | null;
  generatedAt: string;
}

const EMPTY: PlatformStats = {
  agentsActive: 0,
  agentsTotal: 0,
  totalTvlLamports: "0",
  marketsTotal: 0,
  marketsOpen: 0,
  marketsResolved: 0,
  totalNavGrowth7dBps: null,
  generatedAt: new Date().toISOString(),
};

async function fetchPlatformStats(): Promise<PlatformStats> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/stats/platform`, {
      // Match the backend's 30s in-process cache; Next refreshes the
      // server component at the same cadence rather than per request.
      next: { revalidate: 30 },
    });
    if (!res.ok) return EMPTY;
    const body = (await res.json()) as Partial<PlatformStats>;
    return {
      agentsActive: body.agentsActive ?? 0,
      agentsTotal: body.agentsTotal ?? 0,
      totalTvlLamports: body.totalTvlLamports ?? "0",
      marketsTotal: body.marketsTotal ?? 0,
      marketsOpen: body.marketsOpen ?? 0,
      marketsResolved: body.marketsResolved ?? 0,
      totalNavGrowth7dBps: body.totalNavGrowth7dBps ?? null,
      generatedAt: body.generatedAt ?? new Date().toISOString(),
    };
  } catch {
    return EMPTY;
  }
}

/** bUSD lamports (6dp) → USD string with thousands separators + 2dp. */
function fmtTvlUsd(lamports: string): string {
  try {
    // BigInt division loses sub-dollar resolution; instead split into whole
    // dollars + 2dp cents while keeping bigint precision for the integer
    // part (TVL can grow past 2^53 in theory, even if not soon on devnet).
    const n = BigInt(lamports);
    const whole = n / 1_000_000n;
    const remainder = n % 1_000_000n;
    // Scale remainder to 2dp: divide by 10_000 (1e6 / 1e2 = 1e4) with
    // half-up rounding via +5_000.
    const cents = Number((remainder + 5_000n) / 10_000n);
    const wholeStr = whole.toLocaleString("en-US");
    const centsStr = cents.toString().padStart(2, "0");
    return `$${wholeStr}.${centsStr}`;
  } catch {
    return "—";
  }
}

/** "Xs ago" / "Xm ago" relative formatter for the last-updated tile. */
function relativeAgo(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

export async function PlatformStatsStrip() {
  const s = await fetchPlatformStats();

  const growth = s.totalNavGrowth7dBps;
  const growthLabel = growth == null ? "—" : fmtReturnBps(growth);
  const growthColor =
    growth == null
      ? "var(--de-ink-3)"
      : growth >= 0
        ? "var(--pos)"
        : "var(--de-rose)";

  return (
    <div
      style={{
        padding: "14px 16px",
        borderBottom: "1px solid var(--de-line)",
      }}
    >
      <div className="bd-eyebrow" style={{ marginBottom: 10 }}>
        Platform · live
      </div>
      <div
        className="platform-stats-grid"
        style={{
          display: "grid",
          // 4 stat tiles + a slim "last updated" tile on desktop. On mobile
          // the grid reflows to 2 columns and "last updated" tucks under.
          gridTemplateColumns: "repeat(2, minmax(0,1fr))",
          gap: 8,
        }}
      >
        <StatTile
          label="Live agents"
          value={`${s.agentsActive}`}
          sub={s.agentsActive === 1 ? "agent" : "agents"}
        />
        <StatTile
          label="Total TVL"
          value={fmtTvlUsd(s.totalTvlLamports)}
          sub="bUSD"
        />
        <StatTile
          label="Open markets"
          value={`${s.marketsOpen}`}
          sub={`open · ${s.marketsResolved} resolved`}
        />
        <StatTile
          label="7d platform NAV"
          value={growthLabel}
          color={growthColor}
        />
        <div
          className="platform-stats-updated"
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            justifyContent: "flex-end",
            fontSize: 10,
            color: "var(--de-ink-3)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
          }}
        >
          updated {relativeAgo(s.generatedAt)}
        </div>
      </div>

      {/* Reflow to 4-up on small+ screens; the "last updated" line stays
          full-width but right-aligns on every breakpoint. */}
      <style>{`
        @media (min-width: 640px) {
          .platform-stats-grid {
            grid-template-columns: repeat(4, minmax(0,1fr)) !important;
          }
        }
      `}</style>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="card" style={{ padding: "10px 12px", minWidth: 0 }}>
      <div className="bd-eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>
        {label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: color ?? "var(--de-ink)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.15,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
        {sub && (
          <span
            className="muted"
            style={{
              fontSize: 10.5,
              fontWeight: 400,
              marginLeft: 5,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}
