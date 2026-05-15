import Image from 'next/image'
import { MotionSection } from '../components/motion-section'
import { StaggerChildren, StaggerItem } from '../components/stagger-children'
import { RevealText } from '../components/reveal-text'

// Static marketing surface. 5min ISR is plenty, copy doesn't move minute
// to minute, and the live data lives in the app, not here.
export const revalidate = 300

// Production URLs. App lives on the solana.bundie.fi subdomain; the apex
// solana.bundie.fi serves this landing page. /markets and /api are the two
// public doors into the protocol.
const MARKETS_URL = 'https://app.solana.bundie.fi/markets'
// The agent-facing landing section lives at #for-agents on THIS page —
// the webapp no longer has a /api docs page (the app is trader-only).
// Same-origin anchor links so we don't bounce the user through a
// redirect that lands them right back here.
const API_URL = '#for-agents'
const DOCS_URL = '#for-agents'
const GITHUB_URL = 'https://github.com/bundie-fi/mcp'
const TWITTER_URL = 'https://x.com/BundieDefi'

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
              href={MARKETS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost btn-amber-sm"
              style={{ marginRight: 8 }}
            >
              Markets
            </a>
            <a
              href={API_URL}
              className="btn-amber btn-amber-sm"
            >
              Read API
            </a>
          </div>
        </div>
      </nav>

      {/* === HERO === */}
      <section className="hero">
        <div className="ambient" />

        {/* Ghost equity curve. Same hand-tuned bezier as before, but the
            waypoint labels now name EVENTS rather than DeFi protocols.
            Argues "this is the trace of consensus moving through
            events", the through-line of every market on Bundie. */}
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
          {/* Event waypoints. Each is a small dot on the curve plus an
              italic label above it, the kind of event Bundie prices.
              Y-values are computed exactly on the cubic via
              getPointAtLength so the dots sit on the line. */}
          {[
            { x: 240, y: 421.4, name: 'USDC depeg' },
            { x: 540, y: 376.2, name: 'Kamino TVL' },
            { x: 880, y: 278.2, name: 'AWS outage' },
            { x: 1140, y: 155.5, name: 'SOL drift' },
            { x: 1500, y: 185.1, name: 'Anthropic uptime' },
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
          {/* Peak tick, same point as the second waypoint from the
              right. Kept separate so the HTML annotation label sits
              on top of it. */}
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

        {/* Margin note. Reframed from agent PnL to a live consensus
            price, the trace of a market moving. Tiny, like a trader's
            pencil annotation. */}
        <span className="hero-equity-note hero-equity-note-animate" aria-hidden="true">
          <span className="hero-equity-note-num">0.78 YES</span>
          <span className="hero-equity-note-meta">7d · sol-drift-may</span>
        </span>

        <div className="wrap">
          <span className="hero-badge" style={{ marginBottom: 28 }}>
            <span className="dot" />
            Live on Devnet
          </span>

          <h1 className="hero">
            The oracle agents read
            <span className="hero-line-2">
              <em>to price the future.</em>
            </span>
          </h1>

          <div className="hero-sub">
            <p>
              Existing oracles price the present, BTC right now, ETH right now. Bundie prices what&apos;s
              <em className="hero-sub-accent"> about to happen.</em>
            </p>
            <p>Depegs, outages, TVL drops, network incidents. Every measurable event has a live consensus price, settled on-chain.</p>
          </div>

          <div className="hero-ctas">
            <a
              href={MARKETS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-amber btn-amber-lg"
            >
              Trade markets →
            </a>
            <a
              href={API_URL}
              className="btn-ghost btn-ghost-lg"
            >
              Read consensus →
            </a>
          </div>

          <MarketPreview />
        </div>
      </section>

      <div className="section-rule" aria-hidden="true">
        <span className="section-rule-line" />
        <span className="section-rule-mark">·</span>
        <span className="section-rule-line" />
      </div>

      {/* === WHAT YOU CAN PRICE === */}
      <MotionSection className="content">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">
              <span className="eyebrow-num">01</span>
              <span className="eyebrow-sep">·</span>
              What you can price
            </span>
            <h2 className="section" style={{ marginTop: 16, maxWidth: 820 }}>
              Anything an agent needs to know
              <em> before the news does.</em>
            </h2>
            <p className="section-sub" style={{ margin: '20px 0 0' }}>
              Four domains live on devnet today. Every market resolves from on-chain or attested
              off-chain data, never from a committee vote.
            </p>
          </div>

          <StaggerChildren className="validation-grid">
            <StaggerItem className="validation-card">
              <div className="validation-logo" aria-hidden="true">
                <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 18 }}>
                  $
                </span>
              </div>
              <h3 className="validation-title">Stablecoin price</h3>
              <p className="validation-body">
                Will a stablecoin lose its peg, and for how long? Markets resolve from on-chain
                price feeds at the resolution slot.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo" aria-hidden="true">
                <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 18 }}>
                  T
                </span>
              </div>
              <h3 className="validation-title">Protocol TVL</h3>
              <p className="validation-body">
                TVL drops past a threshold. Fast withdrawals, depositor exits. Settles from
                on-chain account state, not a committee.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo" aria-hidden="true">
                <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 18 }}>
                  ☁
                </span>
              </div>
              <h3 className="validation-title">Cloud uptime</h3>
              <p className="validation-body">
                API and service outages on AWS, Anthropic, OpenAI, Cloudflare. Resolves from
                attested status-page snapshots over the resolution window.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo" aria-hidden="true">
                <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 18 }}>
                  ◉
                </span>
              </div>
              <h3 className="validation-title">Network incidents</h3>
              <p className="validation-body">
                Region outages, validator events, oracle deviations. The conditions that move
                portfolios before they hit a dashboard.
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

      {/* === HOW IT WORKS === */}
      <MotionSection className="content">
        <div className="wrap">
          <StaggerChildren className="section-head">
            <StaggerItem>
              <span className="eyebrow">
                <span className="eyebrow-num">02</span>
                <span className="eyebrow-sep">·</span>
                How it works
              </span>
            </StaggerItem>
            <StaggerItem>
              <h2 className="section" style={{ marginTop: 16 }}>
                A loop, not a feed.
                <span className="section-coda">
                  <RevealText className="text-reveal text-reveal-italic text-reveal-on-light">
                    Traders price it. Agents read it.
                  </RevealText>
                </span>
              </h2>
            </StaggerItem>
          </StaggerChildren>

          <div className="steps" style={{ marginTop: 40 }}>
            <div className="step">
              <span className="step-num">01</span>
              <h3>
                Traders <em>bet YES/NO</em> on every measurable event.
              </h3>
              <p>
                Anyone can open a market. Anyone can take a side. Skin in the game is the
                signal. Opinions cost nothing, positions cost capital.
              </p>
            </div>
            <div className="step">
              <span className="step-num">02</span>
              <h3>
                <em>Consensus emerges</em> as an LMSR price between 0 and 1.
              </h3>
              <p>
                A logarithmic market scoring rule keeps liquidity continuous and prices honest.
                Deeper markets move slower, but they price the truth more sharply.
              </p>
            </div>
            <div className="step">
              <span className="step-num">03</span>
              <h3>
                Agents <em>pay to read it</em> over x402, attested with ed25519.
              </h3>
              <p>
                One HTTP call gets a signed price an agent can act on. Settlement happens
                on-chain at the resolution slot. No oracle to game, no committee to lobby.
              </p>
            </div>
          </div>
        </div>
      </MotionSection>

      <div className="section-rule" aria-hidden="true">
        <span className="section-rule-line" />
        <span className="section-rule-mark">·</span>
        <span className="section-rule-line" />
      </div>

      {/* === FOR AGENTS === */}
      <MotionSection className="content" id="for-agents">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">
              <span className="eyebrow-num">03</span>
              <span className="eyebrow-sep">·</span>
              For agents
            </span>
            <h2 className="section" style={{ marginTop: 16, maxWidth: 820 }}>
              Your agent sees what&apos;s coming,
              <em> before the news does.</em>
            </h2>
            <p className="section-sub" style={{ margin: '20px 0 0' }}>
              Three doors into Bundie. Same data, different ergonomics depending on whether your
              agent speaks MCP, HTTP, or Solana txs.
            </p>
          </div>

          <CurlExample />

          <div style={{ marginTop: 40 }}>
          <StaggerChildren className="validation-grid">
            <StaggerItem className="validation-card">
              <h3 className="validation-title">
                <code style={{ fontFamily: 'var(--font-sans)' }}>@bundie/sol-mcp</code>
              </h3>
              <p className="validation-body">
                Drop Bundie into Claude, Cursor, or any MCP-aware agent. One config block; the agent
                can list markets and read prices natively.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <h3 className="validation-title">
                <code style={{ fontFamily: 'var(--font-sans)' }}>curl + x402</code>
              </h3>
              <p className="validation-body">
                Pure HTTP. Pay micro-USDC per read, get a signed price plus attestation. Works from
                any runtime that can sign a 402 response.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <h3 className="validation-title">
                <code style={{ fontFamily: 'var(--font-sans)' }}>@bundie/sol-cli</code>
              </h3>
              <p className="validation-body">
                Write side. Open markets, post liquidity, settle from on-chain data, all from a
                terminal. The same SDK powers the app.
              </p>
            </StaggerItem>
          </StaggerChildren>
          </div>
        </div>
      </MotionSection>

      <div className="section-rule" aria-hidden="true">
        <span className="section-rule-line" />
        <span className="section-rule-mark">·</span>
        <span className="section-rule-line" />
      </div>

      {/* === PRICING === */}
      <MotionSection className="content">
        <div className="wrap">
          <div className="section-head" style={{ marginBottom: 32 }}>
            <span className="eyebrow">
              <span className="eyebrow-num">04</span>
              <span className="eyebrow-sep">·</span>
              Pricing
            </span>
            <h2 className="section" style={{ marginTop: 16 }}>
              Priced by what
              <em> the signal is worth.</em>
            </h2>
            <p className="section-sub" style={{ margin: '20px 0 0', maxWidth: 720 }}>
              An oracle&apos;s value is the capital backing its signal. A 10x deeper market is harder
              to game, so the read costs more, but the curve is logarithmic, not linear, so depth
              never runs away from the agent paying for it.
            </p>
          </div>

          <div className="price-tier-grid">
            <div className="price-tier-card">
              <div className="price-tier-tag">Floor</div>
              <div className="price-tier-amount">
                <span className="price-tier-num">$0.0001</span>
                <span className="price-tier-unit">/ call</span>
              </div>
              <div className="price-tier-depth">Markets under $500 depth</div>
              <ul className="price-tier-list">
                <li>Just-opened markets</li>
                <li>Stubs and bootstrapping liquidity</li>
                <li>Pays for the Solana tx, nothing else</li>
              </ul>
            </div>

            <div className="price-tier-card price-tier-card-mid">
              <div className="price-tier-tag">Standard</div>
              <div className="price-tier-amount">
                <span className="price-tier-num">$0.001</span>
                <span className="price-tier-unit">/ call</span>
              </div>
              <div className="price-tier-depth">Markets around $1,000 depth</div>
              <ul className="price-tier-list">
                <li>The everyday read</li>
                <li>Real traders, real positions</li>
                <li>Signal you can act on</li>
              </ul>
            </div>

            <div className="price-tier-card">
              <div className="price-tier-tag">Deep</div>
              <div className="price-tier-amount">
                <span className="price-tier-num">$0.01</span>
                <span className="price-tier-unit">/ call</span>
              </div>
              <div className="price-tier-depth">Markets at $100,000+ depth</div>
              <ul className="price-tier-list">
                <li>Consensus carried by serious capital</li>
                <li>The hardest signal to fake</li>
                <li>Hard cap, no whale gaming</li>
              </ul>
            </div>
          </div>

          <p className="section-sub" style={{ margin: '28px auto 0', maxWidth: 720, fontSize: 14, textAlign: 'center' }}>
            Pay only when you read. Logarithmic curve, every market lands on its own point between
            floor and ceiling. The response includes{' '}
            <code style={{ fontFamily: 'var(--font-sans)' }}>read_price_usdc_micro</code> so retries
            bid the right amount automatically.
          </p>
        </div>
      </MotionSection>

      <div className="section-rule" aria-hidden="true">
        <span className="section-rule-line" />
        <span className="section-rule-mark">·</span>
        <span className="section-rule-line" />
      </div>

      {/* === WHY BUNDIE === */}
      <MotionSection className="content">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">
              <span className="eyebrow-num">05</span>
              <span className="eyebrow-sep">·</span>
              Why Bundie
            </span>
            <h2 className="section" style={{ marginTop: 16, maxWidth: 820 }}>
              A different axis from
              <em> every adjacent product.</em>
            </h2>
          </div>

          <StaggerChildren className="validation-grid">
            <StaggerItem className="validation-card">
              <h3 className="validation-title">vs Pyth / Chainlink</h3>
              <p className="validation-body">
                They price the present, BTC right now, ETH right now. Bundie prices the future,
                the conditions that move portfolios before the price does.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <h3 className="validation-title">vs Polymarket / Kalshi</h3>
              <p className="validation-body">
                Consumer products built for traders. Bundie is infrastructure; every market has an
                API, an attestation, and an SLA an agent can rely on.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <h3 className="validation-title">vs the news</h3>
              <p className="validation-body">
                Headlines lag. Markets move first. By the time a story prints, the price has already
                said it. Bundie surfaces the move while it&apos;s happening.
              </p>
            </StaggerItem>
          </StaggerChildren>
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
            Built for AI agents.
            <RevealText className="final-cta-line-2 text-reveal text-reveal-on-dark">
              Priced by traders. Settled by the chain.
            </RevealText>
          </h2>

          <p className="final-cta-sub">
            Open a market, take a side, or wire an agent in over x402. Free during devnet.
          </p>

          <div className="hero-ctas" style={{ justifyContent: 'center' }}>
            <a href={MARKETS_URL} target="_blank" rel="noopener noreferrer" className="final-cta-btn">
              Trade markets →
            </a>
            <a
              href={API_URL}
              className="btn-ghost btn-ghost-lg"
              style={{ marginLeft: 12 }}
            >
              Read consensus →
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
              <a href={MARKETS_URL} target="_blank" rel="noopener noreferrer">
                Markets ↗
              </a>
              <a href={API_URL}>
                API
              </a>
              <a href={DOCS_URL}>
                Docs
              </a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              <a href={TWITTER_URL} target="_blank" rel="noopener noreferrer">
                Twitter
              </a>
            </div>
          </div>
          <div className="row-2">
            Built for AI agents. Priced by traders. Settled by the chain. · © 2026 Bundie
          </div>
        </div>
      </footer>
    </>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   Market preview (newspaper leaderboard, with a blurred-fade tail)
   Reframed: the market is now an event-priced market (AWS outage),
   not an agent-vs-agent matchup. Same component, different content.
   ────────────────────────────────────────────────────────────────────── */

const RECENT_TRADES = [
  { side: 'BUY', size: '50 YES', price: '0.78 → 0.79', when: '2m ago' },
  { side: 'SELL', size: '30 YES', price: '0.78 → 0.77', when: '4m ago' },
]

function MarketPreview() {
  return (
    <article className="mkt-a">
      <div className="mkt-a-eyebrow">Live market · example</div>
      <h3 className="mkt-a-question">
        Will <em>AWS us-east-1</em> report an incident before Friday?
      </h3>
      <div className="mkt-a-table">
        <div className="mkt-a-row">
          <span className="mkt-a-side mkt-a-side-yes">YES</span>
          <span className="mkt-a-name">Incident reported</span>
          <span className="mkt-a-pct">78%</span>
        </div>
        <div className="mkt-a-row">
          <span className="mkt-a-side mkt-a-side-no">NO</span>
          <span className="mkt-a-name">Clean window</span>
          <span className="mkt-a-pct mkt-a-pct-dim">22%</span>
        </div>
      </div>
      <div className="mkt-a-footer">
        <span>$4,210 depth</span>
        <span className="mkt-dot">·</span>
        <span>Resolves Fri 9 May</span>
        <span className="mkt-dot">·</span>
        <span>Read: $0.0039</span>
      </div>

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

/* ──────────────────────────────────────────────────────────────────────
   Curl example for agents. Live-typing animation: each line reveals in
   sequence (request lines first, brief pause, then the response). Mimics
   a terminal session, anchors the abstract claim of "one HTTP call →
   signed price" in something the reader can watch happen.

   Each .ct-line carries its own animation-delay so the cascade is purely
   CSS, no JS needed. The trailing caret blinks on the last response line.
   ────────────────────────────────────────────────────────────────────── */

interface CurlLineProps {
  pad?: number;
  delay: number; // ms
  comment?: boolean;
  pause?: boolean; // adds margin-top before the line, used for the request → response break
  caret?: boolean; // shows a blinking caret at end of line
  children: React.ReactNode;
}

function CurlLine({ pad = 0, delay, comment, pause, caret, children }: CurlLineProps) {
  return (
    <div
      className="ct-line"
      data-pause={pause ? 'response' : undefined}
      style={{
        paddingLeft: pad,
        color: comment ? 'rgba(219,233,226,0.5)' : undefined,
        animationDelay: `${delay}ms`,
      }}
    >
      {children}
      {caret ? <span className="ct-caret" /> : null}
    </div>
  );
}

function CurlExample() {
  const KEY = { color: '#9ad0b7' };
  const VAL = { color: '#f0c474' };
  const URL = { color: '#dbe9e2' };
  return (
    <div
      className="ct-shell"
      style={{
        marginTop: 40,
        background: 'rgb(18,68,58)',
        color: '#dbe9e2',
        borderRadius: 14,
        padding: '28px 32px',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        lineHeight: 1.7,
        overflowX: 'auto',
        boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset',
      }}
    >
      <CurlLine delay={0} comment>
        # one HTTP call, signed response, micro-USDC over x402
      </CurlLine>
      <CurlLine delay={260}>
        <span style={VAL}>curl</span> -X POST{' '}
        <span style={URL}>https://backend.solana.bundie.fi/v1/event-price</span>
      </CurlLine>
      <CurlLine delay={520} pad={14}>
        -H <span style={VAL}>&quot;X-PAYMENT: $x402_token$&quot;</span> \
      </CurlLine>
      <CurlLine delay={780} pad={14}>
        -d <span style={VAL}>&apos;{'{'}&quot;id&quot;:&quot;aws_us_east_1_incident_30min_30d&quot;{'}'}&apos;</span>
      </CurlLine>

      <CurlLine delay={1280} comment pause>
        # response
      </CurlLine>
      <CurlLine delay={1440}>{'{'}</CurlLine>
      <CurlLine delay={1560} pad={18}>
        <span style={KEY}>&quot;event_id&quot;</span>:{' '}
        <span style={VAL}>&quot;aws_us_east_1_incident_30min_30d&quot;</span>,
      </CurlLine>
      <CurlLine delay={1680} pad={18}>
        <span style={KEY}>&quot;price&quot;</span>:{' '}
        <span style={VAL}>0.78</span>,
      </CurlLine>
      <CurlLine delay={1800} pad={18}>
        <span style={KEY}>&quot;depth_usd&quot;</span>:{' '}
        <span style={VAL}>4210</span>,
      </CurlLine>
      <CurlLine delay={1920} pad={18}>
        <span style={KEY}>&quot;read_price_usdc_micro&quot;</span>:{' '}
        <span style={VAL}>3900</span>,{' '}
        <span style={{ color: 'rgba(219,233,226,0.5)' }}>// next read costs $0.0039</span>
      </CurlLine>
      <CurlLine delay={2040} pad={18}>
        <span style={KEY}>&quot;signed_attestation&quot;</span>:{' '}
        <span style={VAL}>&quot;ed25519:0x…&quot;</span>,
      </CurlLine>
      <CurlLine delay={2160} pad={18}>
        <span style={KEY}>&quot;resolver_track_record&quot;</span>:{' '}
        <span style={VAL}>{'{ '}&quot;total&quot;: 27, &quot;disputed&quot;: 0, &quot;lost&quot;: 0{' }'}</span>
      </CurlLine>
      <CurlLine delay={2280} caret>{'}'}</CurlLine>
    </div>
  )
}
