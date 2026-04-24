import Link from "next/link";
import { rateCategoryById } from "@/lib/rate-categories";
import { resolveSns, truncatePubkey } from "@/lib/sns-resolver";
import type { MarketView } from "@/lib/markets";

/**
 * Two-column block used on /agent/[sns]:
 *   left: "Markets I created" (createdBy == vault)
 *   right: "Markets on me" (kind=6 and targetAgent == vault)
 *
 * The column is a single reusable component because the row template
 * is identical — only the creator-vs-target pill differs. Kept as a
 * server component (no "use client") so the profile page stays SSR.
 */
export function AgentMarketColumn({
  title,
  subtitle,
  emptyLabel,
  markets,
  showTarget,
  showCreator,
  selfVault,
}: {
  title: string;
  subtitle: string;
  emptyLabel: string;
  markets: MarketView[];
  showTarget?: boolean;
  showCreator?: boolean;
  selfVault: string;
}) {
  return (
    <div>
      <div className="mb-3">
        <h2 className="font-serif text-h1 text-neutral-900 leading-tight">
          <em>{title}</em>
        </h2>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600 mt-1">
          {subtitle}
        </p>
      </div>
      {markets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-surface p-6 text-center">
          <p className="text-sm text-neutral-700">{emptyLabel}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {markets.map((m) => (
            <AgentMarketRow
              key={m.address}
              market={m}
              showTarget={showTarget}
              showCreator={showCreator}
              selfVault={selfVault}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentMarketRow({
  market,
  showTarget,
  showCreator,
  selfVault,
}: {
  market: MarketView;
  showTarget?: boolean;
  showCreator?: boolean;
  selfVault: string;
}) {
  const cat = rateCategoryById(market.rateReaderSelector);
  const targetSns = market.targetAgent ? resolveSns(market.targetAgent) : null;
  const creatorSns = resolveSns(market.createdBy);

  let pillLabel: string | null = null;
  if (showTarget && market.kind === 6 && market.targetAgent) {
    pillLabel = `on ${targetSns?.devnetName ?? truncatePubkey(market.targetAgent)}`;
  } else if (showCreator) {
    pillLabel = `by ${creatorSns?.devnetName ?? truncatePubkey(market.createdBy)}`;
  }
  // Belt-and-braces: hide self-target pills (the on-chain program already
  // rejects these at creation time via InsiderMarketForbidden).
  if (market.targetAgent === selfVault && showTarget) {
    pillLabel = null;
  }

  return (
    <li>
      <Link
        href={`/market/${market.address}`}
        className="flex items-start gap-3 rounded-lg border border-neutral-300 bg-surface p-3 hover:border-amber-400/70 transition-colors"
      >
        <span className="text-lg shrink-0" aria-hidden="true">
          {cat?.emoji ?? "📊"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600">
            {cat?.label ?? `Kind ${market.kind}`}
          </div>
          <div className="font-serif text-[15px] text-neutral-900 line-clamp-2 mt-0.5">
            {market.question || "—"}
          </div>
          {pillLabel && (
            <span className="inline-block mt-1 rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-purple-300">
              {pillLabel}
            </span>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div
            className={[
              "font-mono text-[10px] uppercase tracking-[0.14em]",
              market.status === "active"
                ? "text-success-400"
                : "text-neutral-600",
            ].join(" ")}
          >
            {market.status}
            {market.outcome ? ` · ${market.outcome}` : ""}
          </div>
          <div className="font-mono text-xs text-neutral-700 nums mt-0.5">
            {(market.totalVolume / 1e6).toFixed(2)} USDC
          </div>
        </div>
      </Link>
    </li>
  );
}
