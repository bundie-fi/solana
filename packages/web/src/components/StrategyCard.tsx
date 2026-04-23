"use client";

import type { StrategyDisplay } from "@bundie/common";
import { ProtocolCoverage } from "@/components/ProtocolCoverage";
import { SnsName } from "@/components/SnsName";
import { Sparkline, synthSeries } from "@/components/ui/Sparkline";

/**
 * Format helpers — kept local so the card renders the same way whether
 * it's triggered from server or client. All monetary/percent values use
 * mono + tabular-nums for column alignment (Coinbase/Kraken convention).
 */
function fmtApy(apy: number) {
  return apy > 0 ? `${apy.toFixed(1)}%` : "—";
}

function fmtTvl(tvl: number) {
  if (tvl >= 1_000_000) return `$${(tvl / 1_000_000).toFixed(2)}M`;
  if (tvl >= 1_000) return `$${(tvl / 1_000).toFixed(1)}k`;
  return `$${tvl.toFixed(0)}`;
}

function fmtDelta(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export function StrategyCard({
  strategy,
  onClick,
  dimmed = false,
  href,
}: {
  strategy: StrategyDisplay;
  onClick?: () => void;
  dimmed?: boolean;
  href?: string;
}) {
  const s = strategy;
  const series = synthSeries(s.performance);
  const day = s.performance.day;
  const dayTone = day >= 0 ? "text-success-400" : "text-danger-400";
  const statusStyles =
    s.status === "active"
      ? "bg-success-400/10 text-success-400"
      : s.status === "paused"
      ? "bg-warning-400/10 text-warning-400"
      : "bg-neutral-500/10 text-neutral-600";

  const content = (
    <article
      className={[
        "group relative flex flex-col rounded-xl border bg-surface p-5",
        "border-neutral-300 hover:border-amber-600/50",
        "transition-all duration-180 ease-out-quick",
        "hover:-translate-y-[1px] hover:shadow-pop",
        dimmed ? "opacity-40" : "",
      ].join(" ")}
    >
      {/* Header: name + status */}
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-serif text-[22px] leading-tight text-neutral-900 truncate">
            {s.name}
          </h3>
          {/* Strategy address: SNS-aware. The strategy itself rarely has a
              `.sol` (it's a PDA), so this almost always renders as the
              truncated pubkey — but we route through SnsName for symmetry
              with creator/trader rendering. */}
          <SnsName
            addr={s.address}
            head={6}
            tail={4}
            className="text-xs text-neutral-600 font-mono mt-0.5 block truncate"
          />
        </div>
        <span
          className={`font-mono text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-[0.1em] shrink-0 ${statusStyles}`}
        >
          {s.status}
        </span>
      </header>

      {/* Sparkline row: APY prominent, sparkline trails it */}
      <div className="flex items-end justify-between gap-3 mb-4">
        <div className="flex flex-col">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-600">
            APY
          </span>
          <span className="font-mono nums text-stat text-amber-400 leading-none">
            {fmtApy(s.apy)}
          </span>
        </div>
        <div className={`${dayTone} flex flex-col items-end`}>
          <Sparkline data={series} width={72} height={22} />
          <span className="font-mono nums text-[11px] mt-1">
            24h {fmtDelta(day)}
          </span>
        </div>
      </div>

      {/* Sub-stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-lg bg-neutral-0/40 border border-neutral-300 p-3">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-600">
            TVL
          </p>
          <p className="font-mono nums text-base font-semibold text-neutral-900 mt-0.5">
            {fmtTvl(s.tvl)}
          </p>
        </div>
        <div className="rounded-lg bg-neutral-0/40 border border-neutral-300 p-3">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-600">
            Investors
          </p>
          <p className="font-mono nums text-base font-semibold text-neutral-900 mt-0.5">
            {s.investorCount}
          </p>
        </div>
      </div>

      {/* Protocol coverage — which Beethoven protocols this strategy uses. */}
      <ProtocolCoverage strategy={s.address} className="mb-3" />

      {/* Footer: creator. Prefer the on-chain authority pubkey routed
          through SnsName so we display `<creator>.sol` when one resolves
          (chaos-pool, then mainnet primary domain). Falls back to the
          metadata-supplied creatorName, then the truncated pubkey. */}
      <footer className="mt-auto pt-3 border-t border-neutral-300 flex items-center justify-between">
        <span className="text-xs text-neutral-600 font-mono truncate">
          {s.authority ? (
            <SnsName
              addr={s.authority}
              prefix="by "
              className="text-xs text-neutral-600 font-mono"
            />
          ) : s.creatorName ? (
            `by ${s.creatorName}`
          ) : (
            "by anonymous"
          )}
        </span>
        <span className="text-xs text-neutral-600 group-hover:text-amber-400 transition-colors duration-180">
          View →
        </span>
      </footer>
    </article>
  );

  if (onClick && !dimmed) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-left w-full focus-amber rounded-xl"
        aria-label={`Open ${s.name}`}
      >
        {content}
      </button>
    );
  }

  if (href && !dimmed) {
    return (
      <a
        href={href}
        className="block focus-amber rounded-xl"
        aria-label={`Open ${s.name}`}
      >
        {content}
      </a>
    );
  }

  return content;
}

export function StrategyCardSkeleton() {
  return (
    <div className="rounded-xl border border-neutral-300 bg-surface p-5 animate-shimmer">
      <div className="h-5 w-1/2 rounded bg-neutral-300 mb-2" />
      <div className="h-3 w-1/3 rounded bg-neutral-300 mb-5" />
      <div className="flex items-end justify-between mb-4">
        <div className="h-8 w-16 rounded bg-neutral-300" />
        <div className="h-6 w-20 rounded bg-neutral-300" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-14 rounded-lg bg-neutral-300" />
        <div className="h-14 rounded-lg bg-neutral-300" />
      </div>
    </div>
  );
}
