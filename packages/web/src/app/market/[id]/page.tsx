import Link from "next/link";
import { notFound } from "next/navigation";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchMarketByAddress } from "@/lib/markets";
import { rateCategoryById } from "@/lib/rate-categories";
import { resolveSns, truncatePubkey } from "@/lib/sns-resolver";
import { MarketCreatorStrip } from "@/components/market-creator-strip";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Single-market detail page.
 *
 * Structure:
 *   1. Back link + category + question (the what).
 *   2. MarketCreatorStrip — the SNS provenance story (the who).
 *   3. Kind-specific resolution prose (the how).
 *   4. Decorative YES/NO buy buttons (the demo surface — trading wiring
 *      lands in Phase 5.5).
 *   5. Raw resolution metadata.
 */
export default async function MarketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const connection = getDevnetConnection();
  const market = await fetchMarketByAddress(connection, params.id);

  if (!market) notFound();

  const category = rateCategoryById(market.rateReaderSelector);
  const creatorSns = resolveSns(market.createdBy);
  const creatorLabel =
    creatorSns?.devnetName ?? truncatePubkey(market.createdBy);

  // Kind-specific resolution description
  let resolutionProse: string;
  if (market.kind === 5 && category && market.thresholdBps != null) {
    resolutionProse =
      `Rate Barrier: Will ${category.label} (${category.pool}) cross ` +
      `${(market.thresholdBps / 100).toFixed(2)}% APY by slot ` +
      `${market.windowEndSlot?.toLocaleString() ?? "—"}?`;
  } else if (market.kind === 6 && category && market.spreadBps != null) {
    resolutionProse =
      `Agent vs Benchmark: Will ${creatorLabel} beat ${category.label} ` +
      `(${category.pool}) by ${(market.spreadBps / 100).toFixed(2)}% ` +
      `over the window ending at slot ` +
      `${market.windowEndSlot?.toLocaleString() ?? "—"}?`;
  } else {
    resolutionProse =
      market.question ||
      `Kind ${market.kind} market — resolves via program-native NAV reads.`;
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <Link
        href="/markets"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-purple-300 hover:text-purple-200"
      >
        ← Back to markets
      </Link>

      {/* ─── Category + question ─── */}
      <div className="mt-6 mb-4 flex items-center gap-2">
        <span className="text-xl" aria-hidden="true">
          {category?.emoji ?? "📊"}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600">
          {category?.label ?? `Kind ${market.kind}`}
        </span>
        <span
          className={[
            "ml-auto font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full",
            market.status === "active"
              ? "bg-success-400/10 text-success-400"
              : "bg-neutral-0/40 text-neutral-600",
          ].join(" ")}
        >
          {market.status === "active" ? "active" : "resolved"}
        </span>
      </div>

      <h1 className="font-serif text-display text-neutral-900 leading-tight mb-6">
        {market.question || "—"}
      </h1>

      {/* ─── SNS provenance strip (the hero element) ─── */}
      <MarketCreatorStrip
        creator={market.createdBy}
        createdAt={market.createdAt}
      />

      {/* ─── Kind-specific resolution prose ─── */}
      <section className="mt-8">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600 mb-2">
          Resolution criteria
        </h2>
        <p className="text-neutral-900">{resolutionProse}</p>
      </section>

      {/* ─── Decorative YES/NO buttons ─── */}
      <section className="mt-8 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled
          aria-label="Buy YES shares (coming in Phase 5.5)"
          className="rounded-xl border border-success-400/40 bg-success-400/10 px-5 py-4 text-success-400 font-mono text-sm uppercase tracking-[0.14em] disabled:opacity-70"
        >
          Buy YES
        </button>
        <button
          type="button"
          disabled
          aria-label="Buy NO shares (coming in Phase 5.5)"
          className="rounded-xl border border-neutral-300 bg-surface px-5 py-4 text-neutral-800 font-mono text-sm uppercase tracking-[0.14em] disabled:opacity-70"
        >
          Buy NO
        </button>
        <p className="col-span-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600">
          Trading wiring ships in Phase 5.5
        </p>
      </section>

      {/* ─── Raw metadata ─── */}
      <section className="mt-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600 mb-3">
          Resolution data
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-2 font-mono text-xs">
          <dt className="text-neutral-600">Rate reader</dt>
          <dd className="text-neutral-900">
            {category ? `#${category.id} — ${category.label}` : "—"}
          </dd>

          <dt className="text-neutral-600">Resolution slot</dt>
          <dd className="nums text-neutral-900">
            {market.resolutionSlot.toLocaleString()}
          </dd>

          {market.windowStartSlot != null && (
            <>
              <dt className="text-neutral-600">Window start slot</dt>
              <dd className="nums text-neutral-900">
                {market.windowStartSlot.toLocaleString()}
              </dd>
            </>
          )}
          {market.windowEndSlot != null && (
            <>
              <dt className="text-neutral-600">Window end slot</dt>
              <dd className="nums text-neutral-900">
                {market.windowEndSlot.toLocaleString()}
              </dd>
            </>
          )}

          <dt className="text-neutral-600">Fee</dt>
          <dd className="nums text-neutral-900">
            {(market.feeBps / 100).toFixed(2)}%
          </dd>

          <dt className="text-neutral-600">Total volume</dt>
          <dd className="nums text-neutral-900">
            {(market.totalVolume / 1e6).toFixed(2)} USDC
          </dd>

          <dt className="text-neutral-600">Status</dt>
          <dd className="text-neutral-900">
            {market.status}
            {market.outcome ? ` · ${market.outcome}` : ""}
          </dd>

          <dt className="text-neutral-600">Market PDA</dt>
          <dd>
            <a
              href={`https://explorer.solana.com/address/${market.address}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="underline text-amber-400 break-all"
            >
              {market.address}
            </a>
          </dd>
        </dl>
      </section>
    </main>
  );
}
