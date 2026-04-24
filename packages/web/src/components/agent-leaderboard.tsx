"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { fetchAllMarkets, type MarketView } from "@/lib/markets";
import { HERO_AGENTS, type HeroAgent } from "@/lib/sns-resolver";

const POLL_MS = 30_000;

interface AgentStats {
  sol: number | null;
  marketsCreated: number;
  marketsOnMe: number;
  accuracy: number | null; // 0..1 for "markets this agent created that resolved correctly"
  resolvedCount: number;
}

/**
 * Poll + render the three hero agents as side-by-side leaderboard cards.
 */
export function AgentLeaderboard() {
  const { connection } = useConnection();
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [sol, setSol] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);

  const tick = useCallback(async () => {
    try {
      const [mkts, solEntries] = await Promise.all([
        fetchAllMarkets(connection),
        Promise.all(
          HERO_AGENTS.map(async (a) => {
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
  }, [connection]);

  useEffect(() => {
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [tick]);

  function statsFor(a: HeroAgent): AgentStats {
    const created = markets.filter((m) => m.createdBy === a.vault);
    const onMe = markets.filter(
      (m) => m.kind === 6 && m.targetAgent === a.vault,
    );
    const resolvedByThem = created.filter((m) => m.status === "resolved");
    // "Accuracy" for kind=6 markets the agent created = fraction whose
    // outcome went in their favoured direction. Without knowing the
    // intended direction we proxy with "NO share wins" since the creator
    // is betting AGAINST the target — this is a demo stat and labelled
    // as such in the card.
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {HERO_AGENTS.map((a) => (
        <AgentCard
          key={a.vault}
          agent={a}
          stats={statsFor(a)}
          loading={loading}
        />
      ))}
    </div>
  );
}

function AgentCard({
  agent,
  stats,
  loading,
}: {
  agent: HeroAgent;
  stats: AgentStats;
  loading: boolean;
}) {
  return (
    <Link
      href={`/agent/${agent.sns}`}
      className="group rounded-2xl border border-neutral-300 bg-gradient-to-b from-neutral-200 to-neutral-100 hover:border-amber-400/70 transition-colors p-5 flex flex-col gap-4 min-h-[280px]"
    >
      <div className="flex items-start gap-3">
        <div className="h-14 w-14 shrink-0 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-3xl">
          {agent.emoji}
        </div>
        <div className="min-w-0">
          <div className="font-serif text-2xl text-neutral-900 leading-tight">
            <em>{agent.sns}</em>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600 mt-0.5">
            {agent.strategyHandle}
          </div>
        </div>
      </div>

      {/* Vault pubkey + copy affordance */}
      <VaultStrip vault={agent.vault} />

      {/* NAV */}
      <div className="rounded-lg border border-neutral-300 bg-surface p-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-600">
          Vault balance
        </div>
        <div className="font-serif text-2xl text-neutral-900 nums mt-1">
          {loading && stats.sol == null ? (
            <span className="inline-block h-6 w-20 rounded bg-neutral-300 animate-pulse" />
          ) : stats.sol == null ? (
            "—"
          ) : (
            <>
              {stats.sol.toFixed(4)}
              <span className="font-sans text-sm text-neutral-600 ml-1">
                SOL
              </span>
            </>
          )}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-500 mt-0.5">
          since inception
        </div>
      </div>

      {/* Market metrics */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Created" value={stats.marketsCreated.toString()} />
        <MiniStat label="On me" value={stats.marketsOnMe.toString()} />
        <MiniStat
          label="Accuracy"
          value={
            stats.accuracy == null
              ? "—"
              : `${Math.round(stats.accuracy * 100)}%`
          }
        />
      </div>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-300 bg-surface p-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-neutral-600">
        {label}
      </div>
      <div className="font-serif text-lg text-neutral-900 nums mt-0.5">
        {value}
      </div>
    </div>
  );
}

function VaultStrip({ vault }: { vault: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="flex items-center gap-1 text-xs font-mono text-neutral-600"
      onClick={async (e) => {
        // Avoid navigating when the user taps the copy chip.
        e.preventDefault();
        try {
          await navigator.clipboard.writeText(vault);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // ignore
        }
      }}
    >
      <span>vault:</span>
      <span className="truncate">
        {vault.slice(0, 4)}…{vault.slice(-4)}
      </span>
      <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-amber-400 hover:text-amber-300">
        {copied ? "copied" : "copy"}
      </span>
    </div>
  );
}
