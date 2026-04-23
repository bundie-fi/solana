import { Connection, PublicKey } from '@solana/web3.js'
import type { NavHistoryPoint, StrategyDisplay } from '@bundie/common'
import type { MarketDisplay } from '@bundie/common'

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com'

const STRATEGY_PROGRAM_ID = new PublicKey('Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm')
const PREDICTION_PROGRAM_ID = new PublicKey('Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4')

// pinocchio strategy discriminator (from state/strategy.rs)
const STRATEGY_DISC = Buffer.from([0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11])
const STRATEGY_LEN = 330

// Anchor market discriminator: sha256("account:Market")[0..8]
const MARKET_DISC = Buffer.from([219, 190, 213, 55, 0, 227, 198, 154])

// NavOracle (state/nav_oracle.rs)
const NAV_ORACLE_DISC = Buffer.from([0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05])
const NAV_ORACLE_LEN = 89
// PositionSnapshots (state/position_snapshots.rs)
const POSITION_SNAPSHOTS_DISC = Buffer.from([0x7d, 0xa9, 0x1f, 0x4c, 0x62, 0x30, 0x8b, 0xe1])
const POSITION_SNAPSHOTS_LEN = 161

// First-byte instruction discriminator for update_nav (lib.rs::process_instruction = 3)
const UPDATE_NAV_IX_TAG = 0x03
// First-byte instruction discriminator for rebalance (dispatch byte 4)
const REBALANCE_IX_TAG = 0x04
// rebalance ix layout: account[0] = authority, account[1] = strategy,
// then remaining_accounts begin at index 2; the FIRST remaining account
// is the protocol program ID Beethoven's Context detector keys off.
const REBALANCE_PROTOCOL_ACCOUNT_INDEX = 2
// Solana mainnet/devnet target: 400ms slots → ~78,840,000 slots/year.
// nav_per_share is 1e9-scaled per update_nav.rs but the ratio between two
// samples cancels the scale, so we don't need NAV_SCALE for APY.
const SLOTS_PER_YEAR = (365 * 24 * 60 * 60 * 1000) / 400

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

// ── NavOracle / PositionSnapshots ─────────────────────────────────────────────
// On-chain layout per programs/strategy-token/src/state/{nav_oracle,position_snapshots}.rs.
// Both PDAs are derived against the strategy-token program ID:
//   nav_oracle:        ["nav",                strategy_pubkey]
//   position_snapshots ["position_snapshots", strategy_pubkey]   (note: NOT "snapshots")

export interface NavOracleData {
  strategy: string
  navPerShare: bigint        // 1e9-scaled
  twapValue: bigint          // 1e9-scaled
  snapshotCount: bigint
  lastSnapshotSlot: bigint
  minSnapshotInterval: bigint
  twapWindow: bigint
  bump: number
}

export interface PositionSnapshotData {
  strategy: string
  snapshotAt: bigint        // unix seconds (i64 → bigint, callers can Number() it)
  snapshotSlot: bigint
  protocol: string
  reserve: string
  portfolioValue: bigint    // USDC base units
  totalShares: bigint
  navPerShare: bigint       // 1e9-scaled
  highWaterMark: bigint     // 1e9-scaled
  snapshotCount: bigint
  bump: number
}

function navOraclePda(strategy: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('nav'), strategy.toBuffer()],
    STRATEGY_PROGRAM_ID,
  )[0]
}

function positionSnapshotsPda(strategy: PublicKey): PublicKey {
  // Seed verified against snapshot_positions.rs:60 — it's "position_snapshots"
  // (the spec's shorthand "snapshots" would derive a different address).
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position_snapshots'), strategy.toBuffer()],
    STRATEGY_PROGRAM_ID,
  )[0]
}

function deserializeNavOracle(data: Buffer): NavOracleData | null {
  if (data.length < NAV_ORACLE_LEN) return null
  if (!data.slice(0, 8).equals(NAV_ORACLE_DISC)) return null
  return {
    strategy:            new PublicKey(data.slice(8, 40)).toBase58(),
    navPerShare:         data.readBigUInt64LE(40),
    twapValue:           data.readBigUInt64LE(48),
    snapshotCount:       data.readBigUInt64LE(56),
    lastSnapshotSlot:    data.readBigUInt64LE(64),
    minSnapshotInterval: data.readBigUInt64LE(72),
    twapWindow:          data.readBigUInt64LE(80),
    bump:                data[88],
  }
}

function deserializePositionSnapshots(data: Buffer): PositionSnapshotData | null {
  if (data.length < POSITION_SNAPSHOTS_LEN) return null
  if (!data.slice(0, 8).equals(POSITION_SNAPSHOTS_DISC)) return null
  return {
    strategy:        new PublicKey(data.slice(8, 40)).toBase58(),
    snapshotAt:      data.readBigInt64LE(40),
    snapshotSlot:    data.readBigUInt64LE(48),
    protocol:        new PublicKey(data.slice(56, 88)).toBase58(),
    reserve:         new PublicKey(data.slice(88, 120)).toBase58(),
    portfolioValue:  data.readBigUInt64LE(120),
    totalShares:     data.readBigUInt64LE(128),
    navPerShare:     data.readBigUInt64LE(136),
    highWaterMark:   data.readBigUInt64LE(144),
    snapshotCount:   data.readBigUInt64LE(152),
    bump:            data[160],
  }
}

export async function fetchNavOracle(
  strategy: PublicKey,
  conn?: Connection,
): Promise<NavOracleData | null> {
  const c = conn ?? new Connection(RPC, 'confirmed')
  const info = await c.getAccountInfo(navOraclePda(strategy))
  if (!info) return null
  return deserializeNavOracle(Buffer.from(info.data))
}

export async function fetchPositionSnapshot(
  strategy: PublicKey,
  conn?: Connection,
): Promise<PositionSnapshotData | null> {
  const c = conn ?? new Connection(RPC, 'confirmed')
  const info = await c.getAccountInfo(positionSnapshotsPda(strategy))
  if (!info) return null
  return deserializePositionSnapshots(Buffer.from(info.data))
}

// ── Protocol coverage (rebalance history scan) ────────────────────────────────
// The strategy account stores a single `protocol` pubkey field but real
// composition is the union of every protocol that appears as the first
// remaining_account on any rebalance ix (dispatch byte 0x04). We walk recent
// signatures touching the strategy, decode each tx's compiled rebalance ixs,
// and tally distinct protocol program IDs along with leg counts. Cached
// per-strategy with a short TTL — rebalances are infrequent and devnet RPC
// throttling is real.

export interface ProtocolCoverageEntry {
  protocolId: string
  legs: number
}

interface ProtocolCoverageCacheEntry {
  fetchedAt: number
  coverage: ProtocolCoverageEntry[]
}
const PROTOCOL_COVERAGE_CACHE = new Map<string, ProtocolCoverageCacheEntry>()
const PROTOCOL_COVERAGE_TTL_MS = 60_000
// Pinned to dampen devnet 429s — getSignaturesForAddress defaults to 1000.
const PROTOCOL_COVERAGE_SIG_LIMIT = 50

export async function fetchProtocolCoverage(
  strategy: PublicKey,
): Promise<ProtocolCoverageEntry[]> {
  const cacheKey = strategy.toBase58()
  const cached = PROTOCOL_COVERAGE_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < PROTOCOL_COVERAGE_TTL_MS) {
    return cached.coverage
  }

  const conn = new Connection(RPC, 'confirmed')
  let sigs: Awaited<ReturnType<Connection['getSignaturesForAddress']>>
  try {
    sigs = await conn.getSignaturesForAddress(strategy, {
      limit: PROTOCOL_COVERAGE_SIG_LIMIT,
    })
  } catch {
    // RPC failure → empty coverage so the UI falls back to its single-chip render.
    PROTOCOL_COVERAGE_CACHE.set(cacheKey, { fetchedAt: Date.now(), coverage: [] })
    return []
  }

  const tally = new Map<string, number>()

  for (const s of sigs) {
    if (s.err) continue
    let tx: Awaited<ReturnType<Connection['getTransaction']>> = null
    try {
      tx = await conn.getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      })
    } catch {
      continue
    }
    if (!tx) continue

    let keys: PublicKey[]
    try {
      keys = tx.transaction.message
        .getAccountKeys({
          accountKeysFromLookups: tx.meta?.loadedAddresses ?? undefined,
        })
        .keySegments()
        .flat()
    } catch {
      continue
    }

    const ixs = tx.transaction.message.compiledInstructions ?? []
    for (const ix of ixs) {
      const programId = keys[ix.programIdIndex]
      if (!programId?.equals(STRATEGY_PROGRAM_ID)) continue
      if (ix.data.length === 0) continue
      if (ix.data[0] !== REBALANCE_IX_TAG) continue
      // accountKeyIndexes is the per-ix slice of message account indices;
      // index 2 corresponds to the first remaining_account = protocol program.
      const acctIdxs = ix.accountKeyIndexes ?? []
      if (acctIdxs.length <= REBALANCE_PROTOCOL_ACCOUNT_INDEX) continue
      const protoIdx = acctIdxs[REBALANCE_PROTOCOL_ACCOUNT_INDEX]
      const protoKey = keys[protoIdx]
      if (!protoKey) continue
      const id = protoKey.toBase58()
      tally.set(id, (tally.get(id) ?? 0) + 1)
    }
  }

  const coverage: ProtocolCoverageEntry[] = Array.from(tally.entries())
    .map(([protocolId, legs]) => ({ protocolId, legs }))
    .sort((a, b) => b.legs - a.legs)

  PROTOCOL_COVERAGE_CACHE.set(cacheKey, { fetchedAt: Date.now(), coverage })
  return coverage
}

// ── NAV history derivation ────────────────────────────────────────────────────
// The NavOracle PDA stores only the latest snapshot — there's no on-chain ring
// buffer. To build a sparkline series we walk recent signatures touching the
// PDA, fetch the txs, find the update_nav ixs (program = strategy-token, first
// data byte = 0x03), and reconstruct the post-state by re-reading the PDA at
// the slot the tx landed in. We don't have account history per slot on a
// vanilla devnet RPC, so we use a cheaper heuristic: the writer in update_nav
// stamps `nav_per_share` after computing it from the wallet/position accounts,
// and the only reliable way to recover it without a custom indexer is via the
// post-tx account state — which getTransaction does NOT include for arbitrary
// accounts. So we approximate: each signature is one history "tick" at that
// slot, and we pull the *current* navPerShare snapshot down for the latest
// point. For older points we tag them with the slot/blockTime only and leave
// navPerShare = 0 — the strategy detail page agent can decide whether to plot
// slots vs values, and it can degrade gracefully when older NAVs aren't known.
//
// In practice this means we have ground-truth NAV for the most recent
// update_nav, and a timestamped scaffold for prior ones — enough to render a
// time axis and seed an APY computation when paired with the strategy's
// initial nav_per_share = 1 * NAV_SCALE invariant at strategy creation.

interface NavHistoryCacheEntry {
  fetchedAt: number
  history: NavHistoryPoint[]
  lastSnapshotSlot: number
}
const NAV_HISTORY_CACHE = new Map<string, NavHistoryCacheEntry>()
const NAV_HISTORY_TTL_MS = 30_000
// Pinned to keep RPC load bounded — getSignaturesForAddress defaults to 1000
// which is brutal on public devnet and gets us throttled fast.
const NAV_HISTORY_SIG_LIMIT = 50

async function fetchNavHistory(
  conn: Connection,
  strategyPda: PublicKey,
  latestNavOracle: NavOracleData | null,
): Promise<{ history: NavHistoryPoint[]; lastSnapshotSlot: number }> {
  const navPda = navOraclePda(strategyPda)
  const cacheKey = navPda.toBase58()
  const cached = NAV_HISTORY_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < NAV_HISTORY_TTL_MS) {
    return { history: cached.history, lastSnapshotSlot: cached.lastSnapshotSlot }
  }

  const sigs = await conn.getSignaturesForAddress(navPda, { limit: NAV_HISTORY_SIG_LIMIT })
  // Fresh strategy or NAV PDA never written → empty series; UI shows nothing.
  if (sigs.length <= 1 && !latestNavOracle) {
    const empty = { history: [], lastSnapshotSlot: 0 }
    NAV_HISTORY_CACHE.set(cacheKey, { ...empty, fetchedAt: Date.now() })
    return empty
  }

  // Walk txs oldest → newest. Each update_nav tx becomes one history point.
  // We can only authoritatively recover navPerShare for the *latest* tx (from
  // the live NavOracle account); for older txs we record slot/blockTime so the
  // detail page can still plot a time axis.
  const ordered = [...sigs].reverse() // RPC returns newest-first
  const points: NavHistoryPoint[] = []

  for (const s of ordered) {
    if (s.err) continue
    let isUpdateNav = false
    try {
      const tx = await conn.getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      })
      if (!tx) continue
      const keys = tx.transaction.message
        .getAccountKeys({
          accountKeysFromLookups: tx.meta?.loadedAddresses ?? undefined,
        })
        .keySegments()
        .flat()
      const ixs = tx.transaction.message.compiledInstructions ?? []
      for (const ix of ixs) {
        const programId = keys[ix.programIdIndex]
        if (!programId?.equals(STRATEGY_PROGRAM_ID)) continue
        if (ix.data.length === 0) continue
        if (ix.data[0] === UPDATE_NAV_IX_TAG) {
          isUpdateNav = true
          break
        }
      }
    } catch {
      // RPC hiccup — skip this signature, keep walking.
      continue
    }
    if (!isUpdateNav) continue
    points.push({
      slot: s.slot,
      navPerShare: 0,                        // backfilled below for the newest point
      timestamp: s.blockTime ?? 0,
    })
  }

  // Stamp the newest point with the live NAV (only authoritative value we have).
  if (points.length > 0 && latestNavOracle) {
    points[points.length - 1] = {
      ...points[points.length - 1],
      navPerShare: Number(latestNavOracle.navPerShare),
    }
  }

  const lastSnapshotSlot = latestNavOracle
    ? Number(latestNavOracle.lastSnapshotSlot)
    : points[points.length - 1]?.slot ?? 0

  const entry: NavHistoryCacheEntry = {
    fetchedAt: Date.now(),
    history: points,
    lastSnapshotSlot,
  }
  NAV_HISTORY_CACHE.set(cacheKey, entry)
  return { history: points, lastSnapshotSlot }
}

function computeApy(history: NavHistoryPoint[]): number {
  // Need >=2 samples with non-zero NAVs at both ends to compute realised APY.
  // Falls back to 0 (which the existing UI renders as "—") when we don't have
  // enough data — see strategy detail page tvl/apy formatting.
  if (history.length < 2) return 0
  const earliest = history.find((p) => p.navPerShare > 0)
  const latest = [...history].reverse().find((p) => p.navPerShare > 0)
  if (!earliest || !latest || earliest === latest) return 0
  const slotDiff = latest.slot - earliest.slot
  if (slotDiff <= 0) return 0
  const ratio = latest.navPerShare / earliest.navPerShare
  if (!isFinite(ratio) || ratio <= 0) return 0
  const years = SLOTS_PER_YEAR / slotDiff
  const apy = Math.pow(ratio, years) - 1
  return isFinite(apy) ? apy : 0
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
  const base = deserializeStrategy(address, Buffer.from(info.data))
  if (!base) return null

  // Pull live NAV + history. Each branch swallows its own errors so a flaky
  // devnet RPC degrades to "no NAV data" rather than failing the whole route.
  const navOracle = await fetchNavOracle(pubkey, conn).catch(() => null)
  const { history, lastSnapshotSlot } = await fetchNavHistory(conn, pubkey, navOracle).catch(
    () => ({ history: [] as NavHistoryPoint[], lastSnapshotSlot: 0 }),
  )

  const apy = computeApy(history)
  // We only have ground-truth NAV for the latest sample (see fetchNavHistory),
  // so leave the timeframe-bucket performance fields at 0 for now — the
  // existing detail page renders them as "—". A future iteration can compute
  // these from a richer indexer-backed history.
  return {
    ...base,
    apy,
    navHistory: history.length > 0 ? history : undefined,
    lastSnapshotSlot: lastSnapshotSlot > 0 ? lastSnapshotSlot : undefined,
  }
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

export async function fetchMarket(address: string): Promise<MarketDisplay | null> {
  const conn = new Connection(RPC, 'confirmed')
  let pubkey: PublicKey
  try {
    pubkey = new PublicKey(address)
  } catch {
    return null
  }
  const info = await conn.getAccountInfo(pubkey)
  if (!info) return null
  const m = deserializeMarket(address, Buffer.from(info.data))
  if (!m) return null
  // Best-effort strategy name lookup; degrades to a truncated pubkey on
  // failure so the page still renders.
  try {
    const strat = await fetchStrategy(m.strategy)
    m.strategyName = strat?.name ?? m.strategy.slice(0, 8) + '...'
  } catch {
    m.strategyName = m.strategy.slice(0, 8) + '...'
  }
  return m
}

export async function fetchCurrentSlot(): Promise<number | null> {
  try {
    const conn = new Connection(RPC, 'confirmed')
    return await conn.getSlot('confirmed')
  } catch {
    return null
  }
}

// ── Recent activity (signature scan + ix decode) ──────────────────────────────
// Walks the last N signatures touching a strategy account and decodes the
// strategy-token instructions inside each tx into typed activity entries.
// Strategy-token dispatch bytes (per memory/strategy_token_dispatch.md):
//   0=create_strategy, 1=buy_shares, 2=redeem_shares, 3=update_nav,
//   4=rebalance, 5=snapshot_positions, 6=init_position, 7=perp_place_order
//
// Performance notes:
// - 30 sigs × getTransaction = 31 RPC calls. Public devnet WILL throttle, so
//   we Promise.allSettled the per-sig fetches and drop any that 429.
// - Cached per-strategy with a 60s TTL — the page re-renders (revalidate=30)
//   are cheap because two consecutive renders inside the TTL window share the
//   same fetched batch.

export type ActivityKind =
  | 'create'
  | 'deposit'
  | 'redeem'
  | 'update_nav'
  | 'rebalance'
  | 'snapshot'
  | 'init_position'
  | 'perp'

export interface ActivityEntry {
  signature: string
  blockTime: number | null
  slot: number
  kind: ActivityKind
  label: string
  amount?: string
  protocol?: string
}

const CREATE_IX_TAG = 0x00
const BUY_SHARES_IX_TAG = 0x01
const REDEEM_SHARES_IX_TAG = 0x02
// UPDATE_NAV_IX_TAG and REBALANCE_IX_TAG already declared above.
const SNAPSHOT_IX_TAG = 0x05
const INIT_POSITION_IX_TAG = 0x06
const PERP_PLACE_ORDER_IX_TAG = 0x07

interface ActivityCacheEntry {
  fetchedAt: number
  entries: ActivityEntry[]
}
const ACTIVITY_CACHE = new Map<string, ActivityCacheEntry>()
const ACTIVITY_TTL_MS = 60_000
const ACTIVITY_SIG_LIMIT = 30
const ACTIVITY_RENDER_LIMIT = 10

function formatUsdc(raw: bigint): string {
  // 6 decimals across both USDC base-units and our share mints.
  const whole = raw / 1_000_000n
  const frac = raw % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '')
  return fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString()
}

function readU64LE(data: Uint8Array, offset: number): bigint | undefined {
  if (offset + 8 > data.length) return undefined
  // Uint8Array → Buffer wrapper for readBigUInt64LE; cheap, no copy.
  return Buffer.from(data.buffer, data.byteOffset + offset, 8).readBigUInt64LE(0)
}

function decodeRebalanceSubAction(byte: number): string {
  switch (byte) {
    case 0:
      return 'deposit'
    case 1:
      return 'withdraw'
    case 2:
      return 'swap'
    default:
      return `op ${byte}`
  }
}

export async function fetchRecentActivity(
  strategy: PublicKey,
  limit: number = ACTIVITY_RENDER_LIMIT,
): Promise<ActivityEntry[]> {
  const cacheKey = strategy.toBase58()
  const cached = ACTIVITY_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < ACTIVITY_TTL_MS) {
    return cached.entries.slice(0, limit)
  }

  const conn = new Connection(RPC, 'confirmed')
  let sigs: Awaited<ReturnType<Connection['getSignaturesForAddress']>>
  try {
    sigs = await conn.getSignaturesForAddress(strategy, {
      limit: ACTIVITY_SIG_LIMIT,
    })
  } catch {
    ACTIVITY_CACHE.set(cacheKey, { fetchedAt: Date.now(), entries: [] })
    return []
  }

  // Parallel fetch + ignore individual failures (devnet 429 tolerant).
  const txs = await Promise.allSettled(
    sigs.map((s) =>
      conn.getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      }),
    ),
  )

  const entries: ActivityEntry[] = []

  for (let i = 0; i < sigs.length; i++) {
    const sigInfo = sigs[i]
    if (sigInfo.err) continue
    const result = txs[i]
    if (result.status !== 'fulfilled' || !result.value) continue
    const tx = result.value

    let keys: PublicKey[]
    try {
      keys = tx.transaction.message
        .getAccountKeys({
          accountKeysFromLookups: tx.meta?.loadedAddresses ?? undefined,
        })
        .keySegments()
        .flat()
    } catch {
      continue
    }

    const ixs = tx.transaction.message.compiledInstructions ?? []
    for (const ix of ixs) {
      const programId = keys[ix.programIdIndex]
      if (!programId?.equals(STRATEGY_PROGRAM_ID)) continue
      if (ix.data.length === 0) continue

      const tag = ix.data[0]
      const acctIdxs = ix.accountKeyIndexes ?? []
      const base = {
        signature: sigInfo.signature,
        blockTime: sigInfo.blockTime ?? null,
        slot: sigInfo.slot,
      }

      switch (tag) {
        case CREATE_IX_TAG: {
          // create_strategy: account[0] = creator/authority signer.
          const creator = acctIdxs[0] !== undefined ? keys[acctIdxs[0]] : undefined
          const creatorB58 = creator?.toBase58()
          entries.push({
            ...base,
            kind: 'create',
            label: creatorB58
              ? `Strategy created by ${creatorB58.slice(0, 4)}…${creatorB58.slice(-4)}`
              : 'Strategy created',
          })
          break
        }
        case BUY_SHARES_IX_TAG: {
          const amount = readU64LE(ix.data, 1)
          entries.push({
            ...base,
            kind: 'deposit',
            label: 'Deposit',
            amount: amount !== undefined ? `${formatUsdc(amount)} USDC` : undefined,
          })
          break
        }
        case REDEEM_SHARES_IX_TAG: {
          const amount = readU64LE(ix.data, 1)
          entries.push({
            ...base,
            kind: 'redeem',
            label: 'Redeem',
            amount:
              amount !== undefined ? `${formatUsdc(amount)} shares` : undefined,
          })
          break
        }
        case UPDATE_NAV_IX_TAG: {
          entries.push({ ...base, kind: 'update_nav', label: 'NAV updated' })
          break
        }
        case REBALANCE_IX_TAG: {
          // Layout per CLAUDE / IDL:
          //   data[0]   = dispatch byte (0x04)
          //   data[1]   = beethoven protocol category byte (caller-supplied)
          //   data[2]   = sub-action (0=deposit, 1=withdraw, 2=swap)
          //   data[3..11] = u64 amount
          const subByte = ix.data.length > 2 ? ix.data[2] : 0
          const subAction = decodeRebalanceSubAction(subByte)
          const amount = readU64LE(ix.data, 3)
          // First remaining account → protocol program ID.
          const protoIdx = acctIdxs[REBALANCE_PROTOCOL_ACCOUNT_INDEX]
          const protoKey = protoIdx !== undefined ? keys[protoIdx] : undefined
          const protocolId = protoKey?.toBase58()
          entries.push({
            ...base,
            kind: 'rebalance',
            label: `Rebalance · ${subAction}`,
            amount: amount !== undefined ? formatUsdc(amount) : undefined,
            protocol: protocolId,
          })
          break
        }
        case SNAPSHOT_IX_TAG: {
          entries.push({ ...base, kind: 'snapshot', label: 'Snapshot taken' })
          break
        }
        case INIT_POSITION_IX_TAG: {
          entries.push({
            ...base,
            kind: 'init_position',
            label: 'Position initialized',
          })
          break
        }
        case PERP_PLACE_ORDER_IX_TAG: {
          entries.push({ ...base, kind: 'perp', label: 'Perp order' })
          break
        }
        default:
          // Unknown dispatch byte — silently skip.
          break
      }
    }
  }

  // Newest first; getSignaturesForAddress already returns that order, but the
  // per-tx ix walk preserves whatever order the RPC gave us.
  ACTIVITY_CACHE.set(cacheKey, { fetchedAt: Date.now(), entries })
  return entries.slice(0, limit)
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
