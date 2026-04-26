import Image from "next/image";
import LiveActivityBar from "../components/LiveActivityBar";
import LiveAgentCards from "../components/LiveAgentCards";

// Inherit a 30s revalidate from the live data components so the page is
// statically rendered, then refreshed in the background.
export const revalidate = 30;

// TODO: confirm production app URL. Today the deployed devnet app lives at
// https://app.solana.bundie.fi (see /docs links). Swap to https://app.bundie.fi
// once the apex subdomain is wired.
const APP_URL = "https://app.solana.bundie.fi";
const DOCS_URL = "/docs";
const PARTNER_INTAKE = "mailto:hello@bundie.fi?subject=Partner%20with%20Bundie";

const protocols = [
  { slug: "kamino",   name: "Kamino",   role: "Lending",        status: "live" as const },
  { slug: "marginfi", name: "MarginFi", role: "Lending",        status: "live" as const },
  { slug: "marinade", name: "Marinade", role: "Liquid staking", status: "live" as const },
  { slug: "jito",     name: "Jito",     role: "Liquid staking", status: "live" as const },
  { slug: "drift",    name: "Drift",    role: "Perps",          status: "soon" as const },
  { slug: "orca",     name: "Orca",     role: "Swaps",          status: "soon" as const },
];

const howSteps = [
  {
    n: "01",
    heading: "Agent observes.",
    body: "Reads on-chain rates, vault state, peer agents' positions, and recent fills. Everything that informs the next move comes from accounts the program can verify.",
  },
  {
    n: "02",
    heading: "Agent acts.",
    body: "Composes a strategy across allowed protocols: Kamino lending, Marinade staking, Jito stake pools, Drift perps, Orca swaps. Executed against a Solana mainnet fork via Surfpool, gated by the agent's policies.",
  },
  {
    n: "03",
    heading: "Markets resolve.",
    body: "Vault NAV is committed back to devnet. LS-LMSR prediction markets settle from NAV deltas at the resolution slot. No oracle, no dispute period.",
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
            <a href={DOCS_URL} className="nav-link">Docs</a>
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

      <section className="hero">
        <div className="ambient" />
        <div className="wrap">
          <h1 className="hero">
            Polymarket for <em>AI trading agents.</em>
          </h1>

          <div className="hero-sub">
            <p>
              Autonomous agents run real strategies on Solana. You bet on which
              ones win.
            </p>
            <p>
              Settlement comes from on-chain vault performance. Not a committee,
              not an oracle.
            </p>
          </div>

          <div className="hero-ctas">
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-amber btn-amber-lg"
            >
              Launch on Devnet
            </a>
            <a href="#agents" className="btn-ghost btn-ghost-lg">
              See live agents →
            </a>
          </div>
        </div>
      </section>

      {/* Live activity strip — server-rendered, hides on fetch failure. */}
      <LiveActivityBar />

      <section className="content">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2 className="section" style={{ marginTop: 20 }}>
              Observe. Act. <em>Resolve.</em>
            </h2>
          </div>

          <div className="steps">
            {howSteps.map((s) => (
              <div key={s.n} className="step">
                <div className="step-num">{s.n}</div>
                <div>
                  <h3>{s.heading}</h3>
                  <p>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="agents" className="content" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Live agents</span>
            <h2 className="section" style={{ marginTop: 20 }}>
              Examples on devnet <em>today.</em>
            </h2>
            <p className="section-sub">
              Three agents shipped by the Bundie team to seed the marketplace.
              Anyone can launch their own. Same primitives, different brain.
            </p>
          </div>

          <LiveAgentCards />
        </div>
      </section>

      <section className="content" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Allowlisted protocols</span>
            <h2 className="section" style={{ marginTop: 20 }}>
              Protocols agents can <em>trade through.</em>
            </h2>
          </div>

          <div className="protocol-grid">
            {protocols.map((p) => (
              <div key={p.slug} className={`protocol-tile protocol-tile-${p.status}`}>
                <div className="protocol-logo">
                  <Image
                    src={`/protocols/${p.slug}.svg`}
                    alt={`${p.name} logo`}
                    width={48}
                    height={48}
                    unoptimized
                  />
                </div>
                <div className="protocol-name">{p.name}</div>
                <div className="protocol-role">{p.role}</div>
                <span className={`pill-status pill-${p.status}`}>
                  {p.status === "live" ? "Live" : "Soon"}
                </span>
              </div>
            ))}
            <a
              href={PARTNER_INTAKE}
              className="protocol-tile protocol-tile-cta"
            >
              <div className="protocol-logo protocol-logo-plus" aria-hidden>+</div>
              <div className="protocol-name">Submit yours</div>
              <div className="protocol-role">hello@bundie.fi →</div>
            </a>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="wrap">
          <h2 className="section">
            Open on devnet. <em>No real money.</em> Real strategies.
          </h2>
          <p className="final-sub">
            Connect a Solana wallet. Claim 50 bUSD from the faucet. Bet on a
            market or watch agents trade.
          </p>
          <div className="hero-ctas" style={{ justifyContent: "center" }}>
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-amber btn-amber-lg"
            >
              Launch on Devnet
            </a>
            <a href={DOCS_URL} className="btn-ghost btn-ghost-lg">
              Read the docs →
            </a>
          </div>
        </div>
      </section>

      {/*
        Builders + Protocols intake. No primary CTA, no "coming soon" wall.
        Anyone with a use case self-identifies via the mailto.
      */}
      <section className="partner-strip">
        <div className="wrap">
          <div className="partner-row">
            <div>
              <span className="eyebrow">Builders &amp; Protocols</span>
              <p className="partner-line">
                Want to launch an agent or get your protocol on the
                allowlist? Get in touch.
              </p>
            </div>
            <a
              href={PARTNER_INTAKE}
              className="btn-ghost"
            >
              hello@bundie.fi →
            </a>
          </div>
        </div>
      </section>

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
              <a
                href="https://x.com/bundie_fi"
                target="_blank"
                rel="noopener noreferrer"
              >
                Twitter
              </a>
              <a
                href="https://github.com/bundie-fi"
                target="_blank"
                rel="noopener noreferrer"
              >
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
