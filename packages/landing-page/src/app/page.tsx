import Image from 'next/image'
import { MotionSection } from '../components/motion-section'
import { StaggerChildren, StaggerItem } from '../components/stagger-children'
import { RevealText } from '../components/reveal-text'
import { FlowSequence } from '../components/flow-sequence'
import { FeaturesSwitcher } from '../components/FeaturesSwitcher'
import LiveAgentCards from '../components/LiveAgentCards'
import { LiveAgentsMasthead } from '../components/LiveAgentsMasthead'
import LiveTxFeed from '../components/LiveTxFeed'

// Re-export the segment cache window so live data refreshes every 30s
// in production. Matches the prior landing page's cadence.
export const revalidate = 30

// TODO: confirm production app URL. Today the deployed devnet app lives at
// https://app.solana.bundie.fi. Swap to https://app.bundie.fi once the apex
// subdomain is wired.
const APP_URL = 'https://app.solana.bundie.fi'
const TWITTER_URL = 'https://x.com/BundieDefi'
const GITHUB_URL = 'https://github.com/bundie-fi'

export default function Home() {
  return (
    <>
      <div className="grain" />

      {/* === NAV === */}
      <nav className="top">
        <div className="inner">
          <a href="#" className="brand" aria-label="Bundie">
            <span className="wordmark">Bundie</span>
          </a>
          <div className="nav-right">
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-amber btn-amber-sm"
            >
              Launch App
            </a>
          </div>
        </div>
      </nav>

      {/* === HERO === */}
      <section className="hero">
        <div className="ambient" />

        {/* Ghost equity curve. Single hand-tuned bezier path running
            across the hero behind the headline, ~6% opacity in the
            brand teal. Visually argues the headline copy: agents
            trade, this is the trace of one trading. Static, no
            animation — confidence over motion. The fade-at-edges
            gradient makes it read as continuing offscreen rather than
            as a finished chart. */}
        <svg
          className="hero-equity-ghost"
          aria-hidden="true"
          viewBox="0 0 1600 500"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="he-fade" x1="0%" x2="100%" y1="0%" y2="0%">
              <stop offset="0%" stopColor="rgb(18,68,58)" stopOpacity="0" />
              <stop offset="14%" stopColor="rgb(18,68,58)" stopOpacity="1" />
              <stop offset="86%" stopColor="rgb(18,68,58)" stopOpacity="1" />
              <stop offset="100%" stopColor="rgb(18,68,58)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            className="hero-equity-line"
            pathLength={1}
            d="M 0 440 C 200 430 360 410 520 380 C 660 354 780 320 900 270 C 1020 220 1120 160 1220 120 C 1270 102 1310 102 1360 124 C 1440 156 1520 200 1600 220"
            fill="none"
            stroke="url(#he-fade)"
            strokeOpacity="0.22"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Protocol waypoints. Each is a small dot on the curve plus
              a label above it, naming the protocol an agent routes
              through at that point. Turns the ghost line into a trade
              path: this is the trace of capital moving through Solana
              DeFi. Y-values are computed exactly on the cubic above
              via getPointAtLength — eyeballed values drift by 5–10
              units near the peak and end of the path. */}
          {[
            { x: 240, y: 421.4, name: 'Marinade' },
            { x: 540, y: 376.2, name: 'Kamino' },
            { x: 880, y: 278.2, name: 'Jito' },
            { x: 1140, y: 155.5, name: 'Solend' },
            { x: 1500, y: 185.1, name: 'Jupiter' },
          ].map((pt) => (
            <g
              key={pt.name}
              transform={`translate(${pt.x}, ${pt.y})`}
              className="hero-equity-waypoint"
              style={{ animationDelay: `${0.45 + (pt.x / 1600) * 2.0}s` }}
            >
              <circle cx="0" cy="0" r="3" fill="rgb(18,68,58)" fillOpacity="0.55" />
              <text
                x="0"
                y="-12"
                textAnchor="middle"
                fontFamily="var(--font-serif), 'Instrument Serif', Georgia, serif"
                fontSize="13"
                fontStyle="italic"
                fill="rgb(18,68,58)"
                fillOpacity="0.6"
              >
                {pt.name}
              </text>
            </g>
          ))}
          {/* Peak tick — same point as the second waypoint from the
              right (Solend). Kept separate so the HTML annotation
              label sits on top of it. */}
          <g
            transform="translate(1260, 105)"
            className="hero-equity-waypoint hero-equity-peak"
            style={{ animationDelay: `${0.45 + (1260 / 1600) * 2.0}s` }}
          >
            <line
              x1="0"
              y1="-14"
              x2="0"
              y2="0"
              stroke="rgb(18,68,58)"
              strokeOpacity="0.55"
              strokeWidth="1"
            />
            <circle cx="0" cy="0" r="2.5" fill="rgb(18,68,58)" fillOpacity="0.7" />
          </g>
        </svg>

        {/* Margin note, sits just above the peak tick. Rendered as HTML
            instead of SVG text so the brand sans renders on the pixel
            grid. Tiny, like a trader's pencil annotation. */}
        <span className="hero-equity-note hero-equity-note-animate" aria-hidden="true">
          <span className="hero-equity-note-num">+$1,247</span>
          <span className="hero-equity-note-meta">7d · kamino-stacker</span>
        </span>

        <div className="wrap">
          {/* Status pill , matches Aqua0 cadence: tiny pill above the
              huge headline, signals "this is live right now" before the
              visitor even reads the words. */}
          <span className="hero-badge" style={{ marginBottom: 28 }}>
            <span className="dot" />
            Live on Devnet
          </span>

          <h1 className="hero">
            Prediction market
            <span className="hero-line-2">
              for <em>trading agents.</em>
            </span>
          </h1>

          <div className="hero-sub">
            <p>
              The <em className="hero-sub-accent">index of DeFi performance</em> you can trade on.
            </p>
            <p>Settled on-chain. No oracle. No committee.</p>
          </div>

          <div className="hero-ctas">
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-amber btn-amber-lg"
            >
              Open a market →
            </a>
            <a href="#inside-bundie" className="btn-ghost btn-ghost-lg">
              See how it works
            </a>
          </div>

          {/* Market preview — newspaper-leaderboard layout with a
              blurred + faded "recent activity" tail underneath. The
              tail signals "there's more in the app" without ever
              looking like a screenshot. */}
          <MarketPreview />
        </div>
      </section>

      {/* LiveActivityBar removed — the "X agents live · top agent +Y%" strip
          duplicated the agent cards section below and the gain pct could
          surface stale pre-cap-fix NAV inflation. The hero stays pure CTA. */}

      {/* Section transition: hairline rule + centered glyph. Editorial
          hand-off so the hero doesn't bleed into PROBLEM × SOLUTION. */}
      <div className="section-rule" aria-hidden="true">
        <span className="section-rule-line" />
        <span className="section-rule-mark">·</span>
        <span className="section-rule-line" />
      </div>

      {/* === PROBLEM × SOLUTION === */}
      <MotionSection className="content">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">
              <span className="eyebrow-num">01</span>
              <span className="eyebrow-sep">—</span>
              The problem × The solution
            </span>
            <h2 className="section" style={{ marginTop: 16, maxWidth: 820 }}>
              Prediction markets without
              <em> the gut-feel guesswork.</em>
            </h2>
          </div>

          <div className="ps-grid">
            {/* Before */}
            <div className="ps-col">
              <p className="ps-eyebrow">Before</p>
              <h3 className="ps-title">
                Markets resolve on <span className="ps-dim">opinion.</span>
              </h3>
              <p className="ps-body">
                Oracles get gamed. Committees argue. By the time a market settles, the trade
                everyone wanted has already happened somewhere else.
              </p>
            </div>

            {/* Center stat panel , replaces the LiquidMorphCanvas in
                Aqua0's reference. Shows the three pieces that close the
                loop: agent → on-chain NAV → market settles. */}
            <div className="ps-center">
              <FlowSequence />
            </div>

            {/* After */}
            <div className="ps-col ps-col-right">
              <p className="ps-eyebrow">After</p>
              <h3 className="ps-title">
                Markets resolve on <em>performance.</em>
              </h3>
              <p className="ps-body">
                Bundie agents trade on Solana. Their NAV is on-chain. The LS-LMSR market reads the
                NAV and pays out , automatically, at the resolution slot.
              </p>
            </div>
          </div>

          {/* Stats strip , ported from Aqua0's PS section. */}
          <StaggerChildren className="ps-stats">
            <StaggerItem className="ps-stat">
              <span className="ps-stat-val">$50</span>
              <span className="ps-stat-lbl">Seed per agent</span>
            </StaggerItem>
            <StaggerItem className="ps-stat">
              <span className="ps-stat-val">5+</span>
              <span className="ps-stat-lbl">Solana protocols routed</span>
            </StaggerItem>
            <StaggerItem className="ps-stat">
              <span className="ps-stat-val">0</span>
              <span className="ps-stat-lbl">Oracles required</span>
            </StaggerItem>
            <StaggerItem className="ps-stat">
              <span className="ps-stat-val">LS-LMSR</span>
              <span className="ps-stat-lbl">Market maker</span>
            </StaggerItem>
          </StaggerChildren>
        </div>
      </MotionSection>

      <div className="section-rule" aria-hidden="true">
        <span className="section-rule-line" />
        <span className="section-rule-mark">·</span>
        <span className="section-rule-line" />
      </div>

      {/* === INSIDE BUNDIE (tabbed features) === */}
      <MotionSection id="inside-bundie" className="content">
        <div className="wrap">
          {/* Eyebrow + headline cascade up sequentially when the section
              scrolls into view, on top of the wrapper section's own
              fade-up. The user specifically called out the "Two
              primitives. One closed loop." headline — staggering the
              two spans makes the rise readable rather than monolithic. */}
          <StaggerChildren className="section-head">
            <StaggerItem>
              <span className="eyebrow">
                <span className="eyebrow-num">02</span>
                <span className="eyebrow-sep">—</span>
                Inside Bundie
              </span>
            </StaggerItem>
            <StaggerItem>
              <h2 className="section" style={{ marginTop: 16 }}>
                Two primitives.{' '}
                <RevealText className="text-reveal text-reveal-italic text-reveal-on-light">
                  One closed loop.
                </RevealText>
              </h2>
            </StaggerItem>
          </StaggerChildren>

          <div style={{ marginTop: 40 }}>
            <FeaturesSwitcher />
          </div>
        </div>
      </MotionSection>

      <div className="section-rule" aria-hidden="true">
        <span className="section-rule-line" />
        <span className="section-rule-mark">·</span>
        <span className="section-rule-line" />
      </div>

      {/* === LIVE AGENTS , real rows from the registry; falls back to
              hard-coded seed copy on backend failure. === */}
      <section className="content" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {/* Two-column section head: eyebrow + headline on the left,
              live registry status block on the right. The masthead is
              a server component that hits the same /api/agents
              endpoint as LiveAgentCards — Next's fetch cache dedupes
              so it's a free piggyback. Hidden if the backend is
              unreachable; fake stats are worse than no stats. */}
          <div className="section-head section-head-split">
            <div className="section-head-main">
              <span className="eyebrow">
                <span className="eyebrow-num">03</span>
                <span className="eyebrow-sep">—</span>
                Live agents
              </span>
              <h2 className="section" style={{ marginTop: 16, maxWidth: 820 }}>
                Real agents shipping <em>right now.</em>
              </h2>
            </div>
            <LiveAgentsMasthead />
          </div>
          <LiveAgentCards />
        </div>
      </section>

      {/* === LIVE TX FEED , silently hides if there's no recent activity. === */}
      <LiveTxFeed />

      <div className="section-rule" aria-hidden="true">
        <span className="section-rule-line" />
        <span className="section-rule-mark">·</span>
        <span className="section-rule-line" />
      </div>

      {/* === TRUSTED BY THE ECOSYSTEM === */}
      <MotionSection className="content">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">
              <span className="eyebrow-num">04</span>
              <span className="eyebrow-sep">—</span>
              Trusted by the ecosystem
            </span>
            <h2 className="section" style={{ marginTop: 16, maxWidth: 820 }}>
              Built on protocols that
              <em> already secure billions.</em>
            </h2>
            <p className="section-sub" style={{ margin: '20px 0 0' }}>
              Bundie agents don&apos;t reinvent yield. They route through the Solana protocols you
              already trust , and we&apos;re onboarding the rest.
            </p>
          </div>

          <StaggerChildren className="validation-grid">
            <StaggerItem className="validation-card">
              <div className="validation-logo">
                <img
                  src="/protocols/marinade.png"
                  alt="Marinade"
                  width={28}
                  height={28}
                  loading="eager"
                  decoding="async"
                />
              </div>
              <h3 className="validation-title">Marinade · Liquid staking</h3>
              <p className="validation-body">
                Agents stake idle SOL into mSOL for baseline yield without giving up exit liquidity.
                Live on devnet today.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo">
                <img
                  src="/protocols/kamino.png"
                  alt="Kamino"
                  width={28}
                  height={28}
                  loading="eager"
                  decoding="async"
                />
              </div>
              <h3 className="validation-title">Kamino · Lending</h3>
              <p className="validation-body">
                Lending desks for USDC and SOL. Agents read live utilization and rebalance into the
                higher-APY supply side.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo">
                <img
                  src="/protocols/jito.png"
                  alt="Jito"
                  width={28}
                  height={28}
                  loading="eager"
                  decoding="async"
                />
              </div>
              <h3 className="validation-title">Jito · MEV-aware staking</h3>
              <p className="validation-body">
                JitoSOL gives agents an upgraded LST with built-in MEV rebates , same exit profile
                as mSOL, more juice on top.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo">
                <img
                  src="/protocols/solend.png"
                  alt="Solend"
                  width={28}
                  height={28}
                  loading="eager"
                  decoding="async"
                />
              </div>
              <h3 className="validation-title">Solend · Permissionless lending</h3>
              <p className="validation-body">
                A second lending venue agents compare against Kamino tick-by-tick, picking whichever
                supply rate is highest.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo">
                <img
                  src="/protocols/jupiter.png"
                  alt="Jupiter"
                  width={28}
                  height={28}
                  loading="eager"
                  decoding="async"
                />
              </div>
              <h3 className="validation-title">Jupiter · Aggregated swaps</h3>
              <p className="validation-body">
                Best-execution swap routing across Solana DEXs. Agents use it to enter / rebalance
                positions when one leg of a strategy needs a different asset.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo">
                <img
                  src="/protocols/jupiter-perps.png"
                  alt="Jupiter Perps"
                  width={28}
                  height={28}
                  loading="eager"
                  decoding="async"
                />
              </div>
              <h3 className="validation-title">Jupiter Perpetuals · Leverage</h3>
              <p className="validation-body">
                Long / short SOL, ETH, BTC up to 100x. Used when a strategy needs directional
                exposure or a hedge against the spot leg.
              </p>
            </StaggerItem>
          </StaggerChildren>
        </div>
      </MotionSection>

      <div className="section-rule" aria-hidden="true">
        <span className="section-rule-line" />
        <span className="section-rule-mark">·</span>
        <span className="section-rule-line" />
      </div>

      {/* === FEES — three confident figures, no card, no table.
              Each column is one number you need to know. The serif
              numerals do all the typographic work; everything else
              fades to support copy. === */}
      <MotionSection className="content">
        <div className="wrap">
          <div className="section-head" style={{ marginBottom: 32 }}>
            <span className="eyebrow">
              <span className="eyebrow-num">05</span>
              <span className="eyebrow-sep">—</span>
              Fees
            </span>
            <h2 className="section" style={{ marginTop: 16 }}>
              Three numbers.
              <em> The only three.</em>
            </h2>
          </div>

          <div className="fees-trio">
            <div className="fees-figure">
              <span className="fees-figure-num">0%</span>
              <span className="fees-figure-label">on NAV</span>
              <span className="fees-figure-meta">Bundie takes nothing from agent earnings.</span>
            </div>
            <div className="fees-figure">
              <span className="fees-figure-num">$0</span>
              <span className="fees-figure-label">per bet</span>
              <span className="fees-figure-meta">No spread, no take rate, no resolution fee.</span>
            </div>
            <div className="fees-figure">
              <span className="fees-figure-num">~$0.00005</span>
              <span className="fees-figure-label">per Solana tx</span>
              <span className="fees-figure-meta">
                The only on-chain cost. Paid to validators, not us.
              </span>
            </div>
          </div>
        </div>
      </MotionSection>

      {/* === FINAL CTA === */}
      <section className="final-cta-band">
        <div className="wrap">
          <span className="final-cta-pill">
            <span className="final-cta-dot" />
            Live · Devnet
          </span>

          <h2 className="final-cta-headline">
            Bet on agents.
            <RevealText className="final-cta-line-2 text-reveal text-reveal-on-dark">
              Earn from their wins.
            </RevealText>
          </h2>

          <p className="final-cta-sub">
            Live on devnet. Free during the demo. Connect a Solana wallet, claim 50 bUSD from the
            faucet, and you&apos;re in.
          </p>

          <div className="hero-ctas" style={{ justifyContent: 'center' }}>
            <a href={APP_URL} target="_blank" rel="noopener noreferrer" className="final-cta-btn">
              Try the demo →
            </a>
          </div>
        </div>
      </section>

      {/* === FOOTER === */}
      <footer>
        <div className="wrap">
          <div className="row-1">
            <a href="#" className="brand" aria-label="Bundie">
              <Image
                src="/assets/favicon-32.png"
                alt=""
                width={24}
                height={24}
                unoptimized
                style={{ opacity: 0.9 }}
              />
              <span className="wordmark" style={{ fontSize: 20 }}>
                Bundie
              </span>
            </a>
            <div className="links">
              <a href={APP_URL} target="_blank" rel="noopener noreferrer">
                Launch App ↗
              </a>
              <a href={TWITTER_URL} target="_blank" rel="noopener noreferrer">
                Twitter
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </div>
          </div>
          <div className="row-2">© 2026 Bundie. Built on Solana.</div>
        </div>
      </footer>
    </>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   Market preview (newspaper leaderboard, with a blurred-fade tail)
   ────────────────────────────────────────────────────────────────────── */

const RECENT_TRADES = [
  { side: 'BUY', size: '50 YES', price: '0.62 → 0.63', when: '2m ago' },
  { side: 'SELL', size: '30 YES', price: '0.62 → 0.61', when: '4m ago' },
]

function MarketPreview() {
  return (
    <article className="mkt-a">
      <div className="mkt-a-eyebrow">Live market · example</div>
      <h3 className="mkt-a-question">
        Will <em>kamino-stacker</em> outperform <em>funding-shorter</em> by Friday?
      </h3>
      <div className="mkt-a-table">
        <div className="mkt-a-row">
          <span className="mkt-a-side mkt-a-side-yes">YES</span>
          <span className="mkt-a-name">kamino-stacker wins</span>
          <span className="mkt-a-pct">62%</span>
        </div>
        <div className="mkt-a-row">
          <span className="mkt-a-side mkt-a-side-no">NO</span>
          <span className="mkt-a-name">funding-shorter wins</span>
          <span className="mkt-a-pct mkt-a-pct-dim">38%</span>
        </div>
      </div>
      <div className="mkt-a-footer">
        <span>256 bUSD vol</span>
        <span className="mkt-dot">·</span>
        <span>Resolves Fri 9 May</span>
        <span className="mkt-dot">·</span>
        <span>No oracle</span>
      </div>

      {/* Tail — recent activity peek. Visually blurs and fades to
          transparent at the bottom of the card so it reads as
          "there's more in the app, here is a glimpse". The content
          itself is real-shaped (trade ledger rows) so even the
          out-of-focus version reads as something believable. */}
      <div className="mkt-a-tail" aria-hidden="true">
        <div className="mkt-a-tail-eyebrow">Recent activity</div>
        <div className="mkt-a-tail-rows">
          {RECENT_TRADES.map((t, i) => (
            <div key={i} className="mkt-a-tail-row">
              <span
                className={`mkt-a-tail-side ${
                  t.side === 'BUY' ? 'mkt-a-tail-side-buy' : 'mkt-a-tail-side-sell'
                }`}
              >
                {t.side}
              </span>
              <span className="mkt-a-tail-size">{t.size}</span>
              <span className="mkt-a-tail-price">{t.price}</span>
              <span className="mkt-a-tail-when">{t.when}</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}
