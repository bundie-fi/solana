"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { fetchAllMarkets, type MarketView } from "@/lib/markets";
import {
  fetchRegisteredAgents,
  type RegisteredAgent,
} from "@/lib/registry";
import { AgentAvatar, resolveAgentKey } from "@/components/agent-avatar";

const POLL_MS = 30_000;

/**
 * Leaderboard row shape — derived from the registered-agent record so we
 * decouple from `HERO_AGENTS` (which is now a label-rendering fallback,
 * not a source of truth for "which agents exist").
 */
interface LeaderboardAgent {
  sns: string;
  vault: string;
  emoji: string;
  /** One-line strategy handle surfaced on the leaderboard card. */
  strategyHandle: string;
}

function toLeaderboardAgent(a: RegisteredAgent): LeaderboardAgent {
  return {
    sns: a.sns,
    vault: a.vault_pda,
    emoji: a.emoji ?? "🤖",
    strategyHandle: a.display_name || a.sns.split(".")[0] || "agent",
  };
}

interface AgentStats {
  sol: number | null;
  marketsCreated: number;
  marketsOnMe: number;
  accuracy: number | null;
  resolvedCount: number;
}

// Mock NAV trend data (design system default)
const NAV_TRENDS: Record<string, number[]> = {
  "alice.bundie": [100,102,98,103,108,105,112,118,115,120,123,127,124,128,131,127,130,135,132,138,135,140,138,142,144,141,148,145,150,127],
  "bob.bundie":   [100,103,107,104,110,113,109,115,120,117,122,118,123,125,121,127,124,128,121,126,118,123,116,121,114,118,108,112,104,84],
  "charlie.bundie":[100,99,101,100,103,102,104,103,101,99,102,100,98,99,97,95,98,96,99,97,94,96,93,95,91,93,89,91,88,57],
};

const ARCHETYPES: Record<string, string> = {
  "alice.bundie":   "LST ROTATION",
  "bob.bundie":     "BASIS TRADE",
  "charlie.bundie": "CONSERVATIVE 60/40",
};

export function AgentLeaderboard() {
  const { connection } = useConnection();
  const [agents, setAgents] = useState<LeaderboardAgent[]>([]);
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [sol, setSol] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);

  // Pull the registered agent list once on mount. Subsequent polls reuse
  // the list — agents are added via the wizard, not minute-scale, so
  // re-polling /api/agents every 30s is wasteful. Empty set on registry
  // failure renders the empty leaderboard, by design.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const regs = await fetchRegisteredAgents();
      if (cancelled) return;
      setAgents(regs.map(toLeaderboardAgent));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build the allowed-creator set whenever `agents` changes; pass it into
  // every market read so the leaderboard's per-agent stats can never get
  // padded by markets created by an unregistered (zombie) agent against
  // a registered one.
  const allowedCreators = new Set(agents.map((a) => a.vault));

  const tick = useCallback(async () => {
    try {
      const [mkts, solEntries] = await Promise.all([
        fetchAllMarkets(connection, { allowedCreators }),
        Promise.all(
          agents.map(async (a) => {
            try {
              const lamports = await connection.getBalance(
                new PublicKey(a.vault),
                "confirmed",
              );
              return [a.vault, lamports / LAMPORTS_PER_SOL] as const;
            } catch {
              return [a.vault, null] as const;
            }
          }),
        ),
      ]);
      setMarkets(mkts);
      setSol(Object.fromEntries(solEntries));
    } finally {
      setLoading(false);
    }
    // `allowedCreators` is derived from `agents`, so depending on `agents`
    // is sufficient — adding the set to the dep array would cause a fresh
    // identity every render and re-tick on every `setMarkets`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, agents]);

  useEffect(() => {
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [tick]);

  function statsFor(a: LeaderboardAgent): AgentStats {
    const created = markets.filter((m) => m.createdBy === a.vault);
    const onMe = markets.filter(
      (m) => m.kind === 2 && m.targetAgent === a.vault,
    );
    const resolvedByThem = created.filter((m) => m.status === "resolved");
    const accuracy =
      resolvedByThem.length === 0
        ? null
        : resolvedByThem.filter((m) => m.outcome === "no").length /
          resolvedByThem.length;
    return {
      sol: sol[a.vault] ?? null,
      marketsCreated: created.length,
      marketsOnMe: onMe.length,
      accuracy,
      resolvedCount: resolvedByThem.length,
    };
  }

  if (!loading && agents.length === 0) {
    return (
      <div
        style={{
          padding: "32px 16px",
          textAlign: "center",
          border: "1px dashed var(--line-2)",
          borderRadius: 12,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            color: "var(--fg-0)",
            letterSpacing: "-0.015em",
            marginBottom: 6,
          }}
        >
          No agents registered yet.
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Once an agent ships through the wizard, it shows up here. Check back
          shortly.
        </div>
      </div>
    );
  }

  return (
    <div className="card-stack">
      {agents.map((a, i) => (
        <AgentCard
          key={a.vault}
          agent={a}
          stats={statsFor(a)}
          loading={loading}
          rank={i + 1}
        />
      ))}
    </div>
  );
}

function AgentCard({
  agent,
  stats,
  loading,
  rank,
}: {
  agent: LeaderboardAgent;
  stats: AgentStats;
  loading: boolean;
  rank: number;
}) {
  const agentKey = resolveAgentKey(agent.sns);
  const navTrend = NAV_TRENDS[agent.sns] ?? [];
  const archetype = ARCHETYPES[agent.sns] ?? agent.strategyHandle;

  // Compute mock NAV bps from trend data
  const navBps = navTrend.length > 0
    ? Math.round(navTrend[navTrend.length - 1] - 100)
    : 0;
  const positive = navBps >= 0;

  return (
    <Link href={`/agent/${agent.sns}`} style={{ display: "block", textDecoration: "none" }}>
      <div className="card" style={{ padding: 16, position: "relative", overflow: "hidden" }}>
        {/* Rank glyph */}
        <div
          className="mono-tiny dim"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            fontSize: 10,
            letterSpacing: "0.18em",
          }}
        >
          #{String(rank).padStart(2, "0")}
        </div>

        {/* Avatar + name row */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
          {agentKey ? (
            <AgentAvatar agent={agentKey} size={52} beat delay={rank * 0.3} />
          ) : (
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "var(--bg-2)",
                border: "1px solid var(--line-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                flexShrink: 0,
              }}
            >
              {agent.emoji}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="mono gold" style={{ fontSize: 13.5, fontWeight: 500 }}>
              {agent.sns}
            </span>
            <span className="pill pill-gold" style={{ alignSelf: "flex-start", padding: "3px 8px", fontSize: 9 }}>
              {archetype}
            </span>
          </div>
        </div>

        {/* NAV row */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
            <span className="bd-eyebrow" style={{ fontSize: 9 }}>NAV vs benchmark</span>
            {loading && stats.sol === null ? (
              <div className="skeleton" style={{ height: 28, width: 80, borderRadius: 4 }} />
            ) : (
              <span
                className="mono"
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  color: positive ? "var(--green-2)" : "var(--red-2)",
                }}
              >
                {positive ? "+" : ""}{navBps}
                <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>bps</span>
              </span>
            )}
          </div>
          {navTrend.length > 1 && (
            <NavSparkline
              data={navTrend}
              color={positive ? "var(--gold)" : "var(--red-2)"}
              width={96}
              height={32}
            />
          )}
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px solid var(--line-1)",
            paddingTop: 12,
          }}
        >
          <StatItem
            label="Markets"
            value={loading ? "…" : stats.marketsCreated.toString()}
          />
          <StatItem
            label="On me"
            value={loading ? "…" : stats.marketsOnMe.toString()}
            accent="purple"
          />
          <StatItem
            label="Accuracy"
            value={
              loading
                ? "…"
                : stats.accuracy === null
                ? "—"
                : `${Math.round(stats.accuracy * 100)}%`
            }
          />
          <StatItem
            label="Balance"
            value={
              loading
                ? "…"
                : stats.sol === null
                ? "—"
                : `${stats.sol.toFixed(3)} SOL`
            }
          />
        </div>
      </div>
    </Link>
  );
}

function StatItem({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      <span className="bd-eyebrow" style={{ fontSize: 9 }}>{label}</span>
      <span
        className="mono"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: accent === "purple" ? "var(--purple)" : "var(--fg-0)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function NavSparkline({
  data,
  color = "var(--gold)",
  width = 96,
  height = 32,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y];
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} style={{ overflow: "visible", flexShrink: 0 }}>
      <line
        x1="0"
        y1={height / 2}
        x2={width}
        y2={height / 2}
        stroke="var(--line-2)"
        strokeDasharray="2 3"
        strokeWidth=".5"
      />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="nav-trace live"
      />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
      <circle cx={last[0]} cy={last[1]} r="4" fill={color} opacity=".25" />
    </svg>
  );
}
