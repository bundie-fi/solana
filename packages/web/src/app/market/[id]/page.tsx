import Link from "next/link";
import { notFound } from "next/navigation";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchMarketByAddress, fetchMarketsByCreator } from "@/lib/markets";
import { rateCategoryById } from "@/lib/rate-categories";
import {
  resolveSns,
  truncatePubkey,
  HERO_AGENTS,
} from "@/lib/sns-resolver";
import { MarketBuyPanel } from "@/components/market-buy-panel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Market detail page.
 *
 * Mobile-first layout: the YES/NO buy CTA sits above the fold. On
 * desktop we flip to a two-column split so the prose doesn't push the
 * CTA offscreen.
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
  const creatorEmoji =
    HERO_AGENTS.find((a) => a.vault === market.createdBy)?.emoji ?? "🤖";

  const targetSns = market.targetAgent ? resolveSns(market.targetAgent) : null;
  const targetLabel = market.targetAgent
    ? (targetSns?.devnetName ?? truncatePubkey(market.targetAgent))
    : null;
  const targetEmoji = market.targetAgent
    ? (HERO_AGENTS.find((a) => a.vault === market.targetAgent)?.emoji ?? "🤖")
    : null;

  // Probability estimate: LS-LMSR actual price would require on-chain
  // liquidity-param math; for the gauge we use the naive yes/no share
  // ratio which is a good-enough visual proxy. Default 50/50 when
  // no shares have been traded yet.
  const totalShares = market.yesShares + market.noShares;
  const yesProbability =
    totalShares > 0 ? market.yesShares / totalShares : 0.5;

  // Creator "accuracy" — for the mini card we show, count markets this
  // creator has resolved. Cheap; fetchMarketsByCreator is already memoised
  // through the connection singleton's page-local cache.
  const allByCreator = await fetchMarketsByCreator(
    connection,
    market.createdBy,
  );
  const creatorResolved = allByCreator.filter(
    (m) => m.status === "resolved",
  );
  const creatorAccuracy =
    creatorResolved.length === 0
      ? null
      : creatorResolved.filter((m) => m.outcome === "no").length /
        creatorResolved.length;

  // Kind-specific resolution prose
  let resolutionProse: string;
  if (market.kind === 5 && category && market.thresholdBps != null) {
    resolutionProse =
      `Rate Barrier: Will ${category.label} (${category.pool}) cross ` +
      `${(market.thresholdBps / 100).toFixed(2)}% APY by slot ` +
      `${market.windowEndSlot?.toLocaleString() ?? "—"}?`;
  } else if (market.kind === 6 && category && market.spreadBps != null) {
    resolutionProse =
      `Agent vs Benchmark: Will ${targetLabel ?? "the target"} beat ` +
      `${category.label} (${category.pool}) by ${(market.spreadBps / 100).toFixed(2)}% ` +
      `over the window ending at slot ` +
      `${market.windowEndSlot?.toLocaleString() ?? "—"}?`;
  } else {
    resolutionProse =
      market.question ||
      `Kind ${market.kind} market — resolves via program-native NAV reads.`;
  }

  return (
    <main className="mx-auto w-full max-w-content px-4 py-6 pb-safe">
      <Link
        href="/markets"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-purple-300 hover:text-purple-200"
      >
        ← All markets
      </Link>

      {/* Category + status */}
      <div className="mt-4 flex items-center gap-2">
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
              ? "bg-success-400/10 text-success-400 border border-success-400/30"
              : "bg-neutral-0/40 text-neutral-600 border border-neutral-300",
          ].join(" ")}
        >
          {market.status}
          {market.outcome ? ` · ${market.outcome}` : ""}
        </span>
      </div>

      <h1 className="font-serif text-display text-neutral-900 leading-tight mt-3 mb-6">
        {market.question || "—"}
      </h1>

      {/* Two-column split on desktop: buy panel beside prose */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="flex flex-col gap-6 order-2 lg:order-1">
          {/* Probability gauge */}
          <ProbabilityGauge yesProbability={yesProbability} />

          {/* Creator + Target cards (side-by-side on md+, stacked on mobile) */}
          <section
            className={
              market.kind === 6 && targetLabel
                ? "grid grid-cols-1 md:grid-cols-2 gap-3"
                : "grid grid-cols-1 gap-3"
            }
          >
            <AgentMiniCard
              badge="Created by"
              sns={creatorLabel}
              emoji={creatorEmoji}
              href={`/agent/${creatorSns?.devnetName ?? market.createdBy}`}
              detail={
                creatorAccuracy == null
                  ? "no resolved markets yet"
                  : `accuracy ${(creatorAccuracy * 100).toFixed(0)}% · ${creatorResolved.length} resolved`
              }
            />
            {market.kind === 6 && targetLabel && market.targetAgent && (
              <AgentMiniCard
                badge="Betting on"
                sns={targetLabel}
                emoji={targetEmoji ?? "🤖"}
                href={`/agent/${targetSns?.devnetName ?? market.targetAgent}`}
                detail={`vault ${market.targetAgent.slice(0, 4)}…${market.targetAgent.slice(-4)}`}
              />
            )}
          </section>

          {/* Resolution prose */}
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600 mb-2">
              Resolution criteria
            </h2>
            <p className="text-neutral-900">{resolutionProse}</p>
          </section>

          {/* Insider-trading attestation (kind=6 only) */}
          {market.kind === 6 && (
            <InsiderAttestationStrip
              creator={market.createdBy}
              target={market.targetAgent}
            />
          )}

          {/* Raw metadata */}
          <section>
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
        </div>

        {/* Buy panel — lives above the fold on mobile, sidebar on desktop */}
        <aside className="lg:sticky lg:top-20 h-fit order-1 lg:order-2">
          <MarketBuyPanel market={market} yesProbability={yesProbability} />
        </aside>
      </div>
    </main>
  );
}

function ProbabilityGauge({ yesProbability }: { yesProbability: number }) {
  const pct = Math.max(0, Math.min(1, yesProbability)) * 100;
  return (
    <div className="rounded-2xl border border-neutral-300 bg-surface p-4">
      <div className="flex items-center justify-between mb-2 font-mono text-[10px] uppercase tracking-[0.18em]">
        <span className="text-success-400">YES {pct.toFixed(1)}%</span>
        <span className="text-amber-400">NO {(100 - pct).toFixed(1)}%</span>
      </div>
      <div className="h-3 w-full rounded-full overflow-hidden flex border border-neutral-300">
        <div
          className="h-full bg-success-500"
          style={{ width: `${pct}%` }}
        />
        <div
          className="h-full bg-amber-500 flex-1"
          style={{ width: `${100 - pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-neutral-600">
        Implied by YES/NO share ratio.{" "}
        <span className="nums">
          {Math.round(pct)}¢ / {Math.round(100 - pct)}¢
        </span>{" "}
        per share (1.00 USDC = 1 guaranteed winning share).
      </p>
    </div>
  );
}

function AgentMiniCard({
  badge,
  sns,
  emoji,
  href,
  detail,
}: {
  badge: string;
  sns: string;
  emoji: string;
  href: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-neutral-300 bg-gradient-to-b from-neutral-200 to-neutral-100 p-4 flex items-start gap-3 hover:border-amber-400/70 transition-colors"
    >
      <div className="h-11 w-11 shrink-0 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-2xl">
        {emoji}
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600">
          {badge}
        </div>
        <div className="font-serif text-lg text-neutral-900 truncate">
          <em>{sns}</em>
        </div>
        <div className="text-xs text-neutral-600 truncate">{detail}</div>
      </div>
    </Link>
  );
}

function InsiderAttestationStrip({
  creator,
  target,
}: {
  creator: string;
  target: string | null;
}) {
  const distinct = target != null && creator !== target;
  return (
    <section className="rounded-xl border border-success-400/30 bg-success-400/10 p-4 flex items-start gap-3">
      <div className="h-8 w-8 shrink-0 rounded-full bg-success-400/20 flex items-center justify-center text-success-400 font-bold">
        ✓
      </div>
      <div className="text-sm text-neutral-800">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-success-400 mb-1">
          Insider-trading protection
        </div>
        <p>
          The on-chain program rejects kind=6 markets where{" "}
          <span className="font-mono">creator == target_agent</span>.
          {distinct && (
            <>
              {" "}This market passes that guard — the creator and the
              targeted vault are distinct pubkeys.
            </>
          )}
        </p>
        <p className="mt-1 font-mono text-[10px] text-neutral-600">
          policy: InsiderMarketForbidden · pm program 547afea
        </p>
      </div>
    </section>
  );
}
