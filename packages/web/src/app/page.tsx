import Link from "next/link";
import {
  listEvents,
  formatPrice,
  formatDepth,
  type EventSummary,
} from "@/lib/events";
import {
  formatPriceUsd,
  READ_PRICE_FLOOR_USDC_MICRO,
} from "@/lib/pricing";

// 30s ISR. Five-band editorial home page:
//   1. Hero, oracle one-liner, two CTAs, devnet chips
//   2. Live consensus strip, 4-up of the highest-depth active markets
//   3. By domain, category cards grouped by resolver_class
//   4. Agent panel, curl + JSON response example + dynamic-pricing note
//   5. Footer, brand line + nav links
//
// All cards reuse the same cream/serif system as /markets so the surfaces
// feel like one publication. See packages/web/DESIGN.md for the rationale.
export const revalidate = 30;

export const metadata = {
  title: "Bundie, The oracle agents read to price the future",
  description:
    "Bundie is an oracle that agents read to price the future. Existing oracles price the present; Bundie prices what's about to happen, depegs, outages, TVL drops. Settled on-chain. Read over x402, priced dynamically by market depth.",
};

export default async function Home() {
  let events: EventSummary[] = [];
  let fetchError = false;
  try {
    events = await listEvents();
  } catch {
    fetchError = true;
  }

  const active = events.filter((e) => e.status === "active");
  const byDepth = [...active].sort((a, b) => b.depth_usd - a.depth_usd);

  return (
    <main className="min-h-screen bg-[var(--de-bg)] text-[var(--de-ink)]">
      <Hero />
      <ConsensusStrip markets={byDepth.slice(0, 4)} error={fetchError} />
      <ByDomain markets={active} />
      <Footer />
    </main>
  );
}

function Hero() {
  return (
    <section
      className="relative overflow-hidden border-b border-[var(--de-line)] px-6 pb-20 pt-20 sm:px-12 sm:pt-32"
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
          Existing oracles price the present, BTC right now, ETH right now.
          Bundie prices what&rsquo;s about to happen: depegs, outages, TVL
          drops. Every measurable event has a live consensus price, settled
          on-chain.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/markets"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--de-ink)] px-6 py-3 text-sm font-medium text-[var(--de-bg)] transition-transform duration-150 ease-out hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--de-lavender)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--de-bg)]"
          >
            Trade markets
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            href="/portfolio"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--de-line-3)] px-6 py-3 text-sm font-medium text-[var(--de-ink)] transition-colors duration-150 ease-out hover:border-[var(--de-ink)] focus-visible:outline-none focus-visible:underline"
          >
            My positions
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          <span className="inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-[var(--de-mint)]" />
            Devnet beta · Solana
          </span>
          <span>
            x402 · from {formatPriceUsd(READ_PRICE_FLOOR_USDC_MICRO)} / call
          </span>
          <span>ed25519 attested</span>
        </div>
      </div>
    </section>
  );
}

function ConsensusStrip({
  markets,
  error,
}: {
  markets: EventSummary[];
  error: boolean;
}) {
  return (
    <section className="border-b border-[var(--de-line)] px-6 py-14 sm:px-12">
      <div className="mx-auto max-w-6xl">
        <SectionEyebrow
          title="Live consensus"
          accent="what the chain thinks happens next"
        />
        {error ? (
          <ErrorState />
        ) : markets.length === 0 ? (
          <EmptyState
            title="No active markets yet."
            sub="Devnet bootstrap landing shortly."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {markets.map((m) => (
              <ConsensusCard key={m.event_id} event={m} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ConsensusCard({ event }: { event: EventSummary }) {
  return (
    <Link
      href={`/markets/${encodeURIComponent(event.event_id)}`}
      className="group block rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-5 transition-[transform,background-color,border-color] duration-150 ease-out hover:-translate-y-px hover:border-[var(--de-line-3)] hover:bg-[var(--de-bg-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--de-lavender)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--de-bg)]"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          {domainLabel(event.resolver_class)}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-mint)]">
          <span className="relative inline-flex size-1.5 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--de-mint)] opacity-60" />
            <span className="relative inline-block size-1.5 rounded-full bg-[var(--de-mint)]" />
          </span>
          Live
        </span>
      </div>
      <p className="mb-5 line-clamp-2 text-[14px] leading-snug text-[var(--de-ink)]">
        {event.description}
      </p>
      <div className="flex items-end justify-between gap-3 border-t border-[var(--de-line)] pt-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
            YES
          </p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-[var(--de-mint)]">
            {formatPrice(event.price)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
            Depth
          </p>
          <p className="mt-1 font-mono text-sm tabular-nums text-[var(--de-ink-2)]">
            {formatDepth(event.depth_usd)}
          </p>
        </div>
      </div>
    </Link>
  );
}

function ByDomain({ markets }: { markets: EventSummary[] }) {
  const groups = groupByDomain(markets);
  const order: DomainKey[] = ["stablecoin", "tvl", "cloud", "incident", "other"];
  const visible = order.filter((k) => (groups[k]?.length ?? 0) > 0);

  return (
    <section className="border-b border-[var(--de-line)] px-6 py-14 sm:px-12">
      <div className="mx-auto max-w-6xl">
        <SectionEyebrow title="By domain" accent="every measurable event" />
        {visible.length === 0 ? (
          <EmptyState
            title="No active categories."
            sub="Markets are bootstrapping."
          />
        ) : (
          <div className="grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2">
            {visible.map((k) => (
              <DomainGroup
                key={k}
                title={DOMAIN_TITLES[k]}
                blurb={DOMAIN_BLURBS[k]}
                markets={groups[k]!}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DomainGroup({
  title,
  blurb,
  markets,
}: {
  title: string;
  blurb: string;
  markets: EventSummary[];
}) {
  return (
    <div>
      <p className="mb-1 font-serif text-2xl tracking-tight text-[var(--de-ink)]">
        {title}
      </p>
      <p className="mb-5 text-sm text-[var(--de-ink-3)]">{blurb}</p>
      <ul className="divide-y divide-[var(--de-line)] border-t border-[var(--de-line)]">
        {markets.slice(0, 3).map((m) => (
          <li key={m.event_id}>
            <Link
              href={`/markets/${encodeURIComponent(m.event_id)}`}
              className="group flex items-center justify-between gap-4 py-3 transition-colors duration-150 ease-out hover:bg-[var(--de-bg-2)]"
            >
              <span className="line-clamp-1 text-[14px] text-[var(--de-ink)]">
                {m.description}
              </span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-[var(--de-mint)]">
                {formatPrice(m.price)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer() {
  return (
    <footer className="px-6 py-12 sm:px-12">
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
          <a
            href="https://solana.bundie.fi/#for-agents"
            className="transition-colors duration-150 ease-out hover:text-[var(--de-ink)]"
          >
            For agents ↗
          </a>
          <span>Cluster: solana:devnet</span>
        </div>
      </div>
    </footer>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────

function SectionEyebrow({
  title,
  accent,
}: {
  title: string;
  accent: string;
}) {
  return (
    <div className="mb-8 border-b border-[var(--de-line)] pb-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
        {title}
      </p>
      <p className="mt-2 font-serif text-xl italic tracking-tight text-[var(--de-ink)]">
        {accent}
      </p>
    </div>
  );
}

function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-10 text-center">
      <p className="font-serif text-xl text-[var(--de-ink)]">{title}</p>
      <p className="mt-2 text-sm text-[var(--de-ink-2)]">{sub}</p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-rose)]">
        Backend unreachable
      </p>
      <p className="mt-3 text-base text-[var(--de-ink)]">
        We couldn&rsquo;t fetch the live market list.
      </p>
      <p className="mt-2 text-sm text-[var(--de-ink-2)]">
        Backend may still be starting. Try again in a few seconds.
      </p>
    </div>
  );
}

// Domain grouping: map resolver_class strings to a small set of product
// categories. Anything we don't recognise lands in 'other'.
type DomainKey = "stablecoin" | "tvl" | "cloud" | "incident" | "other";

const DOMAIN_TITLES: Record<DomainKey, string> = {
  stablecoin: "Stablecoin price",
  tvl: "Protocol TVL",
  cloud: "Cloud uptime",
  incident: "Network incidents",
  other: "Other",
};

const DOMAIN_BLURBS: Record<DomainKey, string> = {
  stablecoin: "Will a stablecoin lose its peg, and for how long?",
  tvl: "TVL drops past a threshold, fast withdrawals, depositor exits.",
  cloud: "API and service outages on AWS, Anthropic, OpenAI, Cloudflare.",
  incident: "Region-level outages and validator-level events.",
  other: "Markets that don't fit a single category yet.",
};

function domainFor(resolverClass: string): DomainKey {
  if (resolverClass.startsWith("pyth_threshold")) return "stablecoin";
  if (resolverClass.startsWith("onchain_tvl")) return "tvl";
  if (resolverClass.startsWith("statuspage")) return "cloud";
  if (resolverClass.startsWith("aws_health")) return "incident";
  return "other";
}

function domainLabel(resolverClass: string): string {
  return DOMAIN_TITLES[domainFor(resolverClass)];
}

function groupByDomain(
  events: EventSummary[],
): Partial<Record<DomainKey, EventSummary[]>> {
  const out: Partial<Record<DomainKey, EventSummary[]>> = {};
  for (const e of events) {
    const k = domainFor(e.resolver_class);
    (out[k] ||= []).push(e);
  }
  return out;
}
