import { Suspense } from 'react'
import ReactDOM from 'react-dom'
import Link from 'next/link'
import { ArrowUpRight, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'
import { getDevnetConnection } from '@/lib/rpc'
import { fetchAllMarkets, type MarketView } from '@/lib/markets'
import { fetchAgentDirectory, fetchRegisteredAgents, fetchRegisteredVaultSet } from '@/lib/registry'
import { fetchAgentPnl, microsToUsd } from '@/lib/pnl'
import { AgentCardCompact, DeMarketCard, DeSparkline, hashSeed } from '@/components/de'
import { TrendingFilters, type TrendingFilterId } from '@/components/de/TrendingFilters'
import { BettorFaucetCTA } from '@/components/BettorFaucetCTA'

// 30-second SWR. Every visitor in the same window gets cached HTML; the
// next request after 30s triggers a background regenerate. `force-dynamic`
// was the previous setting and meant we re-rendered every visit, blocking
// on five backend / RPC calls plus an N+1 PnL fan-out. See DESIGN.md /
// CLAUDE.md § Performance Reference for the rationale.
export const revalidate = 30

// Cache options shared by every backend fetch on this page so they all
// land in the same 30s SWR window and share invalidation tags. The page
// also wraps the data-heavy half in <Suspense> so the editorial header
// band streams to the browser before the rest of the page is ready.
const REGISTRY_FETCH_OPTS: RequestInit = {
  next: { revalidate: 30, tags: ['registry'] },
} as RequestInit

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000'

/**
 * Discover (/) , precision-editorial home.
 *
 * Type system: Instrument Serif for display headlines (36px+) and a
 * single italic accent per section. Figtree handles every structural
 * surface (labels, numbers, CTAs, body). Numbers always sit in
 * Figtree 700 with tabular-nums so figures feel anchored. The serif
 * italic is a colour, not a default.
 *
 * Layout in five bands:
 *   1. Editorial header , eyebrow + serif headline + four-up stat strip
 *   2. Featured strategy , magazine-style hero + slim sidebar
 *   3. The index , clean leaderboard table with hairline rules
 *   4. Markets , filter pills + grid of DeMarketCards
 *   5. Strategist invite , full-width band with serif italic question
 *
 * See packages/web/DESIGN.md for the full philosophy.
 */
export default async function Home(props: {
  searchParams?: Promise<{ filter?: string | string[] }>
}) {
  const searchParams = await props.searchParams
  const rawFilter = Array.isArray(searchParams?.filter)
    ? searchParams?.filter[0]
    : searchParams?.filter
  const filter: TrendingFilterId = ['rate', 'benchmark', 'agent_nav'].includes(rawFilter ?? '')
    ? (rawFilter as TrendingFilterId)
    : 'all'

  // Preload the two backend endpoints the data sections need before React
  // even starts rendering them. ReactDOM.preload emits a <link rel=preload
  // as=fetch crossorigin> in the document head; the browser opens the
  // requests in parallel with the HTML stream, so by the time the
  // Suspense boundaries run their fetches the responses are already
  // landing. Same URLs / `crossOrigin` as the actual fetch calls or the
  // preload won't match and the browser will fetch twice.
  ReactDOM.preload(`${BACKEND_URL}/api/agents?status=active`, {
    as: 'fetch',
    crossOrigin: 'anonymous',
  })
  ReactDOM.preload(`${BACKEND_URL}/api/stats/platform`, {
    as: 'fetch',
    crossOrigin: 'anonymous',
  })

  // Only the platform stats are fetched at the top level so the editorial
  // header band can stream to the browser immediately. Everything below
  // (featured strategy, leaderboard, markets) lives inside Suspense
  // boundaries that fetch their own data , the user sees the header in
  // the first chunk and each section streams in as its fan-out resolves.
  const platformStats = await fetchPlatformStats()

  return (
    <main className="discover-page">
      {/* Subtle ambient. Off-centre so the page does not feel templated. */}
      <div aria-hidden="true" className="discover-ambient" />

      <div className="discover-container">
        {/* ────────────────────────────────────────────────────────────────
            1. App header — tight section label + stats strip. The earlier
            magazine-style headline + lede was marketing copy that a
            returning user does not need; the app's home is meant to read
            like a Bloomberg dashboard, not a landing page.
            ──────────────────────────────────────────────────────────── */}
        <header className="discover-header" data-tour="header">
          <div className="discover-eyebrow">
            <span>The Bundie Index</span>
            <span className="discover-eyebrow-sep">·</span>
            <span>Devnet</span>
          </div>
          <PlatformStatsStrip
            agentsActive={platformStats.agentsActive}
            totalTvlLamports={platformStats.totalTvlLamports}
            marketsOpen={platformStats.marketsOpen}
            marketsResolved={platformStats.marketsResolved}
            totalNavGrowth7dBps={platformStats.totalNavGrowth7dBps}
          />
        </header>

        {/* Faucet sits directly below the editorial header so a wallet
            arriving with $0 bUSD sees the claim before scrolling past the
            leaderboard. Renders nothing until a wallet is connected. */}
        <div className="discover-faucet-top">
          <BettorFaucetCTA />
        </div>

        {/* ────────────────────────────────────────────────────────────────
            2-3. PnL-heavy sections (featured + leaderboard).
            These wait on the agents-PnL fan-out (one /api/agents/<sns>/pnl
            request per agent), which is the slowest data on the page.
            ──────────────────────────────────────────────────────────── */}
        <Suspense fallback={<DiscoverPnlSkeleton />}>
          <DiscoverPnlSections />
        </Suspense>

        {/* ────────────────────────────────────────────────────────────────
            4. Markets grid. Independent boundary so it can stream as soon
            as the cached registry + on-chain market scan resolve, without
            waiting on the PnL fan-out above. In practice this paints the
            grid first on cold loads.
            ──────────────────────────────────────────────────────────── */}
        <Suspense fallback={<DiscoverMarketsSkeleton />}>
          <DiscoverMarketsSection filter={filter} />
        </Suspense>

        {/* ────────────────────────────────────────────────────────────────
            5. Footer band — strategist invite. The bettor faucet moved to
            sit under the editorial header (above the fold) so $0-balance
            wallets aren't asked to scroll to find a way to bet.
            ──────────────────────────────────────────────────────────── */}
        <ListYourAgentBand />
      </div>

      {/* Layout rules (responsive) ship inline so this page bundles its
          own grid logic. Discover-specific class names are namespaced so
          they cannot leak into other routes. */}
      <style>{`
        .discover-page {
          background: var(--de-bg);
          min-height: 100vh;
          padding-bottom: 96px;
          color: var(--de-ink);
          position: relative;
          overflow-x: hidden;
        }
        .discover-ambient {
          position: absolute;
          top: 0;
          left: -10%;
          width: 70%;
          height: 520px;
          background:
            radial-gradient(50% 35% at 30% 0%, rgba(168,153,245,0.10), transparent 70%);
          pointer-events: none;
          z-index: 0;
        }
        .discover-container {
          position: relative;
          z-index: 1;
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 24px;
        }

        /* ── Section 1 ─────────────────────────────────────────────────── */
        .discover-header {
          padding-top: 32px;
        }
        .discover-eyebrow {
          font-family: var(--font-sans);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--de-ink-3);
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .discover-eyebrow-sep {
          color: var(--de-ink-5);
          font-weight: 400;
        }
        /* Tighter eyebrow → stats gap. The original 40px was set when a
           big headline + lede sat between them. */
        .discover-header .stats-strip {
          margin-top: 18px;
        }

        /* ── Stats strip ───────────────────────────────────────────────── */
        .stats-strip {
          margin-top: 40px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          border-top: 1px solid var(--de-line-2);
          border-bottom: 1px solid var(--de-line-2);
        }
        @media (min-width: 768px) {
          .stats-strip {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
        .stats-strip-item {
          padding: 22px 24px;
          border-right: 1px solid var(--de-line);
          border-bottom: 1px solid var(--de-line);
          min-width: 0;
        }
        @media (min-width: 768px) {
          .stats-strip-item {
            border-bottom: none;
          }
        }
        .stats-strip-item:nth-child(2n),
        .stats-strip-item:last-child {
          border-right: none;
        }
        @media (min-width: 768px) {
          .stats-strip-item:nth-child(2n) {
            border-right: 1px solid var(--de-line);
          }
          .stats-strip-item:last-child {
            border-right: none;
          }
        }
        .stats-strip-label {
          font-family: var(--font-sans);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--de-ink-4);
        }
        .stats-strip-value {
          margin-top: 12px;
          display: flex;
          align-items: baseline;
          gap: 8px;
          min-width: 0;
        }
        .stats-strip-num {
          font-family: var(--font-sans);
          font-weight: 700;
          font-size: 30px;
          letter-spacing: -0.025em;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          font-feature-settings: 'tnum';
          color: var(--de-ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .stats-strip-num.pos { color: var(--de-mint); }
        .stats-strip-num.neg { color: var(--de-rose); }
        .stats-strip-sub {
          font-family: var(--font-sans);
          font-size: 11px;
          font-weight: 700;
          color: var(--de-ink-4);
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        /* ── Section 2: featured ──────────────────────────────────────── */
        .discover-featured {
          margin-top: 56px;
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 1024px) {
          .discover-featured {
            grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr);
            gap: 24px;
          }
        }
        .discover-aside {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .featured-hero {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 32px;
          padding: 36px;
          background: var(--de-bg-raised);
          border: 1px solid var(--de-line-2);
          border-radius: 14px;
          text-decoration: none;
          color: var(--de-ink);
          overflow: hidden;
          min-height: 480px;
          transition: border-color 240ms ease, transform 240ms ease;
        }
        .featured-hero:hover {
          border-color: rgba(168,153,245,0.42);
          transform: translateY(-1px);
        }
        .featured-hero-bg {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(80% 40% at 0% 0%, rgba(168,153,245,0.10), transparent 60%),
            radial-gradient(40% 40% at 100% 100%, rgba(168,230,207,0.05), transparent 60%);
          pointer-events: none;
        }
        .featured-hero-status {
          position: relative;
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .featured-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-family: var(--font-sans);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .featured-pill-live {
          background: var(--de-mint-tint);
          color: var(--de-mint);
        }
        .featured-pill-net {
          background: rgba(244,239,224,0.06);
          color: var(--de-ink-3);
          border: 1px solid var(--de-line);
        }
        .featured-live-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: var(--de-mint);
          box-shadow: 0 0 6px rgba(168,230,207,0.6);
        }
        .featured-tickmark {
          margin-left: auto;
          font-family: var(--font-sans);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--de-ink-4);
          font-variant-numeric: tabular-nums;
        }

        .featured-headline {
          position: relative;
          margin: 0;
          font-family: var(--font-display);
          font-weight: 400;
          font-size: clamp(40px, 5vw, 56px);
          font-style: italic;
          letter-spacing: -0.02em;
          line-height: 1;
          color: var(--de-ink);
        }
        .featured-handle {
          position: relative;
          margin-top: 8px;
          font-family: var(--font-sans);
          font-weight: 700;
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--de-lavender);
        }

        .featured-chart {
          position: relative;
          flex: 1;
          min-height: 180px;
          display: flex;
          align-items: center;
        }

        .featured-stats {
          position: relative;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
          padding-top: 22px;
          border-top: 1px solid var(--de-line);
        }
        @media (min-width: 640px) {
          .featured-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }
        .featured-stat-label {
          font-family: var(--font-sans);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--de-ink-4);
        }
        .featured-stat-value {
          margin-top: 8px;
          font-family: var(--font-sans);
          font-weight: 700;
          font-size: 24px;
          letter-spacing: -0.02em;
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
          color: var(--de-ink);
        }
        .featured-stat-value.pos { color: var(--de-mint); }
        .featured-stat-value.neg { color: var(--de-rose); }

        .featured-cta {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 18px;
          border-radius: 8px;
          background: var(--de-lavender-tint);
          border: 1px solid rgba(168,153,245,0.42);
          color: var(--de-lavender);
          font-family: var(--font-sans);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.02em;
          align-self: flex-start;
          transition: background 160ms ease, border-color 160ms ease;
        }
        .featured-cta:hover {
          background: rgba(168,153,245,0.20);
          border-color: rgba(168,153,245,0.60);
        }

        /* ── Featured empty ───────────────────────────────────────────── */
        .featured-empty {
          padding: 36px;
          background: var(--de-bg-raised);
          border: 1px solid var(--de-line-2);
          border-radius: 14px;
          min-height: 360px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 14px;
        }
        .featured-empty-headline {
          font-family: var(--font-display);
          font-weight: 400;
          font-style: italic;
          font-size: 28px;
          color: var(--de-ink-2);
          letter-spacing: -0.01em;
          max-width: 480px;
          line-height: 1.2;
        }
        .featured-empty-body {
          font-family: var(--font-sans);
          font-size: 13px;
          color: var(--de-ink-3);
          max-width: 420px;
          line-height: 1.5;
        }

        /* ── Promo card ───────────────────────────────────────────────── */
        .promo-card {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          padding: 24px;
          background: var(--de-bg-raised);
          border: 1px solid var(--de-line);
          border-radius: 12px;
          position: relative;
          overflow: hidden;
        }
        .promo-card-bg {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(60% 60% at 100% 0%, rgba(168,153,245,0.08), transparent 70%);
          pointer-events: none;
        }
        .promo-eyebrow {
          position: relative;
          font-family: var(--font-sans);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--de-ink-4);
          margin-bottom: 12px;
        }
        .promo-headline {
          position: relative;
          font-family: var(--font-display);
          font-style: italic;
          font-weight: 400;
          font-size: 22px;
          line-height: 1.25;
          letter-spacing: -0.01em;
          color: var(--de-ink);
          margin-bottom: 14px;
        }
        .promo-body {
          position: relative;
          font-family: var(--font-sans);
          font-size: 13px;
          color: var(--de-ink-2);
          line-height: 1.55;
        }

        /* ── Section header ───────────────────────────────────────────── */
        .discover-section {
          margin-top: 80px;
        }
        .section-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--de-line-2);
        }
        .section-head-eyebrow {
          font-family: var(--font-sans);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.20em;
          text-transform: uppercase;
          color: var(--de-ink-3);
          margin-bottom: 10px;
        }
        .section-head-title {
          font-family: var(--font-sans);
          font-weight: 700;
          font-size: 28px;
          letter-spacing: -0.025em;
          line-height: 1.05;
          color: var(--de-ink);
        }
        .section-head-italic {
          font-family: var(--font-display);
          font-style: italic;
          font-weight: 400;
          color: var(--de-ink-3);
          letter-spacing: -0.015em;
          font-size: 28px;
          margin-left: 6px;
        }
        .section-head-count {
          font-family: var(--font-sans);
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--de-ink-4);
          font-variant-numeric: tabular-nums;
        }

        /* ── Leaderboard ──────────────────────────────────────────────── */
        .leaderboard {
          margin-top: 8px;
        }
        .leaderboard-row {
          display: grid;
          grid-template-columns: 32px minmax(0, 1.6fr) minmax(0, 1fr) 140px 96px;
          align-items: center;
          gap: 20px;
          padding: 18px 4px;
          border-bottom: 1px solid var(--de-line);
          text-decoration: none;
          color: var(--de-ink);
          transition: background 160ms ease, padding 160ms ease;
        }
        .leaderboard-row:hover {
          background: rgba(244,239,224,0.025);
        }
        .leaderboard-rank {
          font-family: var(--font-sans);
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 0.14em;
          color: var(--de-ink-4);
          font-variant-numeric: tabular-nums;
        }
        .leaderboard-meta {
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 400;
          color: var(--de-ink-3);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }
        .leaderboard-meta-k {
          font-weight: 700;
          color: var(--de-ink-4);
          letter-spacing: 0.14em;
          text-transform: uppercase;
          margin-right: 6px;
          font-size: 10.5px;
        }
        .leaderboard-meta-v {
          color: var(--de-ink-2);
          font-weight: 700;
        }
        .leaderboard-spark {
          height: 32px;
          display: flex;
          align-items: center;
        }
        .leaderboard-return {
          text-align: right;
          font-family: var(--font-sans);
          font-weight: 700;
          font-size: 18px;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.015em;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          justify-content: flex-end;
        }
        .leaderboard-return.pos { color: var(--de-mint); }
        .leaderboard-return.neg { color: var(--de-rose); }
        .leaderboard-return.flat { color: var(--de-ink-3); }

        @media (max-width: 767px) {
          .leaderboard-row {
            grid-template-columns: minmax(0, 1.6fr) 88px;
          }
          .leaderboard-row > :nth-child(1),
          .leaderboard-row > :nth-child(3),
          .leaderboard-row > :nth-child(4) {
            display: none;
          }
        }

        /* ── Markets grid ─────────────────────────────────────────────── */
        .discover-market-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 768px) {
          .discover-market-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (min-width: 1280px) {
          .discover-market-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        .discover-empty {
          margin-top: 24px;
          padding: 56px 16px;
          text-align: center;
          color: var(--de-ink-3);
          font-family: var(--font-sans);
          font-size: 13px;
          background: var(--de-bg-raised);
          border: 1px dashed var(--de-line-2);
          border-radius: 12px;
        }

        /* ── Footer bands ─────────────────────────────────────────────── */
        .discover-faucet-row {
          margin-top: 80px;
        }
        .discover-faucet-row > div {
          margin: 0;
        }
        .invite-band {
          margin-top: 24px;
          padding: 36px 36px 38px;
          border: 1px solid var(--de-line-2);
          border-radius: 14px;
          background: var(--de-bg-raised);
          position: relative;
          overflow: hidden;
        }
        .invite-band-bg {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(60% 60% at 100% 0%, rgba(168,153,245,0.10), transparent 70%);
          pointer-events: none;
        }
        .invite-eyebrow {
          position: relative;
          font-family: var(--font-sans);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.20em;
          text-transform: uppercase;
          color: var(--de-ink-3);
          margin-bottom: 14px;
        }
        .invite-question {
          position: relative;
          font-family: var(--font-display);
          font-weight: 400;
          font-size: clamp(28px, 4vw, 40px);
          letter-spacing: -0.02em;
          line-height: 1.1;
          color: var(--de-ink);
          max-width: 720px;
          margin: 0 0 22px;
        }
        .invite-question em {
          font-style: italic;
          color: var(--de-lavender-2);
        }
        .invite-cta {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 14px 22px;
          border-radius: 8px;
          background: var(--de-lavender);
          color: var(--de-bg-raised);
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.01em;
          text-decoration: none;
          transition: background 160ms ease, transform 160ms ease;
        }
        .invite-cta:hover {
          background: var(--de-lavender-2);
          transform: translateY(-1px);
        }
      `}</style>
    </main>
  )
}

// ─── Suspense boundary 1: featured + leaderboard ───────────────────────────
//
// PnL-heavy. Waits on the per-agent `/api/agents/<sns>/pnl` fan-out, which
// is the slowest data on the page. Markets grid below is in its own
// boundary so it can paint first.
//
// Shared fetches (agents / vault-set / agent-dir / markets) are tagged or
// `unstable_cache`d so calling them again from the markets boundary just
// hits the same cache entry — no duplicate work.
async function DiscoverPnlSections() {
  const connection = getDevnetConnection()
  const [agents, agentDir, markets, allowedCreators] = await Promise.all([
    fetchRegisteredAgents(REGISTRY_FETCH_OPTS),
    fetchAgentDirectory(REGISTRY_FETCH_OPTS),
    fetchAllMarkets(connection, { allowedCreators: undefined }),
    fetchRegisteredVaultSet(REGISTRY_FETCH_OPTS),
  ])

  const liveMarkets = markets.filter((m) => allowedCreators.has(m.createdBy))

  const pnls = await Promise.all(agents.map((a) => fetchAgentPnl(a.sns, '30d')))

  type AgentRow = {
    sns: string
    displayName: string
    avatarSeed: number
    currentNavMicros: number | null
    return30dPct: number | null
    series: number[]
    marketCount: number
    snsVerified: boolean
  }
  const agentRows: AgentRow[] = agents
    .map((a, i) => {
      const pnl = pnls[i]
      const series = pnl.snapshots
        .map((s) => microsToUsd(s.navLamports))
        .filter((v): v is number => v != null)
      return {
        sns: a.sns,
        displayName: a.display_name || a.sns.split('.')[0] || 'strategy',
        avatarSeed: hashSeed(a.sns),
        currentNavMicros: pnl.stats.currentNavLamports
          ? Number(pnl.stats.currentNavLamports)
          : null,
        return30dPct: pnl.stats.return30dBps != null ? pnl.stats.return30dBps / 100 : null,
        series,
        marketCount: 0,
        snsVerified: a.sns_verified ?? false,
      }
    })
    .sort((a, b) => (b.return30dPct ?? -Infinity) - (a.return30dPct ?? -Infinity))

  for (const m of liveMarkets) {
    const aSns = agentDir[m.createdBy]?.sns
    const bSns = m.targetAgent ? agentDir[m.targetAgent]?.sns : undefined
    for (const sns of [aSns, bSns].filter((s): s is string => !!s)) {
      const row = agentRows.find((r) => r.sns === sns)
      if (row) row.marketCount += 1
    }
  }

  const featured =
    agentRows.find((r) => r.series.length >= 2 && (r.return30dPct ?? 0) > 0) ?? agentRows[0] ?? null

  const featuredMarket: MarketView | null = (() => {
    const open = liveMarkets.filter((m) => m.status === 'active')
    if (open.length === 0) return null
    if (featured) {
      const ofFeatured = open
        .filter((m) => agentDir[m.createdBy]?.sns === featured.sns)
        .sort((a, b) => b.totalVolume - a.totalVolume)
      if (ofFeatured.length > 0) return ofFeatured[0]
    }
    return [...open].sort((a, b) => b.totalVolume - a.totalVolume)[0]
  })()

  return (
    <>
      {/* 2. Featured strategy + sidebar ----------------------------- */}
      <section className="discover-featured" data-tour="featured">
        {featured ? <FeaturedAgentHero row={featured} /> : <FeaturedAgentEmpty />}

        <aside className="discover-aside">
          {featuredMarket ? (
            <DeMarketCard market={featuredMarket} dir={agentDir} size="compact" />
          ) : null}
          <EditorialPromoCard />
        </aside>
      </section>

      {/* 3. Leaderboard --------------------------------------------- */}
      <section className="discover-section">
        <SectionHeader
          eyebrow="The Index"
          title="Top strategies"
          italicAccent="by 30-day return"
          count={agentRows.length}
        />
        <Leaderboard rows={agentRows} />
      </section>
    </>
  )
}

// ─── Suspense boundary 2: markets grid ─────────────────────────────────────
//
// No PnL dependency — only needs the registry + cached on-chain market
// scan. Streams as soon as those resolve, ahead of the leaderboard above.
async function DiscoverMarketsSection({ filter }: { filter: TrendingFilterId }) {
  const connection = getDevnetConnection()
  const [allowedCreators, agentDir, markets] = await Promise.all([
    fetchRegisteredVaultSet(REGISTRY_FETCH_OPTS),
    fetchAgentDirectory(REGISTRY_FETCH_OPTS),
    fetchAllMarkets(connection, { allowedCreators: undefined }),
  ])

  const liveMarkets = markets.filter((m) => allowedCreators.has(m.createdBy))
  const trending = filterTrending(liveMarkets, filter)

  // liveAgentCount here is computed off `liveMarkets` only — no PnL
  // needed, so the headline copy can land with the grid.
  const liveAgents = new Set<string>()
  for (const m of liveMarkets) {
    const aSns = agentDir[m.createdBy]?.sns
    if (aSns) liveAgents.add(aSns)
    const bSns = m.targetAgent ? agentDir[m.targetAgent]?.sns : undefined
    if (bSns) liveAgents.add(bSns)
  }
  const liveAgentCount = liveAgents.size

  return (
    <section className="discover-section" data-tour="markets">
      <SectionHeader
        eyebrow="Markets"
        title={`Open across ${liveAgentCount} ${liveAgentCount === 1 ? 'agent' : 'agents'}`}
        italicAccent={null}
      />
      <div style={{ marginTop: 20 }}>
        <TrendingFilters active={filter} />
      </div>
      {trending.length === 0 ? (
        <div className="discover-empty">No open markets in this category yet.</div>
      ) : (
        <div className="discover-market-grid" style={{ marginTop: 24 }}>
          {trending.map((m) => (
            <DeMarketCard key={m.address} market={m} dir={agentDir} />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Streaming fallbacks ───────────────────────────────────────────────────
//
// Reserve the same vertical footprint as the live sections so there's no
// CLS when React swaps each skeleton out. Pure CSS, no JS, both ship in
// the first HTML chunk.
function DiscoverPnlSkeleton() {
  return (
    <>
      <section className="discover-featured" aria-hidden="true">
        <div className="discover-skeleton discover-skeleton-hero" />
        <aside className="discover-aside">
          <div className="discover-skeleton discover-skeleton-card" />
          <div className="discover-skeleton discover-skeleton-card" />
        </aside>
      </section>

      <section className="discover-section" aria-hidden="true">
        <div className="discover-skeleton discover-skeleton-headline" />
        <div className="discover-skeleton discover-skeleton-row" />
        <div className="discover-skeleton discover-skeleton-row" />
        <div className="discover-skeleton discover-skeleton-row" />
        <div className="discover-skeleton discover-skeleton-row" />
        <div className="discover-skeleton discover-skeleton-row" />
      </section>

      <DiscoverSkeletonStyles />
    </>
  )
}

function DiscoverMarketsSkeleton() {
  return (
    <section className="discover-section" aria-hidden="true">
      <div className="discover-skeleton discover-skeleton-headline" />
      <div className="discover-market-grid" style={{ marginTop: 24 }}>
        <div className="discover-skeleton discover-skeleton-market" />
        <div className="discover-skeleton discover-skeleton-market" />
        <div className="discover-skeleton discover-skeleton-market" />
      </div>
      <DiscoverSkeletonStyles />
    </section>
  )
}

// Skeleton CSS lives in one place. Both fallbacks render it, but
// duplicate `<style>` tags with identical text are deduped by the browser
// (and React 19 hoists `<style>` tags) so there's no real cost.
function DiscoverSkeletonStyles() {
  return (
    <style>{`
      .discover-skeleton {
        background: linear-gradient(
          90deg,
          var(--de-bg-raised) 0%,
          rgba(244,239,224,0.04) 50%,
          var(--de-bg-raised) 100%
        );
        background-size: 200% 100%;
        animation: discover-skeleton-pulse 1.6s ease-in-out infinite;
        border: 1px solid var(--de-line);
        border-radius: 12px;
      }
      .discover-skeleton-hero { min-height: 480px; }
      .discover-skeleton-card { height: 168px; }
      .discover-skeleton-headline {
        height: 56px;
        margin-bottom: 24px;
        border: none;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(244,239,224,0.04) 50%,
          transparent 100%
        );
        background-size: 200% 100%;
        animation: discover-skeleton-pulse 1.6s ease-in-out infinite;
      }
      .discover-skeleton-row {
        height: 64px;
        margin-bottom: 1px;
        border-radius: 0;
        border: none;
        border-bottom: 1px solid var(--de-line);
      }
      .discover-skeleton-market { height: 196px; }
      @keyframes discover-skeleton-pulse {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .discover-skeleton, .discover-skeleton-headline {
          animation: none;
        }
      }
    `}</style>
  )
}

// ─── Sections ────────────────────────────────────────────────────────────────

function SectionHeader({
  eyebrow,
  title,
  italicAccent,
  count,
}: {
  eyebrow: string
  title: string
  italicAccent: string | null
  count?: number
}) {
  return (
    <div className="section-head">
      <div>
        <div className="section-head-eyebrow">{eyebrow}</div>
        <div className="section-head-title">
          {title}
          {italicAccent && <span className="section-head-italic"> {italicAccent}</span>}
        </div>
      </div>
      {typeof count === 'number' && (
        <div className="section-head-count">{String(count).padStart(2, '0')} live</div>
      )}
    </div>
  )
}

function PlatformStatsStrip({
  agentsActive,
  totalTvlLamports,
  marketsOpen,
  marketsResolved,
  totalNavGrowth7dBps,
}: {
  agentsActive: number
  totalTvlLamports: string
  marketsOpen: number
  marketsResolved: number
  totalNavGrowth7dBps: number | null
}) {
  const growthLabel = totalNavGrowth7dBps == null ? '··' : fmtSignedPct(totalNavGrowth7dBps / 100)
  const growthTone: 'pos' | 'neg' | 'neutral' =
    totalNavGrowth7dBps == null ? 'neutral' : totalNavGrowth7dBps >= 0 ? 'pos' : 'neg'

  return (
    <div className="stats-strip">
      <StatCell label="Live agents" value={String(agentsActive)} />
      <StatCell label="Total TVL" value={fmtTvlUsd(totalTvlLamports)} sub="bUSD" />
      <StatCell
        label="Open markets"
        value={String(marketsOpen)}
        sub={`${marketsResolved} resolved`}
      />
      <StatCell label="7-day NAV" value={growthLabel} tone={growthTone} />
    </div>
  )
}

function StatCell({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'pos' | 'neg' | 'neutral'
}) {
  return (
    <div className="stats-strip-item">
      <div className="stats-strip-label">{label}</div>
      <div className="stats-strip-value">
        <span className={`stats-strip-num ${tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : ''}`}>
          {value}
        </span>
        {sub && <span className="stats-strip-sub">{sub}</span>}
      </div>
    </div>
  )
}

function FeaturedAgentHero({
  row,
}: {
  row: {
    sns: string
    displayName: string
    avatarSeed: number
    currentNavMicros: number | null
    return30dPct: number | null
    series: number[]
    marketCount: number
    snsVerified: boolean
  }
}) {
  const tvl = row.currentNavMicros ? row.currentNavMicros / 1_000_000 : null
  const tone: 'pos' | 'neg' | 'neutral' =
    row.return30dPct == null ? 'neutral' : row.return30dPct >= 0 ? 'pos' : 'neg'

  return (
    <Link href={`/agent/${encodeURIComponent(row.sns)}`} className="featured-hero">
      <div className="featured-hero-bg" aria-hidden="true" />

      <div className="featured-hero-status">
        <span className="featured-pill featured-pill-live">
          <span className="featured-live-dot" />
          Live
        </span>
        <span className="featured-pill featured-pill-net">Devnet</span>
        <span className="featured-tickmark">
          NAV {String(row.series.length).padStart(3, '0')} ticks
        </span>
      </div>

      <div>
        <h2 className="featured-headline">{row.displayName}</h2>
        <div className="featured-handle">@{row.sns}</div>
      </div>

      <div className="featured-chart">
        <DeSparkline
          series={row.series}
          variant="large"
          width={undefined}
          height={180}
          showFill
          tone={tone}
          style={{ width: '100%', height: 180 }}
        />
      </div>

      <div className="featured-stats">
        <FeaturedStat label="30D Return" value={fmtSignedPct(row.return30dPct)} tone={tone} />
        <FeaturedStat label="Live TVL" value={tvl != null ? fmtUsd(tvl) : '··'} />
        <FeaturedStat label="Open Markets" value={String(row.marketCount)} />
        <FeaturedStat label="NAV Ticks" value={String(row.series.length)} />
      </div>

      <span className="featured-cta">
        View strategy
        <ArrowUpRight size={16} strokeWidth={2.25} />
      </span>
    </Link>
  )
}

function FeaturedStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'pos' | 'neg' | 'neutral'
}) {
  return (
    <div>
      <div className="featured-stat-label">{label}</div>
      <div
        className={`featured-stat-value ${tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : ''}`}
      >
        {value}
      </div>
    </div>
  )
}

function FeaturedAgentEmpty() {
  return (
    <div className="featured-empty">
      <div className="featured-empty-headline">
        <em>The index is loading.</em>
      </div>
      <div className="featured-empty-body">
        Live strategies will appear here once agents begin trading on devnet. Each tick they execute
        writes a new NAV commit, and that commit is the scoreboard.
      </div>
    </div>
  )
}

function EditorialPromoCard() {
  return (
    <div className="promo-card">
      <div className="promo-card-bg" aria-hidden="true" />
      <div className="promo-eyebrow">How it works</div>
      <div className="promo-headline">Markets read the NAV chart, not an oracle.</div>
      <p className="promo-body">
        Every Bundie market settles by reading the strategy&apos;s on-chain NAV snapshot at the
        resolution slot. No external oracle. No manual operator. The chart you see decides the
        outcome.
      </p>
    </div>
  )
}

function Leaderboard({
  rows,
}: {
  rows: {
    sns: string
    displayName: string
    avatarSeed: number
    currentNavMicros: number | null
    return30dPct: number | null
    series: number[]
    marketCount: number
    snsVerified: boolean
  }[]
}) {
  if (rows.length === 0) {
    return (
      <div className="discover-empty">
        Live strategies will appear here once agents begin trading on devnet.
      </div>
    )
  }
  return (
    <div className="leaderboard">
      {rows.slice(0, 10).map((r, i) => (
        <LeaderboardRow key={r.sns} row={r} index={i + 1} />
      ))}
    </div>
  )
}

function LeaderboardRow({
  row,
  index,
}: {
  row: {
    sns: string
    displayName: string
    avatarSeed: number
    currentNavMicros: number | null
    return30dPct: number | null
    series: number[]
    marketCount: number
    snsVerified: boolean
  }
  index: number
}) {
  const tvl = row.currentNavMicros ? row.currentNavMicros / 1_000_000 : null
  const tone: 'pos' | 'neg' | 'flat' =
    row.return30dPct == null
      ? 'flat'
      : row.return30dPct > 0
        ? 'pos'
        : row.return30dPct < 0
          ? 'neg'
          : 'flat'

  const TrendIcon = tone === 'pos' ? TrendingUp : tone === 'neg' ? TrendingDown : null

  return (
    <Link href={`/agent/${encodeURIComponent(row.sns)}`} className="leaderboard-row">
      <div className="leaderboard-rank">{String(index).padStart(2, '0')}</div>
      <AgentCardCompact
        sns={row.sns}
        displayName={row.displayName}
        avatarSeed={row.avatarSeed}
        snsVerified={row.snsVerified}
        mode="row"
        avatarSize={32}
      />
      <div className="leaderboard-meta">
        <span>
          <span className="leaderboard-meta-k">TVL</span>
          <span className="leaderboard-meta-v">{tvl != null ? fmtUsd(tvl) : '··'}</span>
        </span>
        <span>
          <span className="leaderboard-meta-k">Markets</span>
          <span className="leaderboard-meta-v">{row.marketCount}</span>
        </span>
      </div>
      <div className="leaderboard-spark">
        <DeSparkline
          series={row.series}
          variant="small"
          width={140}
          height={32}
          tone={tone === 'flat' ? 'neutral' : tone}
        />
      </div>
      <div className={`leaderboard-return ${tone}`}>
        {TrendIcon && <TrendIcon size={14} strokeWidth={2.25} />}
        {fmtSignedPct(row.return30dPct)}
      </div>
    </Link>
  )
}

function ListYourAgentBand() {
  return (
    <section className="invite-band">
      <div className="invite-band-bg" aria-hidden="true" />
      <div className="invite-eyebrow">For strategists</div>
      <h2 className="invite-question">
        Running a trading agent on Solana? <em>List it on the index.</em>
      </h2>
      <Link href="/strategists" className="invite-cta">
        List your agent
        <ArrowRight size={16} strokeWidth={2.5} />
      </Link>
    </section>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filterTrending(markets: MarketView[], filter: TrendingFilterId): MarketView[] {
  const open = markets.filter((m) => m.status === 'active')
  const matchesKind = (k: number) => {
    if (filter === 'all') return true
    if (filter === 'rate') return k === 3
    if (filter === 'benchmark') return k === 2
    if (filter === 'agent_nav') return k === 1
    return true
  }
  return open
    .filter((m) => matchesKind(m.kind))
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 9)
}

function fmtSignedPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '··'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function fmtTvlUsd(lamports: string): string {
  try {
    const n = BigInt(lamports)
    const whole = n / 1_000_000n
    const remainder = n % 1_000_000n
    const usd = Number(whole) + Number(remainder) / 1_000_000
    return fmtUsd(usd)
  } catch {
    return '··'
  }
}

// ─── Platform stats fetcher ─────────────────────────────────────────────────

interface PlatformStats {
  agentsActive: number
  agentsTotal: number
  totalTvlLamports: string
  marketsTotal: number
  marketsOpen: number
  marketsResolved: number
  totalNavGrowth7dBps: number | null
  generatedAt: string
}

const EMPTY_PLATFORM_STATS: PlatformStats = {
  agentsActive: 0,
  agentsTotal: 0,
  totalTvlLamports: '0',
  marketsTotal: 0,
  marketsOpen: 0,
  marketsResolved: 0,
  totalNavGrowth7dBps: null,
  generatedAt: new Date().toISOString(),
}

async function fetchPlatformStats(): Promise<PlatformStats> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/stats/platform`, {
      next: { revalidate: 30 },
    })
    if (!res.ok) return EMPTY_PLATFORM_STATS
    const body = (await res.json()) as Partial<PlatformStats>
    return {
      agentsActive: body.agentsActive ?? 0,
      agentsTotal: body.agentsTotal ?? 0,
      totalTvlLamports: body.totalTvlLamports ?? '0',
      marketsTotal: body.marketsTotal ?? 0,
      marketsOpen: body.marketsOpen ?? 0,
      marketsResolved: body.marketsResolved ?? 0,
      totalNavGrowth7dBps: body.totalNavGrowth7dBps ?? null,
      generatedAt: body.generatedAt ?? new Date().toISOString(),
    }
  } catch {
    return EMPTY_PLATFORM_STATS
  }
}
