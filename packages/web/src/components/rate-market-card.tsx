import Link from "next/link";
import type { MarketView } from "@/lib/markets";
import { rateCategoryById } from "@/lib/rate-categories";
import { resolveSns, truncatePubkey } from "@/lib/sns-resolver";

/**
 * Home-feed market card. The creator's `.bundie` SNS name is the focal
 * element — this is the SNS provenance the home page is built around.
 */
export function RateMarketCard({ market }: { market: MarketView }) {
  const category = rateCategoryById(market.rateReaderSelector);
  const sns = resolveSns(market.createdBy);
  const creatorLabel = sns?.devnetName ?? truncatePubkey(market.createdBy);

  return (
    <Link
      href={`/market/${market.address}`}
      className="group block rounded-xl border border-neutral-300 bg-surface p-5 hover:border-amber-400/80 hover:shadow-pop transition-all duration-180"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg" aria-hidden="true">
          {category?.emoji ?? "📊"}
        </span>
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-600">
          {category?.label ?? `Kind ${market.kind}`}
        </span>
        {market.status === "resolved" && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-600 bg-neutral-0/40 px-2 py-0.5 rounded-full">
            {market.outcome ? `resolved · ${market.outcome}` : "resolved"}
          </span>
        )}
      </div>

      <p className="font-serif text-lg leading-snug text-neutral-900 mb-4 line-clamp-3">
        {market.question || "—"}
      </p>

      <div className="flex items-center justify-between text-sm">
        <span className="text-neutral-700">
          by{" "}
          <span className="text-amber-400 font-medium group-hover:underline">
            {creatorLabel}
          </span>
        </span>
        <span className="font-mono text-xs text-neutral-600 nums">
          {(market.totalVolume / 1e6).toFixed(2)} USDC vol
        </span>
      </div>
    </Link>
  );
}
