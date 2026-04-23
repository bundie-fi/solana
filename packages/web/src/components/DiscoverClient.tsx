"use client";

import { useMemo, useState } from "react";
import type { StrategyDisplay } from "@bundie/common";
import { ProtocolCoverage } from "@/components/ProtocolCoverage";
import { SnsName } from "@/components/SnsName";
import { StrategyCard } from "@/components/StrategyCard";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/button";
import { Sparkline, synthSeries } from "@/components/ui/Sparkline";
import { Stat } from "@/components/ui/Stat";

type SortKey = "apy" | "tvl" | "investors";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "apy", label: "Top APY" },
  { key: "tvl", label: "Highest TVL" },
  { key: "investors", label: "Most backed" },
];

function sortStrategies(list: StrategyDisplay[], key: SortKey) {
  const arr = [...list];
  switch (key) {
    case "apy":
      return arr.sort((a, b) => b.apy - a.apy);
    case "tvl":
      return arr.sort((a, b) => b.tvl - a.tvl);
    case "investors":
      return arr.sort((a, b) => b.investorCount - a.investorCount);
  }
}

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function fmtDelta(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export function DiscoverClient({
  live,
  upcoming,
}: {
  live: StrategyDisplay[];
  upcoming: StrategyDisplay[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("apy");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StrategyDisplay | null>(null);

  const filteredLive = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? live.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.address.toLowerCase().includes(q) ||
            (s.creatorName ?? "").toLowerCase().includes(q)
        )
      : live;
    return sortStrategies(filtered, sortKey);
  }, [live, sortKey, query]);

  const showLive = live.length > 0;
  const bestApy = live.length ? Math.max(...live.map((s) => s.apy)) : 0;
  const totalTvl = live.reduce((sum, s) => sum + s.tvl, 0);
  const investors = live.reduce((sum, s) => sum + s.investorCount, 0);

  return (
    <>
      {/* ─── Hero ─── */}
      <section className="mb-8 md:mb-12">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400">
            Earn mode
          </span>
          <h1 className="font-serif text-display text-neutral-900">
            Discover <em className="text-amber-400">strategies</em>.
          </h1>
          <p className="text-body text-neutral-700 max-w-xl mt-2">
            Back live DeFi strategies on Solana. Your shares track portfolio
            value in real time. Sell any time.
          </p>
        </div>

        {/* Hero stats — calm row, tabular mono, only renders when we have live data */}
        {showLive && (
          <div className="mt-6 grid grid-cols-3 gap-3 md:max-w-xl">
            <Stat
              label="Best APY"
              value={bestApy > 0 ? `${bestApy.toFixed(1)}%` : "—"}
              tone="gold"
              align="left"
            />
            <Stat
              label="Total TVL"
              value={fmtMoney(totalTvl)}
              align="left"
            />
            <Stat label="Investors" value={investors} align="left" />
          </div>
        )}
      </section>

      {/* ─── Filters / search ─── */}
      <section className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-sm">
          <input
            type="search"
            placeholder="Search strategies, addresses, creators"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg bg-surface border border-neutral-300 px-4 h-11 text-sm placeholder:text-neutral-600 text-neutral-800 focus-gold focus:border-earn-gold/40 transition-colors duration-180"
            aria-label="Search strategies"
          />
        </div>

        <div
          role="tablist"
          aria-label="Sort strategies"
          className="flex items-center gap-1 rounded-lg bg-surface border border-neutral-300 p-1 overflow-x-auto"
        >
          {SORT_OPTIONS.map((opt) => {
            const active = sortKey === opt.key;
            return (
              <button
                key={opt.key}
                role="tab"
                aria-selected={active}
                onClick={() => setSortKey(opt.key)}
                className={[
                  "h-9 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors duration-180",
                  active
                    ? "bg-amber-600 text-neutral-900"
                    : "text-neutral-700 hover:text-neutral-800 hover:bg-neutral-200",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ─── Live strategies ─── */}
      {showLive ? (
        <section className="mb-12">
          <SectionHeader
            dotClassName="bg-success-400 animate-pulse"
            label="Live on devnet"
            count={filteredLive.length}
          />
          {filteredLive.length === 0 ? (
            <EmptyCard
              title="No matches"
              body={`Nothing for "${query}" yet. Try a different search.`}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLive.map((s) => (
                <StrategyCard
                  key={s.address}
                  strategy={s}
                  onClick={() => setSelected(s)}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="mb-12">
          <EmptyCard
            title="No live strategies yet"
            body="Nothing's launched on devnet at the moment. Preview the coming-soon line-up below."
          />
        </section>
      )}

      {/* ─── Coming soon (mocks) ─── */}
      <section>
        <SectionHeader label="Coming soon" count={upcoming.length} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {upcoming.map((s) => (
            <StrategyCard key={s.address} strategy={s} dimmed />
          ))}
        </div>
      </section>

      {/* ─── Drawer / detail sheet ─── */}
      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name}
        accent="gold"
      >
        {selected && <StrategyDetail strategy={selected} />}
      </Sheet>
    </>
  );
}

function SectionHeader({
  label,
  count,
  dotClassName,
}: {
  label: string;
  count?: number;
  dotClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {dotClassName && <span className={`w-2 h-2 rounded-full ${dotClassName}`} />}
      <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-600">
        {label}
      </h2>
      {typeof count === "number" && (
        <span className="text-xs font-mono nums text-neutral-600">
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-surface p-8 text-center">
      <p className="text-h3 text-neutral-800 font-semibold mb-1">{title}</p>
      <p className="text-sm text-neutral-700 max-w-md mx-auto">{body}</p>
    </div>
  );
}

function StrategyDetail({ strategy: s }: { strategy: StrategyDisplay }) {
  const series = synthSeries(s.performance);
  const day = s.performance.day;
  const dayTone = day >= 0 ? "text-success-400" : "text-danger-400";

  return (
    <div className="flex flex-col gap-6">
      {/* Hero value block */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600">
          APY
        </p>
        <p className="font-mono nums text-display text-earn-gold leading-none mt-1">
          {s.apy > 0 ? `${s.apy.toFixed(1)}%` : "—"}
        </p>
        <div className={`flex items-center gap-3 mt-3 ${dayTone}`}>
          <Sparkline data={series} width={160} height={36} strokeWidth={1.75} />
          <span className="font-mono nums text-sm">24h {fmtDelta(day)}</span>
        </div>
      </div>

      {/* Fast stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="TVL" value={fmtMoney(s.tvl)} />
        <Stat label="Investors" value={s.investorCount} />
        <Stat label="Share price" value={`$${s.sharePrice.toFixed(4)}`} />
      </div>

      {/* Performance windows */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-600 mb-3">
          Performance
        </h3>
        <div className="grid grid-cols-4 gap-2">
          {(["day", "week", "month", "all"] as const).map((k) => {
            const v = s.performance[k];
            const tone =
              v > 0 ? "text-success-400" : v < 0 ? "text-danger-400" : "text-neutral-700";
            return (
              <div
                key={k}
                className="rounded-lg border border-neutral-300 bg-neutral-50 p-3"
              >
                <p className="text-[10px] uppercase tracking-[0.08em] text-neutral-600">
                  {k === "all" ? "All" : k[0].toUpperCase() + k.slice(1)}
                </p>
                <p className={`font-mono nums text-sm font-semibold mt-1 ${tone}`}>
                  {fmtDelta(v)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Protocol coverage */}
      <ProtocolCoverage strategy={s.address} />

      {/* Meta */}
      <div className="rounded-xl border border-neutral-300 bg-neutral-50 p-4 flex flex-col gap-2 text-xs">
        {/* SNS-aware creator row. We render a SnsName when we have an
            authority pubkey on the strategy (almost always); fall back to
            the metadata creatorName when missing for any reason. */}
        {s.authority ? (
          <RowNode
            label="Created by"
            node={
              <SnsName
                addr={s.authority}
                head={6}
                tail={4}
                className="font-mono nums text-neutral-800"
              />
            }
          />
        ) : (
          <Row label="Created by" value={s.creatorName ?? "anonymous"} mono />
        )}
        <Row label="Protocol" value={truncate(s.protocol)} mono />
        <Row label="Token mint" value={truncate(s.mint)} mono />
        <Row label="Fee" value={`${(s.feeBps / 100).toFixed(2)}%`} />
        <Row
          label="Minimum deposit"
          value={`${Number(s.minDeposit) / 1e6} USDC`}
        />
      </div>

      {/* CTA row — links out to the existing full detail page */}
      <div className="flex flex-col-reverse sm:flex-row gap-3 sticky bottom-0 bg-neutral-200 pt-2 -mx-5 px-5 -mb-5 pb-5 border-t border-neutral-300">
        <a
          href={`/strategy/${s.address}`}
          className="inline-flex flex-1 items-center justify-center h-11 rounded-lg border border-neutral-300 text-neutral-700 hover:text-neutral-800 hover:bg-neutral-100 text-sm font-medium transition-colors duration-180"
        >
          View full page
        </a>
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          onClick={() => (window.location.href = `/strategy/${s.address}`)}
        >
          Back this strategy
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-neutral-600">{label}</span>
      <span
        className={`${mono ? "font-mono nums" : ""} text-neutral-800 text-right truncate`}
      >
        {value}
      </span>
    </div>
  );
}

function RowNode({ label, node }: { label: string; node: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-neutral-600">{label}</span>
      <span className="text-right truncate">{node}</span>
    </div>
  );
}

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
