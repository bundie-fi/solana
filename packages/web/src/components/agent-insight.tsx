/**
 * AgentInsight — bettor-decision panel for the market detail page.
 *
 * Server component that fetches three independent signals in parallel
 * and renders a compact card with:
 *   1. NAV equity curve (30-day sparkline) — trajectory at a glance
 *   2. Recent decisions (last 5 brain actions) — what the agent is
 *      thinking right now, not just historical outcomes
 *   3. Position composition (current vault holdings) — concentration
 *      vs diversification, relevant for drawdown bets
 *
 * Used by the market detail page once per target agent (twice for kind=2
 * head-to-head where both agents need their own panel).
 *
 * Failure mode: each fetch fails open independently. A panel with all
 * three sections empty still renders the card frame so the layout
 * doesn't shift; sections individually render placeholders.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { fetchAgentPnl, microsToUsd, fmtReturnBps } from "@/lib/pnl";
import { PortfolioCompositionBar } from "@/components/portfolio-composition-bar";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000";

interface ActivityItem {
  actionType: string;
  reasoning: string | null;
  tickAt: string;
}

async function fetchAgentActivity(
  sns: string,
  limit = 5,
): Promise<ActivityItem[]> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/activity?agent=${encodeURIComponent(sns)}&limit=${limit}`,
      { next: { revalidate: 30 } },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { activity?: ActivityItem[] };
    return Array.isArray(body.activity) ? body.activity : [];
  } catch {
    return [];
  }
}

async function fetchVaultBalances(
  connection: Connection,
  vaultPda: string,
): Promise<{
  solLamports: number;
  tokenAccounts: Array<{ mint: string; uiAmount: number }>;
}> {
  try {
    const [sol, parsed] = await Promise.all([
      connection.getBalance(new PublicKey(vaultPda)),
      connection.getParsedTokenAccountsByOwner(new PublicKey(vaultPda), {
        programId: TOKEN_PROGRAM_ID,
      }),
    ]);
    const tokenAccounts = parsed.value
      .map((ta) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info = (ta.account.data as any).parsed?.info;
        return {
          mint: (info?.mint as string) ?? "",
          uiAmount: Number(info?.tokenAmount?.uiAmount ?? 0),
        };
      })
      .filter((t) => t.uiAmount > 0 && t.mint);
    return { solLamports: sol, tokenAccounts };
  } catch {
    return { solLamports: 0, tokenAccounts: [] };
  }
}

interface AgentInsightProps {
  /** Display SNS for the target vault (e.g. "alex.bundie.sol"). When
   *  null or empty, the panel renders a "no track record yet" frame
   *  rather than 404'ing the market page. */
  sns: string | null;
  /** Vault PDA whose token accounts are read for the composition bar.
   *  Required because PnL is keyed off SNS but holdings live on the
   *  PDA. */
  vaultPda: string | null;
  connection: Connection;
  /** Optional override label, e.g. "Maya" instead of the SNS prefix. */
  displayName?: string;
}

export async function AgentInsight({
  sns,
  vaultPda,
  connection,
  displayName,
}: AgentInsightProps) {
  if (!sns || !vaultPda) {
    return (
      <section
        style={{
          padding: 16,
          border: "1px solid var(--line-1)",
          borderRadius: 12,
          background: "var(--bg-1)",
        }}
      >
        <div className="bd-eyebrow" style={{ marginBottom: 6 }}>
          {displayName ?? "Target agent"}
        </div>
        <p style={{ fontSize: 12, color: "var(--fg-3)" }}>
          No registered SNS — track-record data unavailable for legacy / un-
          registered creators.
        </p>
      </section>
    );
  }

  const [pnl, activity, holdings] = await Promise.all([
    fetchAgentPnl(sns, "30d"),
    fetchAgentActivity(sns, 5),
    fetchVaultBalances(connection, vaultPda),
  ]);

  const series = pnl.snapshots
    .map((s) => microsToUsd(s.navLamports))
    .filter((v): v is number => v != null);

  const r7d = pnl.stats.return7dBps;
  const r30d = pnl.stats.return30dBps;
  const winRatePct = pnl.stats.winRatePct;

  return (
    <section
      style={{
        padding: 16,
        border: "1px solid var(--line-1)",
        borderRadius: 12,
        background: "var(--bg-1)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span className="bd-eyebrow">Target · {displayName ?? sns.split(".")[0]}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>
            {sns}
          </span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
          <Stat label="7d" value={r7d == null ? "—" : fmtReturnBps(r7d)} color={r7d != null && r7d >= 0 ? "var(--pos)" : r7d != null ? "var(--red-2)" : undefined} />
          <Stat label="30d" value={r30d == null ? "—" : fmtReturnBps(r30d)} color={r30d != null && r30d >= 0 ? "var(--pos)" : r30d != null ? "var(--red-2)" : undefined} />
          <Stat label="Win" value={winRatePct == null ? "—" : `${winRatePct.toFixed(0)}%`} />
        </div>
      </div>

      {/* NAV chart */}
      <div>
        <div className="bd-eyebrow" style={{ marginBottom: 6 }}>NAV · 30d</div>
        {series.length >= 2 ? (
          <NavChart data={series} />
        ) : (
          <div style={{ fontSize: 11, color: "var(--fg-3)" }}>
            Not enough history yet ({series.length} snapshot{series.length === 1 ? "" : "s"}).
          </div>
        )}
      </div>

      {/* Recent decisions */}
      <div>
        <div className="bd-eyebrow" style={{ marginBottom: 6 }}>Recent decisions</div>
        {activity.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--fg-3)" }}>No actions logged yet.</div>
        ) : (
          <ul style={{ display: "flex", flexDirection: "column", gap: 6, padding: 0, margin: 0, listStyle: "none" }}>
            {activity.map((a, i) => (
              <li
                key={`${a.tickAt}-${i}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: "var(--bg-0)",
                  border: "1px solid var(--line-1)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--predict)", letterSpacing: "0.06em" }}>
                    {a.actionType}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>
                    {relativeTime(a.tickAt)}
                  </span>
                </div>
                {a.reasoning && (
                  <p style={{ fontSize: 11, color: "var(--fg-2)", margin: 0, lineHeight: 1.35 }}>
                    {a.reasoning.length > 140 ? `${a.reasoning.slice(0, 140)}…` : a.reasoning}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Position composition */}
      <div>
        <div className="bd-eyebrow" style={{ marginBottom: 6 }}>Vault composition</div>
        <PortfolioCompositionBar
          solLamports={holdings.solLamports}
          tokenAccounts={holdings.tokenAccounts}
        />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-end" }}>
      <span className="mono" style={{ fontSize: 9, color: "var(--fg-4)", letterSpacing: "0.12em" }}>
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: color ?? "var(--fg-0)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Inline NAV chart — 80px tall, full width. Uses the same path-coord
 *  math as the discover-agent-list sparkline but scaled for the bigger
 *  card and with a soft fill underneath. */
function NavChart({ data }: { data: number[] }) {
  const width = 320;
  const height = 80;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min;
  const flat = span === 0;
  const usableSpan = span || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => [
    i * stepX,
    flat ? height / 2 : height - 6 - ((v - min) / usableSpan) * (height - 12),
  ]);
  const line = pts
    .map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`))
    .join(" ");
  // Fill area: line path + closing back to baseline.
  const fill = `${line} L${pts[pts.length - 1][0]},${height} L0,${height} Z`;
  const last = data[data.length - 1];
  const first = data[0];
  const direction = last >= first;
  const stroke = direction ? "var(--pos)" : "var(--red-2)";
  const fillCol = direction ? "rgba(31,158,106,0.10)" : "rgba(209,69,69,0.08)";
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block", overflow: "visible" }}
    >
      <path d={fill} fill={fillCol} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function relativeTime(iso: string): string {
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
