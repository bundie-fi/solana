"use client";

/**
 * ProtocolCoverage — surfaces which Beethoven protocols a strategy
 * "uses" as a row of category-tagged chips (Deposit / Swap / Perps).
 *
 * TODO: replace with on-chain rebalance-history reader. Today the strategy
 * account doesn't store its protocol list — we'd derive it from the program
 * IDs that appeared in `remaining_accounts` of recent rebalance ixs. Until
 * that resolver lands we deterministically mock 2–4 protocols per strategy
 * address so the UI shape, layout, and tone are real.
 */

import { useMemo } from "react";
import {
  PROTOCOLS,
  findProtocol,
  type Protocol,
  type ProtocolCategory,
} from "@/lib/protocols";

const CATEGORY_TONE: Record<
  ProtocolCategory,
  { label: string; chip: string }
> = {
  // Amber for deposits — matches Earn-mode brand colour.
  deposit: {
    label: "Deposit",
    chip:
      "bg-amber-600/10 text-amber-400 border-amber-600/40",
  },
  // Neutral border for swaps — keeps the row visually calm.
  swap: {
    label: "Swap",
    chip:
      "bg-neutral-0/40 text-neutral-800 border-neutral-300",
  },
  // Purple for perps — matches Predict-mode brand colour.
  perps: {
    label: "Perps",
    chip:
      "bg-purple-500/10 text-purple-300 border-purple-500/40",
  },
};

/**
 * Deterministic mock — hashes the strategy address into a stable subset of
 * 2–4 protocol IDs from the catalog. Same address always returns the same
 * list so it doesn't reshuffle between renders / pages.
 *
 * TODO: replace with on-chain rebalance-history reader.
 */
export function mockProtocolsForStrategy(strategy: string): string[] {
  if (!strategy) return [];

  // Simple FNV-1a-ish hash over the address bytes. Good enough for a UI mock.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < strategy.length; i++) {
    h ^= strategy.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }

  // 2–4 protocols per strategy.
  const count = 2 + (h % 3); // 2, 3, or 4
  const picks: string[] = [];
  const seen = new Set<string>();
  let cursor = h;

  // Walk the catalog with a stepped index until we've collected `count`
  // unique entries. Step by an odd number to spread picks across categories.
  const STEP = 7;
  for (let i = 0; i < PROTOCOLS.length && picks.length < count; i++) {
    const idx = (cursor + i * STEP) % PROTOCOLS.length;
    const p = PROTOCOLS[idx];
    if (!seen.has(p.id)) {
      seen.add(p.id);
      picks.push(p.id);
    }
    cursor = (cursor * 31 + 1) >>> 0;
  }

  return picks;
}

export function ProtocolCoverage({
  strategy,
  className,
}: {
  strategy: string;
  className?: string;
}) {
  const protocols = useMemo<Protocol[]>(() => {
    return mockProtocolsForStrategy(strategy)
      .map((id) => findProtocol(id))
      .filter((p): p is Protocol => Boolean(p));
  }, [strategy]);

  if (protocols.length === 0) return null;

  return (
    <div className={["flex flex-col gap-2", className ?? ""].join(" ")}>
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-600">
        Built with
      </p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Protocols used by this strategy">
        {protocols.map((p) => {
          const tone = CATEGORY_TONE[p.category];
          return (
            <li key={p.id}>
              <span
                className={[
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border",
                  "font-mono text-[10px] font-medium tracking-[0.04em]",
                  tone.chip,
                ].join(" ")}
                title={`${p.name} — ${tone.label}`}
              >
                <span className="uppercase tracking-[0.12em] opacity-70">
                  {tone.label}
                </span>
                <span className="opacity-30" aria-hidden="true">
                  ·
                </span>
                <span>{p.name}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
