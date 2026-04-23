import { fetchStrategies, fetchMarkets } from '@/lib/chain'
import { MarketCardInteractive } from '@/components/MarketCardInteractive'
import type { MarketDisplay } from '@bundie/common'

export const revalidate = 30 // revalidate every 30s (ISR)

export default async function MarketsPage() {
  let liveMarkets: MarketDisplay[] = []
  try {
    const strategies = await fetchStrategies()
    liveMarkets = await fetchMarkets(strategies)
  } catch {
    // RPC failure — render empty state; never substitute mock data.
  }

  const hasLive = liveMarkets.length > 0

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-purple-300">
        Predict mode
      </span>
      <h1 className="font-serif text-display text-neutral-900 mt-1 mb-2">
        <em className="text-purple-300">Markets</em>.
      </h1>
      <p className="text-neutral-700 mb-8">LS-LMSR pricing. On-chain settlement reads strategy NAV.</p>

      {hasLive ? (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-success-400 animate-pulse" />
            <h2 className="font-mono text-[11px] font-medium text-success-400 uppercase tracking-[0.18em]">
              Live on devnet
            </h2>
            <span className="font-mono text-xs text-neutral-600 nums">{liveMarkets.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveMarkets.map(m => (
              <MarketCardInteractive key={m.address} m={m} />
            ))}
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-surface p-10 text-center">
          <p className="font-serif text-[22px] text-neutral-900 mb-2">
            No live markets yet.
          </p>
          <p className="text-sm text-neutral-700 max-w-md mx-auto">
            A market opens once a strategy hits a settable threshold. Back a
            strategy on Discover or wait for the first one to qualify.
          </p>
        </div>
      )}
    </main>
  )
}
