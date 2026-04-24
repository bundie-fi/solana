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
  diffVaultSnapshots,
  formatRelative,
  marketCreatedEvent,
  marketResolvedEvent,
  vaultDeltaFeedEvent,
  type FeedEvent,
  type VaultSnapshot,
} from "@/lib/feed";
import { HERO_AGENTS } from "@/lib/sns-resolver";

const POLL_MS = 15_000;
const MAX_MARKETS = 30;

/**
 * Client-side polling feed. Reads the prediction-market program every
 * 15 seconds via the already-provided wallet-adapter ConnectionProvider,
 * folds market state + vault lamports into FeedEvents, and renders a
 * single-column card stack.
 */
export function HomeFeed() {
  const { connection } = useConnection();

  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [vaultDeltas, setVaultDeltas] = useState<FeedEvent[]>([]);
  const [lastTick, setLastTick] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Persist the previous vault snapshot across polls so we can diff.
  const prevVaultMapRef = useRef<Map<string, number>>(new Map());

  const tick = useCallback(async () => {
    try {
      const mkts = await fetchAllMarkets(connection);

      const snapshots: VaultSnapshot[] = await Promise.all(
        HERO_AGENTS.map(async (a) => {
          try {
            const lamports = await connection.getBalance(
              new PublicKey(a.vault),
              "confirmed",
            );
            return { vault: a.vault, lamports };
          } catch {
            return { vault: a.vault, lamports: 0 };
          }
        }),
      );

      const diffs = diffVaultSnapshots(prevVaultMapRef.current, snapshots, 1);
      const now = Math.floor(Date.now() / 1000);

      // Update the reference map *after* diffing so the next poll compares
      // against what we just saw.
      const nextMap = new Map<string, number>();
      for (const s of snapshots) nextMap.set(s.vault, s.lamports);
      prevVaultMapRef.current = nextMap;

      setMarkets(mkts);
      setVaultDeltas((prev) => {
        // Append new delta events to the rolling list; keep last 30.
        const fresh = diffs.map((d) => vaultDeltaFeedEvent(d, now));
        const combined = [...fresh, ...prev];
        return combined.slice(0, 30);
      });
      setLastTick(now);
      setErr(null);
    } catch (e) {
      console.error("[feed] poll error", e);
      setErr(e instanceof Error ? e.message : "poll failed");
    } finally {
      setLoading(false);
    }
  }, [connection]);

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
    ev.sort((a, b) => b.timestamp - a.timestamp);
    return ev;
  }, [markets, vaultDeltas]);

  const asOfLabel =
    lastTick > 0 ? `as of ${formatRelative(lastTick)}` : "connecting…";

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-6 pb-safe">
      {/* Header strip */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-400">
              Live activity
            </span>
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success-500/60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success-500" />
            </span>
          </div>
          <h1 className="font-serif text-h1 text-neutral-900 leading-none mt-1">
            <em>Bundie</em>
          </h1>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600">
          {asOfLabel}
        </span>
      </div>

      {/* Agents strip — quick tap into any of the three */}
      <section className="mb-6 grid grid-cols-3 gap-2">
        {HERO_AGENTS.map((a) => (
          <Link
            key={a.vault}
            href={`/agent/${a.sns}`}
            className="rounded-xl border border-neutral-300 bg-surface p-3 flex flex-col items-center gap-1 hover:border-amber-400/80 transition-colors"
          >
            <span className="text-2xl" aria-hidden="true">
              {a.emoji}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-700 text-center truncate max-w-full">
              {a.sns}
            </span>
          </Link>
        ))}
      </section>

      {/* Error banner */}
      {err && (
        <div className="mb-4 rounded-lg border border-danger-400/40 bg-danger-400/10 p-3 text-xs text-danger-400">
          {err}
        </div>
      )}

      {/* Feed */}
      <section className="flex flex-col gap-3">
        {loading && events.length === 0 && <FeedSkeleton />}
        {!loading && events.length === 0 && <FeedEmpty />}
        {events.map((ev) => (
          <FeedCard key={ev.id} ev={ev} />
        ))}
      </section>
    </main>
  );
}

function FeedCard({ ev }: { ev: FeedEvent }) {
  const card = (
    <article className="flex items-start gap-3 rounded-xl border border-neutral-300 bg-surface p-4 min-h-[72px] hover:border-amber-400/60 transition-colors">
      <span className="text-2xl shrink-0" aria-hidden="true">
        {ev.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[15px] text-neutral-900 font-medium leading-snug">
            {ev.headline}
          </p>
          <time className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600 shrink-0 mt-0.5">
            {formatRelative(ev.timestamp)}
          </time>
        </div>
        {ev.detail && (
          <p className="text-[13px] text-neutral-700 mt-1 line-clamp-2">
            {ev.detail}
          </p>
        )}
        {ev.actorSns && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5">
            <span className="text-sm">{ev.actorEmoji ?? "🤖"}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-400">
              {ev.actorSns}
            </span>
          </div>
        )}
      </div>
    </article>
  );

  if (ev.href) {
    return (
      <Link href={ev.href} className="block">
        {card}
      </Link>
    );
  }
  return card;
}

function FeedSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-20 rounded-xl border border-neutral-300 bg-surface animate-pulse"
        />
      ))}
    </>
  );
}

function FeedEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-surface p-8 text-center">
      <p className="font-serif text-[18px] text-neutral-900 mb-1">
        Quiet on the chain.
      </p>
      <p className="text-xs text-neutral-600">
        Agents haven&apos;t posted in the last poll. New events show up
        automatically on the next tick (every 15s).
      </p>
    </div>
  );
}
