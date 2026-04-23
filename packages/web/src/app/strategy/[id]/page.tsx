import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Connection, PublicKey } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  fetchStrategy,
  fetchStrategies,
  fetchMarkets,
  fetchProtocolCoverage,
  fetchRecentActivity,
  type ActivityEntry,
} from '@/lib/chain'
import { PROTOCOLS, type Protocol } from '@/lib/protocols'
import { Sparkline } from '@/components/ui/Sparkline'
import { BuySharesPanel } from '@/components/BuySharesPanel'
import type { MarketDisplay, StrategyDisplay } from '@bundie/common'

export const revalidate = 30

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com'
// Solana mainnet/devnet slot time is ≈ 400ms. Used for resolution-countdown
// formatting; good enough for "≈ N days" rounding.
const SLOT_MS = 400
// SPL Token v1 account layout: mint @ offset 0 (32B), owner @ 32 (32B),
// amount @ 64 (8B LE u64). Total 165 bytes.
const TOKEN_ACCOUNT_LEN = 165

// "Recent activity" is rendered below the Top backers section. Implementation
// note: the underlying fetch (chain.ts::fetchRecentActivity) Promise.allSettleds
// the per-sig getTransaction calls and caches the result for 60s per strategy
// to keep public-devnet 429s manageable.

interface NavSnapshot {
  slot: number
  navPerShare: number
  timestamp: number
}

// Defensive accessor for fields the chain.ts agent is wiring in parallel.
function getNavHistory(strategy: StrategyDisplay): NavSnapshot[] {
  const maybe = (strategy as unknown as { navHistory?: NavSnapshot[] }).navHistory
  return Array.isArray(maybe) ? maybe : []
}

function getLastSnapshotSlot(strategy: StrategyDisplay): number | undefined {
  return (strategy as unknown as { lastSnapshotSlot?: number }).lastSnapshotSlot
}

function formatRelative(secondsAgo: number): string {
  if (secondsAgo < 60) return `${secondsAgo}s ago`
  const m = Math.floor(secondsAgo / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatSlotsRemaining(slotsRemaining: number): string {
  if (slotsRemaining <= 0) return 'resolves now'
  const ms = slotsRemaining * SLOT_MS
  const days = ms / 86_400_000
  if (days >= 1) return `≈ ${Math.round(days)}d`
  const hours = ms / 3_600_000
  if (hours >= 1) return `≈ ${Math.round(hours)}h`
  const minutes = ms / 60_000
  return `≈ ${Math.max(1, Math.round(minutes))}m`
}

interface TopBacker {
  owner: string
  uiAmount: number
}

async function fetchTopBackers(mint: string): Promise<TopBacker[]> {
  try {
    const conn = new Connection(RPC, 'confirmed')
    // SPL Token v1 token accounts are 165 bytes; mint is at offset 0.
    const accounts = await conn.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        { dataSize: TOKEN_ACCOUNT_LEN },
        { memcmp: { offset: 0, bytes: mint } },
      ],
    })

    return accounts
      .map(({ account }) => {
        const data = Buffer.from(account.data)
        const owner = new PublicKey(data.slice(32, 64)).toBase58()
        // Strategy share mints are 6 decimals (matches USDC base unit).
        const amount = data.readBigUInt64LE(64)
        const uiAmount = Number(amount) / 1e6
        return { owner, uiAmount }
      })
      .filter((b) => b.uiAmount > 0)
      .sort((a, b) => b.uiAmount - a.uiAmount)
      .slice(0, 5)
  } catch {
    return []
  }
}

async function fetchOpenMarketsForStrategy(
  strategyAddress: string,
): Promise<{ markets: MarketDisplay[]; currentSlot: number }> {
  try {
    const conn = new Connection(RPC, 'confirmed')
    const [strategies, currentSlot] = await Promise.all([
      fetchStrategies(),
      conn.getSlot('confirmed'),
    ])
    const allMarkets = await fetchMarkets(strategies)
    const markets = allMarkets.filter(
      (m) => m.strategy === strategyAddress && m.status === 'active',
    )
    return { markets, currentSlot }
  } catch {
    return { markets: [], currentSlot: 0 }
  }
}

export default async function StrategyDetailPage({
  params,
}: {
  params: { id: string }
}) {
  let strategy: StrategyDisplay | null = null
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

  // ── Section data ─────────────────────────────────────────────────────────
  const navHistory = getNavHistory(strategy)
  const lastSnapshotSlot = getLastSnapshotSlot(strategy)
  const sparkData = navHistory.map((p) => p.navPerShare)
  const lastSnapshotTs =
    navHistory.length > 0
      ? navHistory[navHistory.length - 1].timestamp
      : undefined
  const nowSec = Math.floor(Date.now() / 1000)
  const lastUpdatedRel =
    lastSnapshotTs && lastSnapshotTs > 0
      ? formatRelative(Math.max(0, nowSec - lastSnapshotTs))
      : lastSnapshotSlot
      ? `slot ${lastSnapshotSlot}`
      : 'unknown'

  // findProtocol() in lib/protocols looks up by canonical id, but the strategy
  // account stores a program ID — walk the catalog by programId instead. Used
  // as the fallback chip when no rebalance history exists yet.
  const matchedProtocol: Protocol | undefined = PROTOCOLS.find(
    (p) => p.programId === strategy!.protocol,
  )

  const [{ markets: openMarkets, currentSlot }, topBackers, coverageRaw, activity] =
    await Promise.all([
      fetchOpenMarketsForStrategy(params.id),
      fetchTopBackers(strategy.mint),
      fetchProtocolCoverage(new PublicKey(params.id)).catch(() => []),
      fetchRecentActivity(new PublicKey(params.id)).catch(
        () => [] as ActivityEntry[],
      ),
    ])

  // Resolve each program ID against the static catalog. Unknown program IDs
  // (not yet wired into lib/protocols) still get rendered with a truncated
  // pubkey so we never silently drop on-chain truth.
  const coverage: { protocol: Protocol | undefined; programId: string; legs: number }[] =
    coverageRaw.map((c) => ({
      protocol: PROTOCOLS.find((p) => p.programId === c.protocolId),
      programId: c.protocolId,
      legs: c.legs,
    }))

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
        {/* Left column: enrichment sections + on-chain details */}
        <div className="flex-1 space-y-6">
          {/* NAV sparkline */}
          {sparkData.length > 0 && (
            <div className="rounded-xl border border-neutral-300 bg-surface p-6">
              <div className="flex items-end justify-between gap-4 mb-3">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-600">
                  NAV per share
                </h2>
                <p className="font-mono text-[10px] text-neutral-600">
                  last updated {lastUpdatedRel}
                </p>
              </div>
              <div className="text-amber-400">
                <Sparkline
                  data={sparkData}
                  width={480}
                  height={64}
                  strokeWidth={1.75}
                  className="w-full h-16"
                />
              </div>
            </div>
          )}

          {/* Position composition — derived from rebalance ix history. Empty
              coverage (e.g. fresh strategy with no rebalances yet) falls back
              to the single metadata-protocol chip so the section still renders. */}
          <section className="rounded-xl border border-neutral-300 bg-surface p-6">
            <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-600 mb-4">
              Position composition
            </h2>
            {coverage.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {coverage.map((c) =>
                  c.protocol ? (
                    <ProtocolChip
                      key={c.programId}
                      protocol={c.protocol}
                      legs={c.legs}
                    />
                  ) : (
                    <span
                      key={c.programId}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-neutral-300 bg-neutral-0/40 font-mono text-[11px] font-medium text-neutral-700"
                      title={`Unmapped protocol ${c.programId}`}
                    >
                      <span className="uppercase tracking-[0.12em] opacity-70">
                        Unmapped
                      </span>
                      <span className="opacity-30" aria-hidden="true">·</span>
                      <span className="text-neutral-600">
                        {c.programId.slice(0, 8)}…{c.programId.slice(-6)}
                      </span>
                      <span className="opacity-30" aria-hidden="true">·</span>
                      <span>{c.legs} {c.legs === 1 ? 'leg' : 'legs'}</span>
                    </span>
                  ),
                )}
              </div>
            ) : matchedProtocol ? (
              <div className="flex items-center justify-between gap-4">
                <ProtocolChip protocol={matchedProtocol} />
                <span className="font-mono nums text-sm text-neutral-900">
                  100%
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-neutral-300 bg-neutral-0/40 font-mono text-[11px] font-medium text-neutral-700">
                  External / unmapped
                  <span className="opacity-30" aria-hidden="true">·</span>
                  <span className="text-neutral-600">
                    {strategy.protocol.slice(0, 8)}…{strategy.protocol.slice(-6)}
                  </span>
                </span>
                <span className="font-mono nums text-sm text-neutral-900">
                  100%
                </span>
              </div>
            )}
          </section>

          {/* Open prediction markets */}
          <section className="rounded-xl border border-neutral-300 bg-surface p-6">
            <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-purple-300 mb-4">
              Open markets
            </h2>
            {openMarkets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center">
                <p className="text-sm text-neutral-700">
                  No open markets on this strategy.
                </p>
                <p className="text-xs text-neutral-600 mt-1 font-mono">
                  Anyone can open one via{' '}
                  <span className="text-purple-300">bundie-sol create-market</span>.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {openMarkets.map((m) => {
                  const yesPct = Math.round(m.yesPrice * 100)
                  const noPct = Math.round(m.noPrice * 100)
                  const vol = (Number(m.totalVolume) / 1e6).toFixed(2)
                  const slotsRemaining = Math.max(
                    0,
                    m.resolutionSlot - currentSlot,
                  )
                  const truncatedQ =
                    m.question.length > 80
                      ? m.question.slice(0, 80) + '…'
                      : m.question
                  return (
                    <li key={m.address}>
                      <Link
                        href={`/market/${m.address}`}
                        className="block rounded-xl border border-neutral-300 bg-background p-4 hover:border-purple-500/40 transition-colors"
                      >
                        <p className="text-sm text-neutral-900 leading-snug">
                          {truncatedQ}
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-3 mt-3 font-mono text-xs">
                          <div className="flex items-center gap-3">
                            <span className="text-success-400 font-semibold">
                              YES {yesPct}¢
                            </span>
                            <span className="text-danger-400 font-semibold">
                              NO {noPct}¢
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-neutral-600">
                            <span>Vol ${vol}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatSlotsRemaining(slotsRemaining)}</span>
                          </div>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Top backers */}
          <section className="rounded-xl border border-neutral-300 bg-surface p-6">
            <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400 mb-4">
              Top backers
            </h2>
            {topBackers.length === 0 ? (
              <p className="text-sm text-neutral-700">
                No share holders yet. Be the first to back this strategy.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-300">
                {topBackers.map((b) => (
                  <li
                    key={b.owner}
                    className="flex items-center justify-between gap-4 py-2 text-sm"
                  >
                    <a
                      href={`https://orbmarkets.io/address/${b.owner}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-amber-400 hover:underline truncate"
                    >
                      {b.owner.slice(0, 8)}…{b.owner.slice(-6)}
                    </a>
                    <span className="font-mono nums text-neutral-900">
                      {b.uiAmount.toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recent activity — last N decoded strategy-token ixs touching this
              strategy. fetchRecentActivity caches per-strategy for 60s and
              tolerates per-sig RPC failures (drops the row, keeps rendering). */}
          <section className="rounded-xl border border-neutral-300 bg-surface p-6">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600 mb-4">
              Recent activity
            </h2>
            {activity.length === 0 ? (
              <p className="text-sm text-neutral-700">No on-chain activity yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-300">
                {activity.map((a) => {
                  const rel =
                    a.blockTime && a.blockTime > 0
                      ? formatRelative(Math.max(0, nowSec - a.blockTime))
                      : `slot ${a.slot}`
                  const protoName =
                    a.protocol &&
                    (PROTOCOLS.find((p) => p.programId === a.protocol)?.name ??
                      `${a.protocol.slice(0, 4)}…${a.protocol.slice(-4)}`)
                  const chipTone =
                    a.kind === 'deposit' || a.kind === 'create'
                      ? 'bg-amber-600/10 text-amber-400 border-amber-600/40'
                      : a.kind === 'redeem'
                      ? 'bg-danger-400/10 text-danger-400 border-danger-400/40'
                      : a.kind === 'perp'
                      ? 'bg-purple-500/10 text-purple-300 border-purple-500/40'
                      : 'bg-neutral-0/40 text-neutral-700 border-neutral-300'
                  return (
                    <li
                      key={`${a.signature}-${a.kind}`}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border font-mono text-[10px] uppercase tracking-[0.08em] ${chipTone}`}
                        >
                          {a.label}
                        </span>
                        {a.amount && (
                          <span className="font-mono nums text-xs text-neutral-900 truncate">
                            {a.amount}
                          </span>
                        )}
                        {protoName && (
                          <>
                            <span
                              className="opacity-30 font-mono text-[10px]"
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <span className="font-mono text-[11px] text-neutral-700 truncate">
                              {protoName}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[10px] text-neutral-600">
                          {rel}
                        </span>
                        <a
                          href={`https://orbmarkets.io/tx/${a.signature}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] text-amber-400 hover:underline"
                        >
                          tx ↗
                        </a>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* On-chain details */}
          <div className="rounded-xl border border-neutral-300 bg-surface p-6 space-y-4">
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

// Lifted from ProtocolCoverage.tsx — shared chip styling, kept inline to avoid
// pulling in a "use client" component for what is otherwise pure markup.
function ProtocolChip({
  protocol,
  legs,
}: {
  protocol: Protocol
  legs?: number
}) {
  const tone =
    protocol.category === 'deposit'
      ? {
          label: 'Deposit',
          chip: 'bg-amber-600/10 text-amber-400 border-amber-600/40',
        }
      : protocol.category === 'perps'
      ? {
          label: 'Perps',
          chip: 'bg-purple-500/10 text-purple-300 border-purple-500/40',
        }
      : {
          label: 'Swap',
          chip: 'bg-neutral-0/40 text-neutral-800 border-neutral-300',
        }
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border',
        'font-mono text-[11px] font-medium tracking-[0.04em]',
        tone.chip,
      ].join(' ')}
      title={`${protocol.name} — ${tone.label}${
        legs !== undefined ? ` · ${legs} ${legs === 1 ? 'leg' : 'legs'}` : ''
      }`}
    >
      <span className="uppercase tracking-[0.12em] opacity-70">
        {tone.label}
      </span>
      <span className="opacity-30" aria-hidden="true">·</span>
      <span>{protocol.name}</span>
      {legs !== undefined && (
        <>
          <span className="opacity-30" aria-hidden="true">·</span>
          <span className="nums">{legs} {legs === 1 ? 'leg' : 'legs'}</span>
        </>
      )}
    </span>
  )
}
