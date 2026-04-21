import Image from "next/image";
import AgentsAtWork from "@/components/AgentsAtWork";
import WaitlistForm from "@/components/WaitlistForm";

const threeRoles = [
  {
    tagClass: "tag-create",
    tag: "Agent · Compose",
    heading: "Agents compose strategies.",
    body: "Autonomous agents assemble DeFi strategies, starting with Kamino USDC lending. The strategy mints as a tradeable SPL token. The agent's wallet earns a performance fee only when backers profit.",
  },
  {
    tagClass: "tag-back",
    tag: "Human · Back",
    heading: "You back strategies you trust.",
    body: "Open the Bundie app, swipe through live strategies, read the 7-day NAV chart, tap Back. Buy shares at the current portfolio value. Redeem anytime. No lockups, no minimums, no fund manager between you and your capital.",
  },
  {
    tagClass: "tag-predict",
    tag: "Human · Predict",
    heading: "You predict who will perform.",
    body: "A forward-looking signal for backers: will this strategy hit 10% APY by next month? Take a YES or NO position. Markets settle from the strategy's on-chain NAV. No external oracle in the resolution path.",
  },
];

const howSteps = [
  {
    n: "01",
    heading: "A <em>strategy-creator agent</em> composes a yield strategy.",
    body: "An autonomous agent reads on-chain conditions, picks integration targets, and assembles a yield strategy. It starts with Kamino USDC lending. One transaction mints tradeable SPL shares. The agent's .sol wallet is stamped on-chain as the creator.",
  },
  {
    n: "02",
    heading: "A <em>market-maker agent</em> opens a prediction market.",
    body: "A second, independent agent watches for new strategies. When one crosses a TVL threshold, it opens a prediction market on whether the strategy will hit its APY target. First-party address-equality checks keep the strategy-creator out of its own market.",
  },
  {
    n: "03",
    heading: "You back it on mobile.",
    body: 'Open the Bundie app. Swipe through Discover. Read the NAV chart and the market signal ("72% say this hits 8% APY"). Tap Back, pick a size, sign. Shares land in your portfolio at the current price. You redeem any time.',
  },
  {
    n: "04",
    heading: "Markets resolve from on-chain NAV.",
    body: 'At the resolution block, anyone can call <span class="mono-inline">resolve</span>. The program reads the strategy\'s live NAV through the underlying protocol accounts and settles. No external oracle. No disputes. The strategy is its own settlement source.',
  },
];

const differentiators = [
  {
    eyebrow: "01 · Not copy trading",
    heading: "Shared assets, not mirrored accounts.",
    body: "Copy trading replicates a trader's actions inside your own account. You hold mirrored positions that aren't transferable, priceable, or sellable. Bundie creates a shared tradeable asset with a live price that anyone can buy, sell, or predict on.",
  },
  {
    eyebrow: "02 · Self-resolving markets",
    heading: "The strategy's performance is the oracle.",
    body: "Other prediction markets on Solana settle via external price feeds that can be slow, disputed, or manipulated. Bundie markets resolve directly from the strategy's on-chain portfolio data. The strategy's performance is the source of truth.",
  },
  {
    eyebrow: "03 · Performance fees, not AUM",
    heading: "Creators earn only when backers do.",
    body: "Creators earn a percentage of the profits they generate for backers, not a percentage of assets under management. If the strategy doesn't perform, the creator earns nothing. Incentives are fully aligned.",
  },
  {
    eyebrow: "04 · Internet Capital Markets",
    heading: "Built for Internet Capital Markets.",
    body: "Solana's direction is Internet Capital Markets: tokenized, globally accessible markets for anyone with an internet connection. Bundie is that layer for DeFi strategies. Strategies tokenize in a single transaction. Portfolio values update on-chain continuously. The entire system runs with no trusted intermediary.",
    accent: true,
  },
];

const strategies = [
  {
    handle: "yudhi.sol",
    name: "USDC Compounder",
    tvl: "$52K",
    apy: "+14.2%",
    spark: "M0,18 L6,16 L14,14 L22,15 L30,11 L38,12 L46,8 L54,9 L62,5 L70,4",
    fill: "M0,18 L6,16 L14,14 L22,15 L30,11 L38,12 L46,8 L54,9 L62,5 L70,4 L70,22 L0,22 Z",
  },
  {
    handle: "market-maker.sol",
    name: "Funding Rate Arb",
    tvl: "$31K",
    apy: "+22.7%",
    spark: "M0,19 L7,17 L14,18 L21,13 L28,14 L35,10 L42,11 L49,6 L56,7 L63,3 L70,4",
    fill: "M0,19 L7,17 L14,18 L21,13 L28,14 L35,10 L42,11 L49,6 L56,7 L63,3 L70,4 L70,22 L0,22 Z",
  },
  {
    handle: "sean.sol",
    name: "Vault Accelerator",
    tvl: "$18K",
    apy: "+31.5%",
    spark: "M0,20 L8,18 L16,14 L24,16 L32,10 L40,12 L48,7 L56,8 L64,3 L70,2",
    fill: "M0,20 L8,18 L16,14 L24,16 L32,10 L40,12 L48,7 L56,8 L64,3 L70,2 L70,22 L0,22 Z",
  },
];

export default function Home() {
  return (
    <>
      <div className="grain" />

      <nav className="top">
        <div className="inner">
          <a href="#" className="brand" aria-label="Bundie">
            <Image
              src="/assets/bundie-mark-white.png"
              alt=""
              width={32}
              height={32}
              priority
              unoptimized
            />
            <span className="wordmark">Bundie</span>
          </a>
          <span className="status-pill">
            <span className="dot" />
            Waitlist open <span className="dot-sep">·</span> Solana devnet
          </span>
        </div>
      </nav>

      <section className="hero">
        <div className="ambient" />
        <div className="wrap">
          <span className="hero-badge">
            <span className="dot" />
            In development <span style={{ opacity: 0.5, margin: "0 2px" }}>·</span> Solana devnet
          </span>

          <h1 className="hero">
            Internet Capital Markets
            <br />
            for DeFi <em>strategies.</em>
          </h1>

          <div className="hero-sub">
            <p>Agents build DeFi strategies on Solana and mint them as tradeable SPL tokens.</p>
            <p>Back the ones you trust. Predict who'll outperform.</p>
          </div>

          <WaitlistForm variant="hero" />
        </div>
      </section>

      <section className="content">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Three roles, one protocol</span>
          </div>

          <div className="three-col">
            {threeRoles.map((r) => (
              <article key={r.tag} className="card">
                <span className={`tag ${r.tagClass}`}>{r.tag}</span>
                <h3>{r.heading}</h3>
                <p>{r.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="content" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2 className="section" style={{ marginTop: 20 }}>
              From strategy to tradeable asset in <em>four steps.</em>
            </h2>
          </div>

          <div className="steps">
            {howSteps.map((s) => (
              <div key={s.n} className="step">
                <div className="step-num">{s.n}</div>
                <div>
                  <h3 dangerouslySetInnerHTML={{ __html: s.heading }} />
                  <p dangerouslySetInnerHTML={{ __html: s.body }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <AgentsAtWork />

      <section className="content">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">What makes it different</span>
            <h2 className="section" style={{ marginTop: 20 }}>
              A new financial primitive,
              <br />
              not a <em>wrapper.</em>
            </h2>
          </div>

          <div className="diff-wrap">
            <div className="diff">
              {differentiators.map((d) => (
                <article key={d.eyebrow} className={"card" + (d.accent ? " accent" : "")}>
                  <span className="card-eyebrow">{d.eyebrow}</span>
                  <h3>{d.heading}</h3>
                  <p>{d.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="content">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Early preview</span>
          </div>

          <div className="browser">
            <div className="browser-chrome">
              <span className="dots">
                <span />
                <span />
                <span />
              </span>
              <div className="url-bar">
                <span className="lock">🔒</span>app.bundie.fi/discover
              </div>
              <span style={{ width: 44 }} />
            </div>

            <div className="discover-body">
              <div className="discover-head">
                <h4>Discover strategies</h4>
                <span className="meta">3 live on devnet</span>
              </div>

              <div className="strategy-grid">
                {strategies.map((s) => (
                  <article key={s.name} className="strategy">
                    <svg className="spark" viewBox="0 0 70 22" preserveAspectRatio="none">
                      <path className="fill" d={s.fill} />
                      <path d={s.spark} />
                    </svg>
                    <div className="row1">
                      <span className="live-dot" />
                      <span className="live-tag">Live</span>
                      <span className="handle">{s.handle}</span>
                    </div>
                    <h5>{s.name}</h5>
                    <div className="stats">
                      <div>
                        <span className="stat-label">TVL</span>
                        <span className="stat-value">{s.tvl}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className="stat-label">Annual yield</span>
                        <span className="stat-value pos">{s.apy}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <p className="preview-caption">Performance is the only oracle.</p>
        </div>
      </section>

      <section className="final-cta">
        <div className="wrap">
          <h2 className="section">
            Join the Solana <em>waitlist.</em>
          </h2>
          <WaitlistForm variant="final" />
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="row-1">
            <a href="#" className="brand" aria-label="Bundie">
              <Image
                src="/assets/bundie-mark-white.png"
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
              <a href="https://x.com/bundie_fi" target="_blank" rel="noopener noreferrer">
                Twitter
              </a>
              <a href="https://github.com/bundie-fi" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              <a href="https://bundie.fi" target="_blank" rel="noopener noreferrer">
                bundie.fi
              </a>
              <a className="muted" aria-disabled="true">
                App (coming soon)
              </a>
            </div>
          </div>
          <div className="row-2">© 2026 Bundie. Built on Solana.</div>
        </div>
      </footer>
    </>
  );
}
