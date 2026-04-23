import { Connection, PublicKey } from '@solana/web3.js'
import type { StrategyDisplay } from '@bundie/common'
import type { MarketDisplay } from '@bundie/common'

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com'

const STRATEGY_PROGRAM_ID = new PublicKey('Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm')
const PREDICTION_PROGRAM_ID = new PublicKey('Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4')

// pinocchio strategy discriminator (from state/strategy.rs)
const STRATEGY_DISC = Buffer.from([0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11])
const STRATEGY_LEN = 330

// Anchor market discriminator: sha256("account:Market")[0..8]
const MARKET_DISC = Buffer.from([219, 190, 213, 55, 0, 227, 198, 154])

// ── Strategy deserializer ─────────────────────────────────────────────────────
// Layout (330 bytes) from programs/strategy-token/src/state/strategy.rs

function deserializeStrategy(address: string, data: Buffer): StrategyDisplay | null {
  if (data.length < STRATEGY_LEN) return null
  if (!data.slice(0, 8).equals(STRATEGY_DISC)) return null

  const nameBytes = data.slice(200, 232)
  const name = nameBytes.toString('utf-8').replace(/\0/g, '').trim()
  if (!name) return null

  const statusByte = data[233]
  const status = (['active', 'paused', 'closed'][statusByte] ?? 'active') as 'active' | 'paused' | 'closed'

  const totalDeposits = data.readBigUInt64LE(236)
  const currentNav    = data.readBigUInt64LE(244)
  const totalShares   = data.readBigUInt64LE(252)
  const totalInvestors = data.readUInt32LE(260)
  const highWaterMark = data.readBigUInt64LE(264)
  const minDeposit    = data.readBigUInt64LE(272)
  const createdAt     = Number(data.readBigInt64LE(312))

  const sharePrice = totalShares > 0n ? Number(currentNav) / Number(totalShares) : 1.0

  return {
    address,
    authority:       new PublicKey(data.slice(8,  40)).toBase58(),
    mint:            new PublicKey(data.slice(40, 72)).toBase58(),
    wallet:          new PublicKey(data.slice(72, 104)).toBase58(),
    protocol:        new PublicKey(data.slice(136,168)).toBase58(),
    name,
    feeBps:          data.readUInt16LE(234),
    totalDeposits,
    currentNav,
    totalShares,
    totalInvestors,
    highWaterMark,
    minDeposit,
    status,
    sharePrice,
    createdAt,
    // Computed display fields — NAV snapshots not available yet on fresh devnet
    tvl:         Number(totalDeposits) / 1e6,
    apy:         0,
    investorCount: totalInvestors,
    performance: { day: 0, week: 0, month: 0, all: 0 },
  }
}

// ── Market deserializer ───────────────────────────────────────────────────────
// Anchor borsh layout from programs/prediction-market/src/state/market.rs

function deserializeMarket(address: string, data: Buffer): MarketDisplay | null {
  if (data.length < 8) return null
  if (!data.slice(0, 8).equals(MARKET_DISC)) return null

  let off = 8

  const strategy = new PublicKey(data.slice(off, off + 32)).toBase58(); off += 32

  // Option<Pubkey>
  let strategyB: string | undefined
  if (data[off++] === 1) { strategyB = new PublicKey(data.slice(off, off + 32)).toBase58(); off += 32 }

  const authority       = new PublicKey(data.slice(off, off + 32)).toBase58(); off += 32
  const subsidyProvider = new PublicKey(data.slice(off, off + 32)).toBase58(); off += 32

  // String (4-byte length prefix)
  const qLen    = data.readUInt32LE(off); off += 4
  const question = data.slice(off, off + qLen).toString('utf-8'); off += qLen

  const marketType = data[off++] === 0 ? 'absolute' : 'relative' as const
  const marketId   = Number(data.readBigUInt64LE(off)); off += 8
  const thresholdBps = Number(data.readBigUInt64LE(off)); off += 8
  const resolutionSlot = Number(data.readBigUInt64LE(off)); off += 8

  const yesShares    = data.readBigUInt64LE(off); off += 8
  const noShares     = data.readBigUInt64LE(off); off += 8
  const totalYesCost = data.readBigUInt64LE(off); off += 8
  const totalNoCost  = data.readBigUInt64LE(off); off += 8
  const liquidityParam = data.readBigUInt64LE(off); off += 8
  const totalVolume  = data.readBigUInt64LE(off); off += 8
  const feeBps       = data.readUInt16LE(off); off += 2

  const vault          = new PublicKey(data.slice(off, off + 32)).toBase58(); off += 32
  const collateralMint = new PublicKey(data.slice(off, off + 32)).toBase58(); off += 32

  // Option<Outcome>
  let outcome: 'yes' | 'no' | undefined
  if (data[off++] === 1) { outcome = data[off++] === 0 ? 'yes' : 'no' }

  const status    = data[off++] === 0 ? 'active' : 'resolved' as const
  const createdAt = Number(data.readBigInt64LE(off)); off += 8

  // Option<i64>
  let resolvedAt: number | undefined
  if (data[off++] === 1) { resolvedAt = Number(data.readBigInt64LE(off)); off += 8 }

  // LS-LMSR price approximation: p(yes) = exp(q_yes/b) / (exp(q_yes/b) + exp(q_no/b))
  const b  = Number(liquidityParam)
  const qY = Number(yesShares)
  const qN = Number(noShares)
  let yesPrice = 0.5
  let noPrice  = 0.5
  if (b > 0) {
    const eY = Math.exp(qY / b)
    const eN = Math.exp(qN / b)
    yesPrice = eY / (eY + eN)
    noPrice  = eN / (eY + eN)
  }

  return {
    address,
    strategy,
    strategyB,
    authority,
    subsidyProvider,
    question,
    marketType,
    marketId,
    thresholdBps,
    resolutionSlot,
    yesShares,
    noShares,
    totalYesCost,
    totalNoCost,
    liquidityParam,
    totalVolume,
    feeBps,
    status,
    outcome,
    createdAt,
    resolvedAt,
    yesPrice,
    noPrice,
    strategyName: '', // filled by caller
  }
}

// ── Public fetch functions ────────────────────────────────────────────────────

export async function fetchStrategy(address: string): Promise<StrategyDisplay | null> {
  const conn = new Connection(RPC, 'confirmed')
  const pubkey = new PublicKey(address)
  const info = await conn.getAccountInfo(pubkey)
  if (!info) return null
  return deserializeStrategy(address, Buffer.from(info.data))
}

export async function fetchStrategies(): Promise<StrategyDisplay[]> {
  const conn = new Connection(RPC, 'confirmed')

  const accounts = await conn.getProgramAccounts(STRATEGY_PROGRAM_ID, {
    filters: [
      { dataSize: STRATEGY_LEN },
      { memcmp: { offset: 0, bytes: STRATEGY_DISC.toString('base64'), encoding: 'base64' } },
    ],
  })

  return accounts
    .map(({ pubkey, account }) =>
      deserializeStrategy(pubkey.toBase58(), Buffer.from(account.data))
    )
    .filter((s): s is StrategyDisplay => s !== null)
    .sort((a, b) => b.tvl - a.tvl)
}

export async function fetchMarkets(strategies: StrategyDisplay[]): Promise<MarketDisplay[]> {
  const conn = new Connection(RPC, 'confirmed')

  const accounts = await conn.getProgramAccounts(PREDICTION_PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: MARKET_DISC.toString('base64'), encoding: 'base64' } },
    ],
  })

  const strategyMap = new Map(strategies.map(s => [s.address, s.name]))

  return accounts
    .map(({ pubkey, account }) => {
      const m = deserializeMarket(pubkey.toBase58(), Buffer.from(account.data))
      if (!m) return null
      m.strategyName = strategyMap.get(m.strategy) ?? m.strategy.slice(0, 8) + '...'
      return m
    })
    .filter((m): m is MarketDisplay => m !== null)
    .sort((a, b) => Number(b.totalVolume) - Number(a.totalVolume))
}
