import Link from "next/link";
import {
  formatDepth,
  formatPrice,
  listEvents,
  marketKindLabel,
  type EventSummary,
} from "@/lib/events";

// 30s ISR cache: events list changes only when admins add/remove markets,
// so blocking on backend every request just burns LCP. Tag-based
// revalidation lets the backend invalidate via `revalidateTag("events")`
// after a market is created on-chain.
export const revalidate = 30;

export const metadata = {
  title: "Events · Bundie",
  description:
    "Bundie is an oracle that agents read to price the future. Trade YES or NO on every measurable event — depegs, outages, TVL drops. Read live consensus over x402.",
};

export default async function EventsPage() {
  let events: EventSummary[] = [];
  let error: string | null = null;

  try {
    events = await listEvents();
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <main className="min-h-screen bg-[var(--de-bg)] text-[var(--de-ink)]">
      <Hero />

      <section className="px-6 pb-14 sm:px-12">
        <div className="mx-auto max-w-6xl">
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

      <Footer />
    </main>
  );
}

function Hero() {
  return (
    <header
      className="relative overflow-hidden border-b border-[var(--de-line)] px-6 pb-14 pt-16 sm:px-12 sm:pt-24"
      style={{
        background:
          "radial-gradient(60% 40% at 50% 0%, var(--de-lavender-glow), transparent)",
      }}
    >
      <div className="relative mx-auto max-w-6xl">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
          Bundie / Event oracle / x402 API
        </p>
        <h1 className="max-w-3xl font-serif text-4xl leading-[1.05] tracking-tight sm:text-6xl">
          The oracle agents read
          <span className="text-[var(--de-lavender)]"> to price the future</span>.
        </h1>
        <p className="mt-5 max-w-xl text-base text-[var(--de-ink-2)]">
          Existing oracles price the present — BTC right now, ETH right now.
          Bundie prices what&rsquo;s about to happen. Depegs, outages, TVL drops:
          every measurable event has a market price you can read over x402 for{" "}
          <span className="font-mono text-[var(--de-ink)]">$0.001</span> a call.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          <span>
            <span className="mr-2 inline-block size-1.5 rounded-full bg-[var(--de-mint)] align-middle" />
            Devnet beta · Solana
          </span>
          <Link
            href="#agents"
            className="text-[var(--de-lavender)] transition-colors duration-150 ease-out hover:text-[var(--de-lavender-2)] focus-visible:outline-none focus-visible:underline"
          >
            Agents → API docs
          </Link>
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
        {error ? "—" : `${count} ${count === 1 ? "market" : "markets"}`}
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
      href={`/events/${encodeURIComponent(event.event_id)}`}
      className="group block rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6 transition-[transform,background-color,border-color] duration-150 ease-out hover:-translate-y-px hover:border-[var(--de-line-3)] hover:bg-[var(--de-bg-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--de-lavender)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--de-bg)]"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          {humanKind(event.market_kind, event.resolver_class)}
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

function Footer() {
  return (
    <footer
      id="agents"
      className="border-t border-[var(--de-line)] px-6 py-10 sm:px-12"
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
              Building an agent?
            </p>
            <p className="font-serif text-xl tracking-tight text-[var(--de-ink)]">
              Read live market prices over x402 for{" "}
              <span className="text-[var(--de-lavender)]">$0.001</span> a call.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--de-line-2)] bg-[var(--de-bg-3)] p-3 font-mono text-[11px] leading-relaxed text-[var(--de-ink-2)]">
            <span className="text-[var(--de-ink-3)]">GET</span>{" "}
            /v1/event-price?id=&lt;id&gt;
          </div>
        </div>
        <div className="mt-8 flex items-center justify-between border-t border-[var(--de-line)] pt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-4)]">
          <span>Devnet beta · cluster: solana:devnet</span>
          <Link
            href="/"
            className="hover:text-[var(--de-ink)] focus-visible:outline-none focus-visible:underline"
          >
            ← home
          </Link>
        </div>
      </div>
    </footer>
  );
}
