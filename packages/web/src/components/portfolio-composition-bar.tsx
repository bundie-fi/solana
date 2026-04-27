import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Horizontal stacked bar showing a vault's asset mix: %SOL / %USDC /
 * %mSOL / %kTokens / %other. The "other" bucket catches token accounts
 * we don't have price quotes for — we render it in neutral grey so the
 * user can see composition without claiming a USD value we can't verify.
 *
 * We intentionally don't convert everything to USD — devnet doesn't have
 * a reliable price surface and that conversion would mislead on the
 * mixed-asset bar. Instead we use raw uiAmount as the "weight" and scale
 * to percentages across the total.
 */

// Devnet mint addresses for our target stables / LSTs. Extend this map
// when new protocols land in agent strategies. The bUSD entry is sourced
// from NEXT_PUBLIC_BUSD_MINT so the same code works against any deploy
// (devnet, surfpool fork, future mainnet) without a recompile.
const BUSD_MINT =
  process.env.NEXT_PUBLIC_BUSD_MINT ??
  "42LaRiwvuxfQv5rfHMmk9wU3K2nRxMGzgukNJztydpiB";

const MINT_LABELS: Record<string, { label: string; color: string }> = {
  // bUSD — Bundie's prediction-market collateral, minted in setup-busd.
  // Sits before USDC because it's the dominant token in vault holdings.
  [BUSD_MINT]: {
    label: "bUSD",
    color: "bg-amber-600",
  },
  // USDC devnet
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": {
    label: "USDC",
    color: "bg-emerald-500",
  },
  // mSOL (Marinade LST)
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: {
    label: "mSOL",
    color: "bg-purple-500",
  },
};

// kToken prefix — Kamino ktoken mints on devnet aren't fully cataloged,
// so we fall back to "kToken" if the mint isn't in MINT_LABELS but has
// a recognisable on-chain program owner. For v1 we just bucket the
// unknowns under "Other" — callers can expand MINT_LABELS over time.

export interface PortfolioCompositionBarProps {
  solLamports: number;
  tokenAccounts: Array<{ mint: string; uiAmount: number }>;
}

interface Slice {
  label: string;
  color: string;
  value: number;
}

export function PortfolioCompositionBar({
  solLamports,
  tokenAccounts,
}: PortfolioCompositionBarProps) {
  const slices: Slice[] = [];

  const sol = solLamports / LAMPORTS_PER_SOL;
  if (sol > 0) {
    slices.push({ label: "SOL", color: "bg-amber-500", value: sol });
  }

  const labeled: Record<string, number> = {};
  let otherTotal = 0;
  for (const ta of tokenAccounts) {
    const known = MINT_LABELS[ta.mint];
    if (known) {
      labeled[known.label] = (labeled[known.label] ?? 0) + ta.uiAmount;
    } else {
      otherTotal += ta.uiAmount;
    }
  }
  for (const [label, value] of Object.entries(labeled)) {
    const color =
      Object.values(MINT_LABELS).find((m) => m.label === label)?.color ??
      "bg-neutral-500";
    slices.push({ label, color, value });
  }
  if (otherTotal > 0) {
    slices.push({
      label: "Other",
      color: "bg-neutral-500",
      value: otherTotal,
    });
  }

  const total = slices.reduce((s, x) => s + x.value, 0);

  if (total <= 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-surface p-6 text-center">
        <p className="text-sm text-neutral-700">
          This vault has no on-chain balances yet.
        </p>
        <p className="text-xs text-neutral-500 mt-1">
          Fund it via the agent CLI or wait for the next strategy tick.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Stacked bar */}
      <div className="h-6 w-full flex rounded-full overflow-hidden border border-neutral-300">
        {slices.map((s) => {
          const pct = (s.value / total) * 100;
          return (
            <div
              key={s.label}
              className={`${s.color} h-full`}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3">
        {slices.map((s) => {
          const pct = (s.value / total) * 100;
          return (
            <div
              key={s.label}
              className="flex items-center gap-1.5 font-mono text-[11px]"
            >
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.color}`} />
              <span className="text-neutral-700 uppercase tracking-[0.14em]">
                {s.label}
              </span>
              <span className="text-neutral-500 nums">
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
