import { fetchStrategies, fetchMarkets } from '@/lib/chain'
import { MarketCardInteractive } from '@/components/MarketCardInteractive'

export const revalidate = 30 // revalidate every 30s (ISR)
import { mockMarkets } from '@bundie/common'
import type { MarketDisplay } from '@bundie/common'

function PriceBar({ yesPrice }: { yesPrice: number }) {
  const yesPct = Math.round(yesPrice * 100)
  const noPct  = 100 - yesPct
  return (
    <div className="flex h-2 rounded-full overflow-hidden mt-3">
      <div className="bg-green-500" style={{ width: `${yesPct}%` }} />
      <div className="bg-red-500"   style={{ width: `${noPct}%` }} />
    </div>
  )
}

// Read-only card used for mock/preview markets (no interactivity needed)
function MarketCardStatic({ m }: { m: MarketDisplay }) {
  const yesPct = Math.round(m.yesPrice * 100)
  const noPct  = Math.round(m.noPrice  * 100)
  const vol    = Number(m.totalVolume) / 1e6

  return (
    <div className="rounded-xl border border-neutral-300 bg-surface p-5">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs px-2 py-0.5 rounded-full bg-predict-purple/10 text-predict-purple font-medium">
          {m.marketType === 'absolute' ? 'Performance' : 'Vs Match'}
        </span>
        <span className={`text-xs font-medium ${m.status === 'active' ? 'text-success-400' : 'text-neutral-700'}`}>
          {m.status === 'resolved' ? `Settled: ${m.outcome?.toUpperCase()}` : 'Active'}
        </span>
      </div>

      <p className="text-sm text-neutral-900 font-medium mt-2 mb-1 leading-snug">{m.question}</p>
      <p className="text-xs text-neutral-600 font-mono mb-3">{m.strategyName}</p>

      <div className="flex justify-between text-sm font-semibold mb-1">
        <span className="text-success-400">YES {yesPct}¢</span>
        <span className="text-danger-400">NO {noPct}¢</span>
      </div>
      <PriceBar yesPrice={m.yesPrice} />

      <p className="text-xs text-neutral-600 mt-3">Vol: ${vol.toFixed(2)}</p>
    </div>
  )
}

export default async function MarketsPage() {
  let liveMarkets: MarketDisplay[] = []
  try {
    const strategies = await fetchStrategies()
    liveMarkets = await fetchMarkets(strategies)
  } catch {
    // Fall through to mock data
  }

  const showLive = liveMarkets.length > 0

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-purple-300">
        Predict mode
      </span>
      <h1 className="font-serif text-display text-neutral-900 mt-1 mb-2">
        <em className="text-purple-300">Markets</em>.
      </h1>
      <p className="text-neutral-700 mb-8">LS-LMSR pricing. On-chain settlement reads strategy NAV.</p>

      {showLive && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <h2 className="text-sm font-medium text-success-400 uppercase tracking-wider">Live on devnet</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveMarkets.map(m => (
              <MarketCardInteractive key={m.address} m={m} />
            ))}
          </div>
        </section>
      )}

      <section>
        {showLive && (
          <h2 className="text-sm font-medium text-neutral-600 uppercase tracking-wider mb-4">
            Coming soon
          </h2>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockMarkets.map(m => (
            <div key={m.address} className="opacity-40">
              <MarketCardStatic m={m} />
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
