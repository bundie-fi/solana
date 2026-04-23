import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  fetchMarket,
  fetchStrategy,
  fetchCurrentSlot,
} from '@/lib/chain'
import { PriceBar } from '@/components/ui/PriceBar'
import { PayoffCalculator } from '@/components/PayoffCalculator'
import { SnsName } from '@/components/SnsName'
import { lookupChaosPoolSync } from '@/lib/sns'
import type { StrategyDisplay } from '@bundie/common'

export const revalidate = 30

const SLOT_SECONDS = 0.4

function explorer(address: string): string {
  return `https://orbmarkets.io/address/${address}?cluster=devnet`
}

function truncate(addr: string, head = 6, tail = 6): string {
  if (addr.length <= head + tail + 1) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

function formatCountdown(slotsRemaining: number): string {
  if (slotsRemaining <= 0) return 'Resolution slot reached'
  const totalSeconds = slotsRemaining * SLOT_SECONDS
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  if (days > 0) return `≈ ${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'}`
  if (hours > 0) return `≈ ${hours} hour${hours === 1 ? '' : 's'}, ${minutes} min`
  return `≈ ${minutes} min`
}

function formatUsdc(base: bigint | number): string {
  const n = typeof base === 'bigint' ? Number(base) : base
  return (n / 1e6).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default async function MarketDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const market = await fetchMarket(params.id).catch(() => null)
  if (!market) notFound()

  // Pull current slot + strategy in parallel — both are best-effort and
  // degrade to "unknown" rather than failing the route.
  const [currentSlot, strategy] = await Promise.all([
    fetchCurrentSlot(),
    fetchStrategy(market.strategy).catch(() => null) as Promise<StrategyDisplay | null>,
  ])

  const slotsRemaining =
    currentSlot !== null ? Math.max(0, market.resolutionSlot - currentSlot) : null
  const countdown =
    slotsRemaining !== null ? formatCountdown(slotsRemaining) : 'Slot lookup unavailable'

  const yesPct = Math.round(market.yesPrice * 100)
  const noPct = Math.round(market.noPrice * 100)
  const volumeUsdc = formatUsdc(market.totalVolume)
  const thresholdPct = (market.thresholdBps / 100).toFixed(2)

  const isResolved = market.status === 'resolved'

  // Settlement preview — only meaningful for absolute markets where we have
  // an APY to compare against the threshold. Otherwise leave it null.
  const liveApy = strategy?.apy
  const settlementOutcome =
    !isResolved &&
    market.marketType === 'absolute' &&
    typeof liveApy === 'number' &&
    Number.isFinite(liveApy) &&
    liveApy > 0
      ? liveApy * 10_000 >= market.thresholdBps
        ? 'yes'
        : 'no'
      : null

  // Threshold gauge progress for absolute markets.
  const thresholdProgress =
    market.marketType === 'absolute' && typeof liveApy === 'number' && liveApy > 0
      ? Math.min(1.5, (liveApy * 10_000) / market.thresholdBps)
      : null

  // Subsidy reconstruction. The `subsidyProvider` seeded the vault with USDC
  // before any trades. We don't have the seed amount stored separately, so
  // surface (totalYesCost + totalNoCost) − totalVolume as a best-effort
  // figure — this equals the seed when no fees have accrued. If it can't be
  // reasoned about (e.g. negative due to fee accrual), show "—".
  const subsidyEst =
    Number(market.totalYesCost) +
    Number(market.totalNoCost) -
    Number(market.totalVolume)

  // Pull the question apart — anything wrapped in <em>…</em> renders italic.
  const renderedQuestion = renderQuestion(market.question)

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-purple-300">
          Market · {market.marketType === 'absolute' ? 'Absolute' : 'Relative'}
        </span>
        <h1 className="font-serif text-display text-neutral-900 mt-1 leading-tight">
          {renderedQuestion}
        </h1>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Link
            href={`/strategy/${market.strategy}`}
            className="text-xs font-mono text-amber-400 hover:underline"
          >
            {strategy?.name ?? truncate(market.strategy)}
          </Link>
          <span className="text-neutral-600">·</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              isResolved
                ? 'bg-neutral-300 text-neutral-700'
                : 'bg-success-400/10 text-success-400'
            }`}
          >
            {isResolved
              ? `Settled: ${market.outcome?.toUpperCase() ?? '—'}`
              : 'Active'}
          </span>
          {!isResolved && (
            <span className="text-xs text-neutral-700 font-mono">
              {countdown}
            </span>
          )}
        </div>

        <p className="text-xs text-neutral-600 mt-4 font-mono">
          <a
            href={explorer(market.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {market.address}
          </a>
        </p>
      </div>

      {/* ── YES/NO price card ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-neutral-300 bg-surface p-6 mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <span className="font-serif text-[40px] leading-none text-success-400 font-bold">
            YES <span className="font-mono nums text-3xl">{yesPct}¢</span>
          </span>
          <span className="font-serif text-[40px] leading-none text-danger-400 font-bold">
            <span className="font-mono nums text-3xl">{noPct}¢</span> NO
          </span>
        </div>
        <PriceBar yesPrice={market.yesPrice} height="h-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5 text-sm">
          <Stat label="Volume" value={`$${volumeUsdc}`} />
          <Stat label="Liquidity (b)" value={Number(market.liquidityParam).toLocaleString()} />
          <Stat
            label="Threshold"
            value={
              market.marketType === 'absolute'
                ? `${thresholdPct}% APY`
                : 'A vs B'
            }
          />
        </div>
      </section>

      {/* ── Threshold gauge (absolute markets only) ───────────────────────── */}
      {market.marketType === 'absolute' && (
        <section className="rounded-xl border border-neutral-300 bg-surface p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400">
              Threshold gauge
            </h2>
            <span className="font-mono text-xs text-neutral-700">
              Target: {thresholdPct}% APY
            </span>
          </div>
          {thresholdProgress !== null ? (
            <div>
              <div className="h-3 bg-neutral-300 rounded-full overflow-hidden relative">
                <div
                  className={`h-full ${
                    thresholdProgress >= 1 ? 'bg-success-400' : 'bg-amber-400'
                  }`}
                  style={{
                    width: `${Math.min(100, (thresholdProgress / 1.5) * 100)}%`,
                  }}
                />
                {/* threshold marker at 2/3 of the bar (1.0x of 1.5x scale) */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-neutral-700"
                  style={{ left: `${(1 / 1.5) * 100}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 font-mono text-[11px] text-neutral-600">
                <span>0%</span>
                <span>Current: {(liveApy! * 100).toFixed(2)}% APY</span>
                <span>{(thresholdPct)}%</span>
              </div>
            </div>
          ) : (
            <p className="font-mono text-xs text-neutral-600">
              Strategy NAV history not available yet — settlement will use
              on-chain APY at slot{' '}
              <span className="text-neutral-900">{market.resolutionSlot.toLocaleString()}</span>.
            </p>
          )}
        </section>
      )}

      {/* ── Settlement preview ────────────────────────────────────────────── */}
      {settlementOutcome && (
        <section
          className={`rounded-xl border p-4 mb-6 ${
            settlementOutcome === 'yes'
              ? 'border-success-400/40 bg-success-400/5'
              : 'border-danger-400/40 bg-danger-400/5'
          }`}
        >
          <p className="text-sm">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-600 mr-2">
              If resolved now
            </span>
            <span
              className={`font-semibold ${
                settlementOutcome === 'yes' ? 'text-success-400' : 'text-danger-400'
              }`}
            >
              {settlementOutcome.toUpperCase()} would win
            </span>
            <span className="text-neutral-700 ml-2 font-mono text-xs">
              ({(liveApy! * 100).toFixed(2)}% vs {thresholdPct}%)
            </span>
          </p>
        </section>
      )}

      {/* ── Payoff calculator ─────────────────────────────────────────────── */}
      <div className="mb-6">
        <PayoffCalculator
          yesShares={market.yesShares}
          noShares={market.noShares}
          liquidityParam={market.liquidityParam}
          feeBps={market.feeBps}
        />
      </div>

      {/* ── Subsidy + fee + addresses ─────────────────────────────────────── */}
      <section className="rounded-xl border border-neutral-300 bg-surface p-6 mb-6">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-600 mb-4">
          Market parameters
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailRow
            label="Initial subsidy"
            value={
              subsidyEst > 0
                ? `${formatUsdc(subsidyEst)} USDC`
                : '— (fully traded)'
            }
            // SSR-safe: synchronous chaos-pool lookup means our agents'
            // names render without flicker. Real users still get the
            // truncated pubkey in SSR; the SnsName component would
            // upgrade them client-side, but DetailRow is plain text so
            // we use the sync chaos lookup here.
            sub={`by ${
              lookupChaosPoolSync(market.subsidyProvider) ??
              truncate(market.subsidyProvider)
            }`}
            subHref={explorer(market.subsidyProvider)}
          />
          <DetailRow
            label="Trading fee"
            value={`${(market.feeBps / 100).toFixed(2)}%`}
          />
          <DetailRow
            label="Vault"
            value={truncate(market.vault ?? '')}
            valueHref={market.vault ? explorer(market.vault) : undefined}
          />
          <DetailRow
            label="Collateral mint"
            value={truncate(market.collateralMint ?? '')}
            valueHref={
              market.collateralMint ? explorer(market.collateralMint) : undefined
            }
          />
          <DetailRow
            label="Authority"
            value={truncate(market.authority)}
            valueHref={explorer(market.authority)}
          />
          <DetailRow
            label="Resolution slot"
            value={market.resolutionSlot.toLocaleString()}
            sub={
              currentSlot !== null
                ? `Current: ${currentSlot.toLocaleString()}`
                : undefined
            }
          />
          {market.createdAt > 0 && (
            <DetailRow
              label="Created"
              value={new Date(market.createdAt * 1000).toLocaleString()}
            />
          )}
          {market.resolvedAt && (
            <DetailRow
              label="Resolved"
              value={new Date(market.resolvedAt * 1000).toLocaleString()}
            />
          )}
        </div>
      </section>

      {/* ── Holders distribution ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-dashed border-neutral-300 bg-surface p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-600">
          Holders distribution
        </p>
        <p className="text-xs text-neutral-700 mt-2">
          TODO — scanning YES / NO mint token accounts is RPC-heavy on public
          devnet. Will surface top holders once an indexer-backed query is
          available.
        </p>
      </section>
    </main>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderQuestion(question: string): React.ReactNode {
  // Minimal <em>…</em> handling: split on the first em pair, render the
  // middle as italic. Anything more complex falls through as plain text.
  const match = /^(.*?)<em>(.*?)<\/em>(.*)$/s.exec(question)
  if (!match) return question
  const [, before, em, after] = match
  return (
    <>
      {before}
      <em className="italic text-purple-300">{em}</em>
      {after}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-600">
        {label}
      </p>
      <p className="font-mono nums text-sm text-neutral-900 mt-1">{value}</p>
    </div>
  )
}

function DetailRow({
  label,
  value,
  valueHref,
  sub,
  subHref,
}: {
  label: string
  value: string
  valueHref?: string
  sub?: string
  subHref?: string
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-600">
        {label}
      </p>
      {valueHref ? (
        <a
          href={valueHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm text-amber-400 hover:underline mt-1 inline-block"
        >
          {value}
        </a>
      ) : (
        <p className="font-mono text-sm text-neutral-900 mt-1">{value}</p>
      )}
      {sub && (
        subHref ? (
          <a
            href={subHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] text-neutral-600 hover:text-amber-400 mt-1 inline-block"
          >
            {sub}
          </a>
        ) : (
          <p className="font-mono text-[11px] text-neutral-600 mt-1">{sub}</p>
        )
      )}
    </div>
  )
}
