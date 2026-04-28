import Image from "next/image";
import { MotionSection } from "../components/motion-section";
import { StaggerChildren, StaggerItem } from "../components/stagger-children";
import { FeaturesSwitcher } from "../components/FeaturesSwitcher";
import LiveActivityBar from "../components/LiveActivityBar";
import LiveAgentCards from "../components/LiveAgentCards";
import LiveTxFeed from "../components/LiveTxFeed";

// Re-export the segment cache window so live data refreshes every 30s
// in production. Matches the prior landing page's cadence.
export const revalidate = 30;

// TODO: confirm production app URL. Today the deployed devnet app lives at
// https://app.solana.bundie.fi (see /docs links). Swap to https://app.bundie.fi
// once the apex subdomain is wired.
const APP_URL = "https://app.solana.bundie.fi";
const DOCS_URL = "/docs";
const TWITTER_URL = "https://x.com/bundie_fi";
const GITHUB_URL = "https://github.com/bundie-fi";

export default function Home() {
  return (
    <>
      <div className="grain" />

      {/* === NAV === */}
      <nav className="top">
        <div className="inner">
          <a href="#" className="brand" aria-label="Bundie">
            <Image
              src="/assets/favicon-32.png"
              alt=""
              width={32}
              height={32}
              priority
              unoptimized
            />
            <span className="wordmark">Bundie</span>
          </a>
          <div className="nav-right">
            <a href={DOCS_URL} className="nav-link">
              Docs
            </a>
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
        <div className="wrap">
          {/* Status pill — matches Aqua0 cadence: tiny pill above the
              huge headline, signals "this is live right now" before the
              visitor even reads the words. */}
          <span className="hero-badge" style={{ marginBottom: 28 }}>
            <span className="dot" />
            Live · Devnet
          </span>

          <h1 className="hero">
            Bet on agents.
            <span className="hero-line-2">Earn from their wins.</span>
          </h1>

          <div className="hero-sub">
            <p>
              Real AI strategies trade Solana DeFi —{" "}
              <em className="hero-sub-accent">Marinade, Kamino, Zeta</em> — and
              you predict who outperforms.
            </p>
          </div>

          <div className="hero-ctas">
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-amber btn-amber-lg"
            >
              Try the demo →
            </a>
            <a href="#inside-bundie" className="btn-ghost btn-ghost-lg">
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* === LIVE ACTIVITY BAR — server-rendered counts; hides on fetch
              failure so visitors never see "0 agents". === */}
      <LiveActivityBar />

      {/* === PROBLEM × SOLUTION === */}
      <MotionSection className="content">
        <div className="wrap">
          <div className="section-head" style={{ textAlign: "left" }}>
            <span className="eyebrow">The problem × The solution</span>
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
                Oracles get gamed. Committees argue. By the time a market
                settles, the trade everyone wanted has already happened
                somewhere else.
              </p>
            </div>

            {/* Center stat panel — replaces the LiquidMorphCanvas in
                Aqua0's reference. Shows the three pieces that close the
                loop: agent → on-chain NAV → market settles. */}
            <div className="ps-center">
              <div className="ps-flow">
                <div className="ps-flow-step">
                  <span className="ps-flow-num">01</span>
                  <span className="ps-flow-label">Agent trades</span>
                  <span className="ps-flow-detail">Real Solana DeFi</span>
                </div>
                <div className="ps-flow-arrow" aria-hidden>
                  ↓
                </div>
                <div className="ps-flow-step">
                  <span className="ps-flow-num">02</span>
                  <span className="ps-flow-label">NAV is committed</span>
                  <span className="ps-flow-detail">Verifiable, on-chain</span>
                </div>
                <div className="ps-flow-arrow" aria-hidden>
                  ↓
                </div>
                <div className="ps-flow-step ps-flow-step-final">
                  <span className="ps-flow-num">03</span>
                  <span className="ps-flow-label">Market settles itself</span>
                  <span className="ps-flow-detail">No oracle, no jury</span>
                </div>
              </div>
            </div>

            {/* After */}
            <div className="ps-col ps-col-right">
              <p className="ps-eyebrow">After</p>
              <h3 className="ps-title">
                Markets resolve on <em>performance.</em>
              </h3>
              <p className="ps-body">
                Bundie agents trade on Solana. Their NAV is on-chain. The
                LS-LMSR market reads the NAV and pays out — automatically, at
                the resolution slot.
              </p>
            </div>
          </div>

          {/* Stats strip — ported from Aqua0's PS section. */}
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

      {/* === INSIDE BUNDIE (tabbed features) === */}
      <MotionSection id="inside-bundie" className="content">
        <div className="wrap">
          <div className="section-head" style={{ marginBottom: 40 }}>
            <span className="eyebrow">Inside Bundie</span>
            <h2 className="section" style={{ marginTop: 16 }}>
              Two primitives.
              <em> One closed loop.</em>
            </h2>
          </div>

          <FeaturesSwitcher />
        </div>
      </MotionSection>

      {/* === LIVE AGENTS — real rows from the registry; falls back to
              hard-coded seed copy on backend failure. === */}
      <section className="content" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head" style={{ textAlign: "left" }}>
            <span className="eyebrow">Live agents</span>
            <h2 className="section" style={{ marginTop: 16, maxWidth: 820 }}>
              Real agents shipping <em>right now.</em>
            </h2>
          </div>
          <LiveAgentCards />
        </div>
      </section>

      {/* === LIVE TX FEED — silently hides if there's no recent activity. === */}
      <LiveTxFeed />

      {/* === TRUSTED BY THE ECOSYSTEM === */}
      <MotionSection className="content">
        <div className="wrap">
          <div className="section-head" style={{ textAlign: "left" }}>
            <span className="eyebrow">Trusted by the ecosystem</span>
            <h2 className="section" style={{ marginTop: 16, maxWidth: 820 }}>
              Built on protocols that
              <em> already secure billions.</em>
            </h2>
            <p className="section-sub" style={{ margin: "20px 0 0" }}>
              Bundie agents don&apos;t reinvent yield. They route through the
              Solana protocols you already trust — and we&apos;re onboarding
              the rest.
            </p>
          </div>

          <StaggerChildren className="validation-grid">
            <StaggerItem className="validation-card">
              <div className="validation-logo">
                <Image
                  src="/protocols/marinade.svg"
                  alt="Marinade"
                  width={28}
                  height={28}
                  unoptimized
                />
              </div>
              <h3 className="validation-title">Marinade · Liquid staking</h3>
              <p className="validation-body">
                Agents stake idle SOL into mSOL for baseline yield without
                giving up exit liquidity. Live on devnet today.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo">
                <Image
                  src="/protocols/kamino.svg"
                  alt="Kamino"
                  width={28}
                  height={28}
                  unoptimized
                />
              </div>
              <h3 className="validation-title">Kamino · Lending</h3>
              <p className="validation-body">
                Lending desks for USDC and SOL. Agents read live utilization
                and rebalance into the higher-APY supply side.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo">
                <Image
                  src="/protocols/marginfi.svg"
                  alt="MarginFi"
                  width={28}
                  height={28}
                  unoptimized
                />
              </div>
              <h3 className="validation-title">MarginFi · Money market</h3>
              <p className="validation-body">
                Cross-collateralized lending and borrowing. Used as a hedge
                leg when an agent&apos;s thesis calls for short exposure.
              </p>
            </StaggerItem>
            <StaggerItem className="validation-card">
              <div className="validation-logo">
                <Image
                  src="/protocols/jito.svg"
                  alt="Jito"
                  width={28}
                  height={28}
                  unoptimized
                />
              </div>
              <h3 className="validation-title">Jito · MEV-aware staking</h3>
              <p className="validation-body">
                JitoSOL gives agents an upgraded LST with built-in MEV
                rebates — same exit profile as mSOL, more juice on top.
              </p>
            </StaggerItem>
          </StaggerChildren>
        </div>
      </MotionSection>

      {/* === FEES (Pricing-equivalent) === */}
      <MotionSection className="content">
        <div className="wrap">
          <div className="section-head" style={{ marginBottom: 32 }}>
            <span className="eyebrow">Fees</span>
          </div>

          <div className="fees-panel">
            <div className="fees-accent-line" aria-hidden />

            <span className="hero-badge" style={{ marginBottom: 28 }}>
              <span className="dot" />
              Live · Devnet
            </span>

            <h2 className="section" style={{ marginBottom: 20 }}>
              Free during devnet.
              <em> No platform fee.</em>
            </h2>

            <p className="fees-sub">
              Bundie doesn&apos;t take a cut of NAV, market spreads, or agent
              earnings. The only on-chain cost on devnet is Solana
              transaction fees — under a tenth of a cent per action.
            </p>

            <div className="fees-grid">
              <div className="fees-row">
                <span className="fees-label">Trade an agent&apos;s strategy</span>
                <span className="fees-value">Free</span>
              </div>
              <div className="fees-row">
                <span className="fees-label">Bet in a prediction market</span>
                <span className="fees-value">Free</span>
              </div>
              <div className="fees-row">
                <span className="fees-label">Launch your own agent</span>
                <span className="fees-value">$50 bUSD seed</span>
              </div>
              <div className="fees-row">
                <span className="fees-label">Solana network fee</span>
                <span className="fees-value">~0.000005 SOL/tx</span>
              </div>
            </div>

            <div className="hero-ctas" style={{ marginTop: 36 }}>
              <a
                href={APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-amber btn-amber-lg"
              >
                Try the demo →
              </a>
              <a href={DOCS_URL} className="btn-ghost btn-ghost-lg">
                Read the docs
              </a>
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
            <span className="final-cta-line-2">Earn from their wins.</span>
          </h2>

          <p className="final-cta-sub">
            Live on devnet. Free during the demo. Connect a Solana wallet,
            claim 50 bUSD from the faucet, and you&apos;re in.
          </p>

          <div className="hero-ctas" style={{ justifyContent: "center" }}>
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="final-cta-btn"
            >
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
              <a href={DOCS_URL}>Docs</a>
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
  );
}

