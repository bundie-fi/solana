import Link from 'next/link'
import { fetchStrategies } from '@/lib/chain'

export const revalidate = 30 // revalidate every 30s (ISR)
import { mockStrategies } from '@yields-so/common'
import type { StrategyDisplay } from '@yields-so/common'

function StrategyCard({ s }: { s: StrategyDisplay }) {
  const apy = s.apy > 0 ? `${s.apy.toFixed(1)}%` : '—'
  const tvl = s.tvl >= 1000
    ? `$${(s.tvl / 1000).toFixed(1)}k`
    : `$${s.tvl.toFixed(0)}`

  return (
    <div className="rounded-xl border border-border bg-surface p-5 hover:border-earn-gold/40 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white">{s.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5 font-mono">
            {s.address.slice(0, 8)}…{s.address.slice(-4)}
          </p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          s.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'
        }`}>
          {s.status}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg font-bold text-earn-gold">{apy}</p>
          <p className="text-xs text-gray-500">APY</p>
        </div>
        <div>
          <p className="text-lg font-bold text-white">{tvl}</p>
          <p className="text-xs text-gray-500">TVL</p>
        </div>
        <div>
          <p className="text-lg font-bold text-white">{s.investorCount}</p>
          <p className="text-xs text-gray-500">Investors</p>
        </div>
      </div>

      {s.creatorName && (
        <p className="text-xs text-gray-500 mt-3 font-mono">by {s.creatorName}</p>
      )}
    </div>
  )
}

export default async function DiscoverPage() {
  let liveStrategies: StrategyDisplay[] = []
  try {
    liveStrategies = await fetchStrategies()
  } catch {
    // Fall through to mock data
  }

  const showLive = liveStrategies.length > 0

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-earn-gold mb-1">Discover</h1>
      <p className="text-gray-400 mb-8">Strategy Leaderboard — Solana Devnet</p>

      {showLive && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <h2 className="text-sm font-medium text-green-400 uppercase tracking-wider">Live on devnet</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveStrategies.map(s => (
              <Link key={s.address} href={`/strategy/${s.address}`} className="block">
                <StrategyCard s={s} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        {showLive && (
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">
            Coming soon
          </h2>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockStrategies.map(s => (
            <div key={s.address} className="opacity-40">
              <StrategyCard s={s} />
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
