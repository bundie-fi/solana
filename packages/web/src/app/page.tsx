import Link from "next/link";

// 30s ISR. The home page is currently a minimal hero pointing at the live
// markets surface. The full home (live markets band + agent panel +
// category groups) lands in PR-2 of the oracle-positioning overhaul; this
// stub exists so the app stops contradicting itself the moment PR-1 ships.
// See packages/web/DESIGN.md for the cream/serif visual system.
export const revalidate = 30;

export const metadata = {
  title: "Bundie — The oracle agents read to price the future",
  description:
    "Bundie is an oracle that agents read to price the future. Existing oracles price the present; Bundie prices what's about to happen — depegs, outages, TVL drops. Settled on-chain. Read over x402 for $0.001 a call.",
};

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--de-bg)] text-[var(--de-ink)]">
      <Hero />
      <Footer />
    </main>
  );
}

function Hero() {
  return (
    <section
      className="relative overflow-hidden border-b border-[var(--de-line)] px-6 pb-24 pt-20 sm:px-12 sm:pt-32"
      style={{
        background:
          "radial-gradient(60% 40% at 50% 0%, var(--de-lavender-glow), transparent)",
      }}
    >
      <div className="relative mx-auto max-w-5xl">
        <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
          Bundie / Event oracle / x402 API
        </p>

        <h1 className="max-w-4xl font-serif text-5xl leading-[1.02] tracking-tight sm:text-7xl">
          The oracle agents read
          <span className="text-[var(--de-lavender)]"> to price the future</span>.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-snug text-[var(--de-ink-2)]">
          Existing oracles price the present — BTC right now, ETH right now.
          Bundie prices what&rsquo;s about to happen: depegs, outages, TVL
          drops. Every measurable event has a live consensus price, settled
          on-chain.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/markets"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--de-ink)] px-6 py-3 text-sm font-medium text-[var(--de-bg)] transition-transform duration-150 ease-out hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--de-lavender)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--de-bg)]"
          >
            Browse markets
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            href="/markets#agents"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--de-line-3)] px-6 py-3 text-sm font-medium text-[var(--de-ink)] transition-colors duration-150 ease-out hover:border-[var(--de-ink)] focus-visible:outline-none focus-visible:underline"
          >
            Read consensus
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          <span className="inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-[var(--de-mint)]" />
            Devnet beta · Solana
          </span>
          <span>x402 reads · $0.001 / call</span>
          <span>ed25519 attested</span>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--de-line)] px-6 py-10 sm:px-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="font-serif text-xl tracking-tight text-[var(--de-ink)]">
          Built for AI agents.{" "}
          <span className="italic text-[var(--de-lavender)]">
            Priced by traders.
          </span>{" "}
          Settled by the chain.
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          <Link
            href="/markets"
            className="transition-colors duration-150 ease-out hover:text-[var(--de-ink)]"
          >
            Markets
          </Link>
          <Link
            href="/portfolio"
            className="transition-colors duration-150 ease-out hover:text-[var(--de-ink)]"
          >
            Portfolio
          </Link>
          <span>Cluster: solana:devnet</span>
        </div>
      </div>
    </footer>
  );
}
