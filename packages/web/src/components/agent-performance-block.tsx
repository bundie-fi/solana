/**
 * Agent profile P&L block — server component.
 *
 * Read by both creators (their own profile) and bettors (someone else's).
 * Surface treatment is gold-side because the block lives on the agent
 * page; positive / negative returns get green / red.
 *
 * Data source: `/api/agents/:sns/pnl?range=7d|30d|all` (backend route).
 * Fails open — empty snapshots render an empty-state card; null stats
 * render as "—". The block never throws.
 *
 * Range toggle is implemented as `<Link>` pills that update the
 * `?range=` searchParam, so the entire block re-renders SSR with fresh
 * data. No client fetch.
 */
import Link from "next/link";
import { fetchAgentPnl, fmtReturnBps, fmtDrawdownBps, fmtUsd, microsToUsd, type PnlRange } from "@/lib/pnl";
import { AgentEquityChart } from "@/components/agent-equity-chart";
import { ProtocolExposureBar } from "@/components/protocol-exposure-bar";

interface AgentPerformanceBlockProps {
  sns: string;
  range: PnlRange;
}

const RANGES: Array<{ key: PnlRange; label: string }> = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "all", label: "ALL" },
];

export async function AgentPerformanceBlock({
  sns,
  range,
}: AgentPerformanceBlockProps) {
  const pnl = await fetchAgentPnl(sns, range);

  const currentUsd = microsToUsd(pnl.stats.currentNavLamports);
  const r7 = pnl.stats.return7dBps;
  const r30 = pnl.stats.return30dBps;
  const rAll = pnl.stats.returnAllTimeBps;
  const dd = pnl.stats.maxDrawdownBps;
  const winRate = pnl.stats.winRatePct ?? null;
  const sharpe = pnl.stats.sharpeApprox ?? null;

  // "since {date}" caption under the all-time stat, sourced from the
  // first nav_snapshot's ts. Falls back to "—" if we don't have one.
  const startedAt = pnl.stats.startingTs
    ? new Date(pnl.stats.startingTs)
    : null;
  const sinceLabel =
    startedAt && Number.isFinite(startedAt.getTime())
      ? `since ${startedAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}`
      : null;

  // Protocol-exposure breakdown only lives on snapshots[] rows. `pnl.current`
  // is the bare {navLamports, epoch, ts} from the on-chain vault read and
  // has no components — fall back to the latest snapshot for the bar.
  const latestSnap = pnl.snapshots.length > 0
    ? pnl.snapshots[pnl.snapshots.length - 1]
    : null;

  return (
    <section
      style={{
        padding: "16px",
        borderBottom: "1px solid var(--line-1)",
      }}
    >
      {/* Header + range toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div className="bd-eyebrow">Performance</div>
        <div
          role="tablist"
          aria-label="Time range"
          style={{
            display: "inline-flex",
            gap: 0,
            background: "var(--bg-3)",
            border: "1px solid var(--line-1)",
            borderRadius: 999,
            padding: 2,
          }}
        >
          {RANGES.map((r) => {
            const active = r.key === range;
            return (
              <Link
                key={r.key}
                href={`?range=${r.key}`}
                scroll={false}
                role="tab"
                aria-selected={active}
                className="mono"
                style={{
                  padding: "5px 12px",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  borderRadius: 999,
                  textDecoration: "none",
                  background: active ? "var(--gold)" : "transparent",
                  color: active ? "#fff" : "var(--fg-3)",
                  fontWeight: active ? 600 : 500,
                  transition: "background 120ms ease, color 120ms ease",
                }}
              >
                {r.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Stats grid — 2-col on mobile (3+2 wrap), 5-up on sm+. The
          all-time stat is the most honest "is this agent good" number
          for short-history agents, so we surface it next to current NAV. */}
      <div
        className="perf-stats-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <PerfStat
          label="Current NAV"
          value={currentUsd != null ? `$${fmtUsd(currentUsd)}` : "—"}
          sub="bUSD"
        />
        <PerfStat
          label="All-time return"
          value={fmtReturnBps(rAll)}
          tone={tone(rAll)}
          caption={sinceLabel}
        />
        <PerfStat
          label="7d return"
          value={fmtReturnBps(r7)}
          tone={tone(r7)}
        />
        <PerfStat
          label="30d return"
          value={fmtReturnBps(r30)}
          tone={tone(r30)}
        />
        <PerfStat
          label="Max drawdown"
          value={dd > 0 ? fmtDrawdownBps(dd) : "—"}
          tone={dd > 0 ? "neg" : "neutral"}
        />
        <PerfStat
          label="Win rate"
          value={winRate != null ? `${winRate.toFixed(0)}%` : "—"}
          tone="neutral"
          caption={winRate != null ? "ticks closed positive" : null}
        />
        <PerfStat
          label="Sharpe (ann.)"
          value={sharpe != null ? sharpe.toFixed(2) : "—"}
          tone={sharpe != null ? (sharpe >= 1 ? "pos" : sharpe < 0 ? "neg" : "neutral") : "neutral"}
          caption={sharpe != null ? "annualized from tick cadence" : null}
        />
      </div>

      {/* Equity curve */}
      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 8,
          }}
        >
          <div className="bd-eyebrow" style={{ fontSize: 9 }}>
            Equity curve · {range.toUpperCase()}
          </div>
          <div className="dim mono-tiny" style={{ fontSize: 10.5 }}>
            {pnl.snapshots.length} snapshot{pnl.snapshots.length === 1 ? "" : "s"}
          </div>
        </div>
        <AgentEquityChart
          snapshots={pnl.snapshots}
          seedNavLamports={pnl.stats.seedNavLamports}
          startingNavLamports={pnl.stats.startingNavLamports}
        />
      </div>

      {/* Protocol exposure (latest snapshot only) */}
      {latestSnap?.components && (
        <div className="card" style={{ padding: 12 }}>
          <div
            className="bd-eyebrow"
            style={{ fontSize: 9, marginBottom: 10 }}
          >
            Protocol exposure · current
          </div>
          <ProtocolExposureBar components={latestSnap.components} />
        </div>
      )}

      {/* Inline reflow rule — promotes 2-col (3+2 wrap) → 5-up at sm.
          Scoped here to avoid bloating globals.css. */}
      <style>{`
        @media (min-width: 640px) {
          .perf-stats-grid {
            grid-template-columns: repeat(5, 1fr) !important;
          }
        }
      `}</style>
    </section>
  );
}

function tone(bps: number | null): "pos" | "neg" | "neutral" {
  if (bps == null) return "neutral";
  if (bps > 0) return "pos";
  if (bps < 0) return "neg";
  return "neutral";
}

function PerfStat({
  label,
  value,
  sub,
  tone,
  caption,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg" | "neutral";
  /** Optional small caption underneath the value (e.g. "since May 2"). */
  caption?: string | null;
}) {
  let color = "var(--fg-0)";
  // Brand: positive returns gold, negative red. Neutral = default fg.
  if (tone === "pos") color = "var(--pos)";
  if (tone === "neg") color = "var(--red-2)";

  return (
    <div className="card" style={{ padding: "10px 12px" }}>
      <div className="bd-eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>
        {label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 18,
          fontWeight: 600,
          color,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.15,
        }}
      >
        {value}
        {sub && (
          <span
            className="muted"
            style={{ fontSize: 11, fontWeight: 400, marginLeft: 4 }}
          >
            {sub}
          </span>
        )}
      </div>
      {caption && (
        <div
          className="dim mono-tiny"
          style={{
            fontSize: 9,
            marginTop: 3,
            letterSpacing: "0.04em",
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}
