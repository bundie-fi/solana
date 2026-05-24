import Link from "next/link";
import {
  formatDepth,
  formatPrice,
  listEvents,
  marketKindLabel,
  isOnchainResolved,
  compareOnchainFirst,
  type EventSummary,
} from "@/lib/events";
import { BettorFaucetCTA } from "@/components/BettorFaucetCTA";

// 30s ISR cache: events list changes only when admins add/remove markets,
// so blocking on backend every request just burns LCP. Tag-based
// revalidation lets the backend invalidate via `revalidateTag("events")`
// after a market is created on-chain.
export const revalidate = 30;

export const metadata = {
  title: "Markets · Bundie",
  description:
    "Bet YES or NO on every measurable event: depegs, outages, TVL drops, network incidents. Self-settling on Solana. Your payout lands the moment the event resolves.",
};

export default async function EventsPage() {
  let events: EventSummary[] = [];
  let error: string | null = null;

  try {
    events = await listEvents();
  } catch (err) {
    error = (err as Error).message;
  }

  // Surface the on-chain-resolved markets first (the "settles on-chain" moat),
  // then keep a live-before-scheduled order within each group. Off-chain
  // markets remain listed, just demoted. Data-driven off resolver_class.
  events = [...events].sort(
    (a, b) =>
      compareOnchainFirst(a, b) ||
      Number(b.status === "active") - Number(a.status === "active"),
  );

  return (
    <main className="min-h-screen bg-[var(--de-bg)] text-[var(--de-ink)]">
      <Hero />

      <section className="px-6 pb-10 sm:px-12">
        <div className="mx-auto max-w-6xl">
          <BettorFaucetCTA />

          <SectionEyebrow
            title="Live markets"
            count={events.length}
            error={!!error}
          />

          {error ? (
            <ErrorState message={error} />
          ) : events.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((e) => (
                <EventCard key={e.event_id} event={e} />
              ))}
            </div>
          )}
        </div>
      </section>

      <QuickRules />
    </main>
  );
}

function Hero() {
  return (
    <header
      className="relative overflow-hidden border-b border-[var(--de-line)] px-6 pb-12 pt-16 sm:px-12 sm:pt-20"
      style={{
        background:
          "radial-gradient(60% 40% at 50% 0%, var(--de-lavender-glow), transparent)",
      }}
    >
      <div className="relative mx-auto max-w-6xl">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
          Bundie · Live event markets
        </p>
        <h1 className="max-w-3xl font-serif text-4xl leading-[1.05] tracking-tight sm:text-6xl">
          You saw it coming.
          <span className="text-[var(--de-lavender)]"> Now get paid for it</span>.
        </h1>
        <p className="mt-5 max-w-xl text-base text-[var(--de-ink-2)]">
          Bet YES or NO on every measurable event. Depegs, outages, TVL drops,
          network incidents. Self-settling on Solana: your payout lands the
          moment the trigger condition fires.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          <span>
            <span className="mr-2 inline-block size-1.5 rounded-full bg-[var(--de-mint)] align-middle" />
            Devnet beta · Solana
          </span>
          <span>LS-LMSR · no spread</span>
          <span>Settled on-chain</span>
        </div>
      </div>
    </header>
  );
}

function SectionEyebrow({
  title,
  count,
  error,
}: {
  title: string;
  count: number;
  error: boolean;
}) {
  return (
    <div className="mb-6 mt-12 flex items-baseline justify-between border-b border-[var(--de-line)] pb-4">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
        {title}
      </h2>
      <span className="font-mono text-[11px] tabular-nums text-[var(--de-ink-3)]">
        {error ? "," : `${count} ${count === 1 ? "market" : "markets"}`}
      </span>
    </div>
  );
}

function EventCard({ event }: { event: EventSummary }) {
  const yesPct = formatPrice(event.price);
  const noPct = formatPrice(1 - event.price);
  const isLive = event.status === "active";
  return (
    <Link
      href={`/markets/${encodeURIComponent(event.event_id)}`}
      className="group block rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6 transition-[transform,background-color,border-color] duration-150 ease-out hover:-translate-y-px hover:border-[var(--de-line-3)] hover:bg-[var(--de-bg-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--de-lavender)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--de-bg)]"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          {humanKind(event.market_kind, event.resolver_class)}
          {isOnchainResolved(event.resolver_class) && <OnchainBadge />}
        </span>
        <StatusPill live={isLive} />
      </div>

      <p className="mb-6 text-[15px] leading-snug text-[var(--de-ink)]">
        {event.description}
      </p>

      <div className="flex items-end justify-between gap-3 border-t border-[var(--de-line)] pt-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
            YES
          </p>
          <p className="mt-1 font-mono text-3xl tabular-nums text-[var(--de-mint)]">
            {yesPct}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
            Depth
          </p>
          <p className="mt-1 font-mono text-sm tabular-nums text-[var(--de-ink-2)]">
            {formatDepth(event.depth_usd)}
          </p>
          <p className="mt-0.5 font-mono text-[10px] tabular-nums text-[var(--de-ink-4)]">
            NO {noPct}
          </p>
        </div>
      </div>
    </Link>
  );
}

// Settlement badge for markets that resolve by reading Solana state directly
// (no off-chain webhook, no committee). Data-driven via isOnchainResolved().
function OnchainBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--de-mint)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--de-mint)]"
      title="Settles by reading Solana state, no oracle, no committee."
    >
      <span aria-hidden="true">⛓</span>
      On-chain
    </span>
  );
}

function StatusPill({ live }: { live: boolean }) {
  if (live) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-mint)]">
        <span className="relative inline-flex size-1.5 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--de-mint)] opacity-60" />
          <span className="relative inline-block size-1.5 rounded-full bg-[var(--de-mint)]" />
        </span>
        Live
      </span>
    );
  }
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-4)]">
      Scheduled
    </span>
  );
}

function humanKind(kind: number, resolverClass: string): string {
  // Re-label the on-chain taxonomy in product language.
  if (resolverClass.startsWith("pyth_threshold")) return "Stablecoin · price";
  if (resolverClass.startsWith("onchain_tvl")) return "Protocol TVL";
  if (resolverClass.startsWith("statuspage")) return "Service uptime";
  if (resolverClass.startsWith("aws_health")) return "Cloud incident";
  return marketKindLabel(kind as 7 | 8 | 9);
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-12 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
        Pre-launch
      </p>
      <p className="mt-3 font-serif text-2xl text-[var(--de-ink)]">
        No markets yet.
      </p>
      <p className="mt-2 text-sm text-[var(--de-ink-2)]">
        Devnet bootstrap landing shortly. Refresh in a minute.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-rose)]">
        Backend unreachable
      </p>
      <p className="mt-3 text-base text-[var(--de-ink)]">
        We couldn’t fetch the live market list.
      </p>
      <p className="mt-1 font-mono text-xs text-[var(--de-ink-3)]">{message}</p>
      <p className="mt-3 text-sm text-[var(--de-ink-2)]">
        Backend may still be starting. Try again in a few seconds.
      </p>
    </div>
  );
}

function QuickRules() {
  return (
    <section
      className="border-t border-[var(--de-line)] px-6 py-12 sm:px-12"
    >
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-6 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
          Quick rules
        </h2>
        <dl className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-3">
          <Rule q="How do I bet?">
            Connect a Solana wallet, claim 100 bUSD from the faucet above, then
            tap YES or NO on any market. The LS-LMSR pool prices you instantly
            with no spread.
          </Rule>
          <Rule q="Who creates the markets?">
            Bundie seeds today&rsquo;s set, but anyone can propose a new one. If
            it has a verifiable on-chain or public-data trigger we deploy it
            within 24-48 hours.{" "}
            <Link
              href="/launch"
              className="text-[var(--de-lavender)] underline-offset-2 hover:underline"
            >
              Suggest a market →
            </Link>
          </Rule>
          <Rule q="How do payouts work?">
            Every market settles itself from a signed on-chain feed (Pyth,
            Statuspage, AWS Health, on-chain TVL). The moment the trigger fires
            your winning shares redeem 1:1 for bUSD. No committee, no manual
            settlement.
          </Rule>
        </dl>
      </div>
    </section>
  );
}

function Rule({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-2 font-serif text-lg tracking-tight text-[var(--de-ink)]">
        {q}
      </dt>
      <dd className="text-sm leading-relaxed text-[var(--de-ink-2)]">
        {children}
      </dd>
    </div>
  );
}

