"use client";

/**
 * ProtocolCoverage , surfaces which Beethoven protocols a strategy
 * "uses" as a row of category-tagged chips (Deposit / Swap / Perps).
 *
 * TODO: replace with on-chain rebalance-history reader. Today the strategy
 * account doesn't store its protocol list , we'd derive it from the program
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
  // Amber for deposits , matches Earn-mode brand colour.
  deposit: {
    label: "Deposit",
    chip:
      "bg-amber-600/10 text-amber-400 border-amber-600/40",
  },
  // Neutral border for swaps , keeps the row visually calm.
  swap: {
    label: "Swap",
    chip:
      "bg-neutral-0/40 text-neutral-800 border-neutral-300",
  },
  // Purple for perps , matches Predict-mode brand colour.
  perps: {
    label: "Perps",
    chip:
      "bg-purple-500/10 text-purple-300 border-purple-500/40",
  },
};

/**
 * Returns the protocol IDs a strategy actually uses on chain.
 *
 * Today the strategy account doesn't store its protocol list, so this returns
 * an empty array , the component renders nothing rather than fabricating a
 * coverage list. Replace with a derivation from the strategy's recent
 * `rebalance` ix `remaining_accounts` (the protocol-detector account is the
 * first one in each leg) once that resolver lands.
 */
export function protocolsForStrategy(_strategy: string): string[] {
  void PROTOCOLS;
  return [];
}

export function ProtocolCoverage({
  strategy,
  className,
}: {
  strategy: string;
  className?: string;
}) {
  const protocols = useMemo<Protocol[]>(() => {
    return protocolsForStrategy(strategy)
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
                title={`${p.name} , ${tone.label}`}
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
