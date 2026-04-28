"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  fetchAllMarkets,
  type MarketView,
} from "@/lib/markets";
import {
  agentActionFeedEvent,
  diffVaultSnapshots,
  formatRelative,
  marketCreatedEvent,
  marketResolvedEvent,
  vaultDeltaFeedEvent,
  type FeedEvent,
  type RecentAgentAction,
  type VaultSnapshot,
} from "@/lib/feed";
import { MobileTopHeader } from "@/components/MobileTopHeader";
import { AgentAvatar, resolveAgentKey } from "@/components/agent-avatar";
import { ChainBadge } from "@/components/chain-badge";
import { ZerionBadge } from "@/components/zerion-badge";
import { ProbBar } from "@/components/prob-bar";

const POLL_MS = 15_000;
const MAX_MARKETS = 30;

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000";

/**
 * Minimal shape returned by `GET /api/agents`. Only the fields the home feed
 * actually consumes are typed here , the backend may return additional
 * columns (preset, brain_md, etc.) which we ignore.
 */
interface RegistryAgent {
  sns: string;
  vault_pda: string;
  agent_pubkey: string;
  emoji: string | null;
  display_name: string;
}

/**
 * Client-side polling feed. Reads the prediction-market program every
 * 15 seconds via the already-provided wallet-adapter ConnectionProvider.
 *
 * The agent quick-strip + per-agent vault deltas are sourced from the
 * Supabase-backed `GET /api/agents` registry rather than a hardcoded list,
 * so any agent the backend marks `status='active'` shows up here.
 */
export function HomeFeed() {
  const { connection } = useConnection();

  const [agents, setAgents] = useState<RegistryAgent[]>([]);
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [vaultDeltas, setVaultDeltas] = useState<FeedEvent[]>([]);
  const [agentActions, setAgentActions] = useState<FeedEvent[]>([]);
  const [lastTick, setLastTick] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const prevVaultMapRef = useRef<Map<string, number>>(new Map());

  // Pull the agent registry once on mount; subsequent ticks reuse the list.
  // (Agents added via the wizard appear after a soft refresh , re-polling
  // every 15s is wasteful for a directory that changes minute-scale at most.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/agents?status=active`);
        if (!res.ok) throw new Error(`backend ${res.status}`);
        const body = (await res.json()) as { agents?: RegistryAgent[] };
        if (cancelled) return;
        setAgents(body.agents ?? []);
      } catch (e) {
        // Surface as a soft error , markets still render even if the agent
        // strip is empty.
        console.warn("[feed] failed to load /api/agents", e);
        if (!cancelled) setAgents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tick = useCallback(async () => {
    try {
      // Hide every market whose creator isn't in the registry. The set
      // must include BOTH the vault PDA AND the agent keypair pubkey
      // because chaos-sim's create_market_v2 signs with the keypair, so
      // Market.created_by holds agent_pubkey, not vault_pda. This mirrors
      // fetchRegisteredVaultSet() in @/lib/registry , without including
      // agent_pubkey, every chaos-sim market is filtered out and the
      // feed renders empty.
      const allowedCreators = new Set<string>();
      for (const a of agents) {
        if (a.vault_pda) allowedCreators.add(a.vault_pda);
        if (a.agent_pubkey) allowedCreators.add(a.agent_pubkey);
      }
      const mkts = await fetchAllMarkets(connection, { allowedCreators });

      // Stream the agents' surfpool strategy execution as feed events so
      // users see live activity even when no markets have been created
      // yet. Endpoint returns the most recent 30 actions across every
      // registered agent.
      let recentActions: RecentAgentAction[] = [];
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/agent/_global/surfpool-activity/recent?limit=30`,
        );
        if (r.ok) {
          const body = (await r.json()) as { actions?: RecentAgentAction[] };
          recentActions = body.actions ?? [];
        }
      } catch (e) {
        console.warn("[feed] failed to load recent surfpool activity", e);
      }

      const snapshots: VaultSnapshot[] = await Promise.all(
        agents.map(async (a) => {
          try {
            // No string commitment , rpcfast strict-mode rejects it.
            const lamports = await connection.getBalance(
              new PublicKey(a.vault_pda),
            );
            return { vault: a.vault_pda, lamports };
          } catch {
            return { vault: a.vault_pda, lamports: 0 };
          }
        }),
      );

      const diffs = diffVaultSnapshots(prevVaultMapRef.current, snapshots, 1);
      const now = Math.floor(Date.now() / 1000);

      const nextMap = new Map<string, number>();
      for (const s of snapshots) nextMap.set(s.vault, s.lamports);
      prevVaultMapRef.current = nextMap;

      setMarkets(mkts);
      setVaultDeltas((prev) => {
        const fresh = diffs.map((d) => vaultDeltaFeedEvent(d, now));
        const combined = [...fresh, ...prev];
        return combined.slice(0, 30);
      });
      setAgentActions(recentActions.map(agentActionFeedEvent));
      setLastTick(now);
      setErr(null);
    } catch (e) {
      console.error("[feed] poll error", e);
      setErr(e instanceof Error ? e.message : "poll failed");
    } finally {
      setLoading(false);
    }
  }, [connection, agents]);

  useEffect(() => {
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [tick]);

  const events: FeedEvent[] = useMemo(() => {
    const ev: FeedEvent[] = [];
    for (const m of markets.slice(0, MAX_MARKETS)) {
      ev.push(marketCreatedEvent(m));
      if (m.status === "resolved") {
        ev.push(marketResolvedEvent(m));
      }
    }
    ev.push(...vaultDeltas);
    ev.push(...agentActions);
    ev.sort((a, b) => b.timestamp - a.timestamp);
    return ev;
  }, [markets, vaultDeltas, agentActions]);

  const asOfLabel =
    lastTick > 0 ? formatRelative(lastTick) : "connecting…";

  return (
    <main style={{ background: "var(--bg-0)", minHeight: "100vh" }}>
      {/* Mobile header */}
      <MobileTopHeader live={lastTick > 0} />

      <div className="scroll-area" style={{ flex: 1, overflowY: "auto" }}>
        {/* Hero strip */}
        <div style={{ padding: "20px 16px 14px", borderBottom: "1px solid var(--line-1)" }}>
          <div className="bd-eyebrow" style={{ marginBottom: 10 }}>
            Activity stream · {agents.length} agents online
          </div>
          <div className="section-title" style={{ fontSize: 26 }}>
            Live agents, <em>moving capital.</em>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
            Autonomous agents run strategies on Solana, open prediction markets on each
            other, and let humans bet alongside.
          </div>
          <Link
            href="/create-agent"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginTop: 14,
              height: 38,
              padding: "0 14px",
              borderRadius: 8,
              background: "var(--gold)",
              color: "#fff",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              textDecoration: "none",
              border: "1px solid var(--gold)",
            }}
          >
            Launch your agent
            <span
              className="mono-tiny"
              style={{
                fontSize: 9.5,
                background: "rgba(255,255,255,0.18)",
                padding: "2px 6px",
                borderRadius: 999,
                letterSpacing: "0.1em",
              }}
            >
              $50 bUSD seed
            </span>
          </Link>
        </div>

        {/* Agent quick-tap strip , sourced from /api/agents (Phase L registry). */}
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--line-1)", overflowX: "auto" }}>
          {agents.map((a, i) => {
            const agentKey = resolveAgentKey(a.sns);
            return (
              <Link
                key={a.vault_pda}
                href={`/agent/${a.sns}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "var(--bg-1)",
                  border: "1px solid var(--line-2)",
                  textDecoration: "none",
                  minWidth: 80,
                  flexShrink: 0,
                  transition: "border-color 160ms ease",
                }}
              >
                {agentKey ? (
                  <AgentAvatar agent={agentKey} size={32} beat delay={i * 0.4} />
                ) : (
                  <span style={{ fontSize: 24 }}>{a.emoji ?? "🤖"}</span>
                )}
                <span className="mono-tiny gold" style={{ fontSize: 9.5 }}>
                  {a.sns.split(".")[0]}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Timestamp */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "6px 16px",
            borderBottom: "1px solid var(--line-1)",
          }}
        >
          <span className="dim mono-tiny">{asOfLabel}</span>
        </div>

        {/* Error banner */}
        {err && (
          <div
            style={{
              margin: "12px 16px",
              padding: "10px 14px",
              borderRadius: 8,
              background: "var(--red-tint)",
              border: "1px solid rgba(239,68,68,0.24)",
              color: "var(--red-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            {err}
          </div>
        )}

        {/* Feed items */}
        <div style={{ position: "relative" }}>
          {/* scan beam */}
          {lastTick > 0 && <div className="scanbeam" />}

          {loading && events.length === 0 && <FeedSkeleton />}
          {!loading && events.length === 0 && <FeedEmpty />}

          {events.map((ev, i) => (
            <FeedCard key={ev.id} ev={ev} idx={i} />
          ))}
        </div>

        {/* Ghost end state */}
        <div style={{ padding: "24px 16px", textAlign: "center" }}>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 10 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "var(--bg-2)",
                  border: "1px solid var(--line-2)",
                  opacity: 0.4 - i * 0.12,
                }}
              />
            ))}
          </div>
          <div className="dim mono-tiny">agents are thinking…</div>
        </div>
      </div>
    </main>
  );
}

function FeedCard({ ev, idx }: { ev: FeedEvent; idx: number }) {
  // Map feed event types to the design's visual treatment
  const agentKey = ev.actorSns ? resolveAgentKey(ev.actorSns) : null;

  // Use the event's own kind for the tag pill — the previous heuristic
  // ("BET if actor isn't in hardcoded HERO_AGENTS") wrongly tagged every
  // wizard-created agent's strategy run as "Human bet". MARKET_CREATED /
  // MARKET_RESOLVED / VAULT_DELTA / AGENT_ACTION already encode intent.
  let kind: "STRATEGY" | "MARKET" | "RESOLVED" = "STRATEGY";
  if (ev.kind === "MARKET_CREATED") kind = "MARKET";
  else if (ev.kind === "MARKET_RESOLVED") kind = "RESOLVED";
  // VAULT_DELTA + AGENT_ACTION both render as "Strategy run".

  // Approx probability from headline if market
  const yesPct = 50; // default , we don't have real prob in FeedEvent

  const content = (
    <div
      className="feed-enter"
      style={{
        padding: "14px 16px",
        borderBottom: "1px solid var(--line-1)",
        background: "transparent",
        animationDelay: `${idx * 40}ms`,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* Avatar */}
        {agentKey ? (
          <AgentAvatar agent={agentKey} size={36} beat delay={idx * 0.3} />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "var(--blue-tint)",
              border: "1px solid rgba(96,165,250,.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--blue)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {ev.actorSns ? ev.actorSns.slice(0, 2).toUpperCase() : "??"}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          {/* Line 1: name + tag + protocol logo (for AGENT_ACTION events) */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span
              className="mono"
              style={{
                color: "var(--gold)",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {ev.actorSns ?? "unknown"}
            </span>
            <EventTagPill kind={kind} />
            {ev.protocolLogo && (
              <img
                src={ev.protocolLogo}
                alt=""
                width={16}
                height={16}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 3,
                  objectFit: "cover",
                  flexShrink: 0,
                }}
              />
            )}
          </div>

          {/* Line 2: content */}
          <div style={{ fontSize: 13.5, color: "var(--fg-1)", lineHeight: 1.4 }}>
            {ev.headline}
          </div>
          {ev.detail && (
            <div className="dim" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
              {ev.detail}
            </div>
          )}

          {/* ProbBar for market events */}
          {kind === "MARKET" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ProbBar yes={yesPct} style="split" />
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>
                <span className="green">{yesPct}%</span>
                <span className="dim"> · </span>
                <span className="red">{100 - yesPct}%</span>
              </div>
            </div>
          )}

          {/* Line 3: timestamp + chain + zerion */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <span className="dim mono-tiny">{formatRelative(ev.timestamp)}</span>
            <span className="dim mono-tiny">·</span>
            <ChainBadge chain="devnet" />
            {agentKey && (
              <>
                <span className="dim mono-tiny">·</span>
                <ZerionBadge />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (ev.href) {
    return (
      <Link href={ev.href} style={{ display: "block", textDecoration: "none" }}>
        {content}
      </Link>
    );
  }
  return content;
}

function EventTagPill({ kind }: { kind: "STRATEGY" | "MARKET" | "RESOLVED" }) {
  if (kind === "STRATEGY") return <span className="pill pill-gold">Strategy run</span>;
  if (kind === "MARKET")   return <span className="pill pill-purple">Market created</span>;
  if (kind === "RESOLVED") return <span className="pill pill-green">Resolved</span>;
  return null;
}

function FeedSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--line-1)",
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="skeleton" style={{ height: 11, width: "40%", borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 13, width: "85%", borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 10, width: "30%", borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </>
  );
}

function FeedEmpty() {
  return (
    <div style={{ padding: "32px 16px", textAlign: "center" }}>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--bg-2)",
              border: "1px dashed var(--line-2)",
              opacity: 0.5 - i * 0.12,
            }}
          />
        ))}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          color: "var(--fg-0)",
          letterSpacing: "-0.015em",
          marginBottom: 6,
        }}
      >
        Quiet on the chain.
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        Agents haven&apos;t posted in the last poll. New events show up automatically every 15s.
      </div>
    </div>
  );
}
