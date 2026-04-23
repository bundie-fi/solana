import { notFound } from 'next/navigation'
import { fetchStrategy } from '@/lib/chain'
import { BuySharesPanel } from '@/components/BuySharesPanel'

export const revalidate = 30

export default async function StrategyDetailPage({
  params,
}: {
  params: { id: string }
}) {
  let strategy = null
  try {
    strategy = await fetchStrategy(params.id)
  } catch {
    // invalid pubkey or RPC error — fall through to notFound
  }

  if (!strategy) notFound()

  const tvlDisplay =
    strategy.tvl >= 1_000_000
      ? `$${(strategy.tvl / 1_000_000).toFixed(2)}M`
      : strategy.tvl >= 1000
      ? `$${(strategy.tvl / 1000).toFixed(1)}k`
      : `$${strategy.tvl.toFixed(2)}`

  const sharePriceDisplay = `$${strategy.sharePrice.toFixed(6)}`
  const feeDisplay = `${(strategy.feeBps / 100).toFixed(2)}%`

  const statusColor =
    strategy.status === 'active'
      ? 'bg-green-500/10 text-green-400'
      : strategy.status === 'paused'
      ? 'bg-yellow-500/10 text-yellow-400'
      : 'bg-gray-500/10 text-gray-400'

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-2 flex-wrap gap-4">
        <div>
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400">
            Strategy
          </span>
          <h1 className="font-serif text-display text-neutral-900 mt-1">
            {strategy.name}
          </h1>
          <p className="text-xs text-neutral-600 mt-2 font-mono">
            {params.id}
          </p>
        </div>
        <span
          className={`text-sm px-3 py-1 rounded-full font-medium ${statusColor}`}
        >
          {strategy.status}
        </span>
      </div>

      <p className="text-xs text-neutral-600 mb-8 font-mono">
        Creator:{' '}
        <a
          href={`https://orbmarkets.io/address/${strategy.authority}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-amber-400 hover:underline"
        >
          {strategy.authority.slice(0, 8)}…{strategy.authority.slice(-6)}
        </a>
      </p>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Share Price" value={sharePriceDisplay} gold />
        <StatCard label="TVL" value={tvlDisplay} />
        <StatCard label="Investors" value={String(strategy.investorCount)} />
        <StatCard label="Mgmt Fee" value={feeDisplay} />
      </div>

      {/* Main content: details + buy panel side by side on wide screens */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: extra details */}
        <div className="flex-1 rounded-xl border border-neutral-300 bg-surface p-6 space-y-4">
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-600">
            On-chain details
          </h2>

          <DetailRow label="Share Mint" value={strategy.mint} isAddress />
          <DetailRow label="Protocol Wallet" value={strategy.wallet} isAddress />
          <DetailRow
            label="Total Deposits"
            value={`${(Number(strategy.totalDeposits) / 1e6).toFixed(2)} USDC`}
          />
          <DetailRow
            label="Current NAV"
            value={`${(Number(strategy.currentNav) / 1e6).toFixed(2)} USDC`}
          />
          <DetailRow
            label="Total Shares"
            value={Number(strategy.totalShares).toLocaleString()}
          />
          <DetailRow
            label="High-Water Mark"
            value={`${(Number(strategy.highWaterMark) / 1e6).toFixed(2)} USDC`}
          />
          <DetailRow
            label="Min Deposit"
            value={`${(Number(strategy.minDeposit) / 1e6).toFixed(2)} USDC`}
          />
          {strategy.createdAt > 0 && (
            <DetailRow
              label="Created"
              value={new Date(strategy.createdAt * 1000).toLocaleDateString()}
            />
          )}
        </div>

        {/* Right: buy panel */}
        <div className="w-full lg:w-80 shrink-0">
          <BuySharesPanel
            strategyAddress={params.id}
            mintAddress={strategy.mint}
          />
        </div>
      </div>
    </main>
  )
}

function StatCard({
  label,
  value,
  gold,
}: {
  label: string
  value: string
  gold?: boolean
}) {
  return (
    <div className="rounded-xl border border-neutral-300 bg-surface p-4 text-center">
      <p className={`font-mono nums text-2xl font-semibold ${gold ? 'text-amber-400' : 'text-neutral-900'}`}>
        {value}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-600 mt-2">
        {label}
      </p>
    </div>
  )
}

function DetailRow({
  label,
  value,
  isAddress,
}: {
  label: string
  value: string
  isAddress?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-neutral-600 shrink-0">{label}</span>
      {isAddress ? (
        <a
          href={`https://orbmarkets.io/address/${value}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-amber-400 hover:underline truncate max-w-[260px]"
        >
          {value.slice(0, 8)}…{value.slice(-6)}
        </a>
      ) : (
        <span className="text-neutral-900 font-mono text-xs truncate max-w-[260px]">
          {value}
        </span>
      )}
    </div>
  )
}
