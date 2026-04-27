"use client";

import { useMemo, useState } from "react";

/** A single Beethoven protocol adapter. */
export type Protocol = {
  /** Display name, e.g. "Orca Whirlpools" */
  name: string;
  /** Top-level grouping. */
  category: "Deposit" | "Swap" | "Perps";
  /** Sub-category — lending, liquid staking, vault aggregator, CLMM, CLOB, perps, … */
  subCategory: string;
  /** On-chain program ID (devnet). */
  programId: string;
  /** Whether the program is verified live on devnet. */
  devnet: boolean;
};

type Filter = "All" | "Deposit" | "Swap" | "Perps";

const FILTERS: Filter[] = ["All", "Deposit", "Swap", "Perps"];

const CATEGORY_TONE: Record<Protocol["category"], string> = {
  Deposit: "text-amber-400",
  Swap: "text-purple-300",
  Perps: "text-success-400",
};

function truncateId(id: string) {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function ProtocolGrid({ protocols }: { protocols: Protocol[] }) {
  const [filter, setFilter] = useState<Filter>("All");
  const [copied, setCopied] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (filter === "All") return protocols;
    return protocols.filter((p) => p.category === filter);
  }, [protocols, filter]);

  const grouped = useMemo(() => {
    const groups: Record<string, Protocol[]> = {};
    for (const p of visible) {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push(p);
    }
    return groups;
  }, [visible]);

  const order: Protocol["category"][] = ["Deposit", "Swap", "Perps"];

  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200);
    } catch {
      /* clipboard unavailable — silent */
    }
  }

  return (
    <>
      {/* ─── Filter pills ─── */}
      <div
        role="tablist"
        aria-label="Filter protocols by category"
        className="mb-8 flex flex-wrap items-center gap-2"
      >
        {FILTERS.map((f) => {
          const active = filter === f;
          const count =
            f === "All"
              ? protocols.length
              : protocols.filter((p) => p.category === f).length;
          return (
            <button
              key={f}
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f)}
              className={[
                "h-9 px-4 rounded-full font-mono text-[11px] uppercase tracking-[0.18em] transition-colors duration-180",
                "border",
                active
                  ? "bg-amber-600 text-neutral-0 border-amber-600"
                  : "bg-surface text-neutral-800 border-neutral-300 hover:text-neutral-900 hover:border-amber-600/50",
              ].join(" ")}
            >
              {f}
              <span className="ml-2 opacity-70 nums">{count}</span>
            </button>
          );
        })}
      </div>

      {/* ─── Grouped grids ─── */}
      <div className="flex flex-col gap-12">
        {order.map((cat) => {
          const list = grouped[cat];
          if (!list || list.length === 0) return null;
          return (
            <section key={cat}>
              <header className="mb-4 flex items-baseline gap-3">
                <h2 className={`font-serif text-h1 ${CATEGORY_TONE[cat]}`}>
                  <em>{cat}</em>
                </h2>
                <span className="font-mono nums text-xs text-neutral-600">
                  {list.length} protocol{list.length === 1 ? "" : "s"}
                </span>
              </header>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map((p) => (
                  <ProtocolCard
                    key={p.programId}
                    p={p}
                    copied={copied === p.programId}
                    onCopy={() => copy(p.programId)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function ProtocolCard({
  p,
  copied,
  onCopy,
}: {
  p: Protocol;
  copied: boolean;
  onCopy: () => void;
}) {
  const explorerHref = `https://orbmarkets.io/address/${p.programId}?cluster=devnet`;

  return (
    <article
      className={[
        "group relative flex flex-col rounded-xl border bg-surface p-5",
        "border-neutral-300 hover:border-amber-600/50",
        "transition-all duration-180 ease-out-quick",
        "hover:-translate-y-[1px] hover:shadow-pop",
      ].join(" ")}
    >
      {/* Header: name + status */}
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-serif text-[22px] leading-tight text-neutral-900 truncate">
            {p.name}
          </h3>
          <p className="text-xs text-neutral-800 mt-0.5 truncate capitalize">
            {p.subCategory}
          </p>
        </div>
        {p.devnet && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-[0.1em] bg-success-400/10 text-success-400 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-success-400 animate-pulse" />
            devnet ✓
          </span>
        )}
      </header>

      {/* Category tag */}
      <div className="mb-4">
        <span
          className={`font-mono text-[10px] font-medium uppercase tracking-[0.12em] ${CATEGORY_TONE[p.category]}`}
        >
          {p.category}
        </span>
      </div>

      {/* Program ID — click to copy */}
      <div className="rounded-lg bg-neutral-0/40 border border-neutral-300 p-3 mb-3">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-800 mb-1">
          Program ID
        </p>
        <button
          type="button"
          onClick={onCopy}
          className="font-mono text-sm text-neutral-900 truncate w-full text-left hover:text-amber-400 transition-colors duration-180 focus:outline-none"
          aria-label={`Copy program ID ${p.programId}`}
          title={p.programId}
        >
          {copied ? "copied ✓" : truncateId(p.programId)}
        </button>
      </div>

      {/* Footer: explorer link */}
      <footer className="mt-auto pt-3 border-t border-neutral-300 flex items-center justify-between">
        <span className="text-xs text-neutral-800 font-mono">devnet</span>
        <a
          href={explorerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-neutral-800 group-hover:text-amber-400 transition-colors duration-180"
        >
          Explorer →
        </a>
      </footer>
    </article>
  );
}
