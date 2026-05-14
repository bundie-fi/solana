import Link from "next/link";
import {
  formatDepth,
  formatPrice,
  listEvents,
  marketKindLabel,
  resolverClassLabel,
  type EventSummary,
} from "@/lib/events";

export const dynamic = "force-dynamic";
export const revalidate = 30;

export const metadata = {
  title: "Events · Bundie",
  description:
    "Trade outcomes. A marketplace where retail trades event prices and AI agents pay to read them.",
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
      <header className="border-b border-[var(--de-line)] px-6 py-12 sm:px-12">
        <div className="mx-auto max-w-6xl">
          <p className="mb-3 text-xs uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
            Bundie · Event Markets
          </p>
          <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">
            Trade outcomes. <span className="text-[var(--de-lavender)]">AI agents pay to read the prices.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-[var(--de-ink-2)]">
            Every measurable event has a market on Bundie. Retail traders price
            the probability; AI agents query the live consensus via x402
            micropayments. Solana settlement.
          </p>
        </div>
      </header>

      <section className="px-6 py-10 sm:px-12">
        <div className="mx-auto max-w-6xl">
          {error ? (
            <ErrorState message={error} />
          ) : events.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((e) => (
                <EventCard key={e.event_id} event={e} />
              ))}
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-[var(--de-line)] px-6 py-8 text-xs text-[var(--de-ink-3)] sm:px-12">
        <div className="mx-auto max-w-6xl flex flex-col gap-2 sm:flex-row sm:justify-between">
          <span>Devnet beta. Real USDC live on mainnet beta soon.</span>
          <Link href="/" className="hover:text-[var(--de-ink)]">
            ← back home
          </Link>
        </div>
      </footer>
    </main>
  );
}

function EventCard({ event }: { event: EventSummary }) {
  const yesPct = formatPrice(event.price);
  const noPct = formatPrice(1 - event.price);
  return (
    <Link
      href={`/events/${encodeURIComponent(event.event_id)}`}
      className="group block rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6 transition hover:border-[var(--de-line-3)] hover:bg-[var(--de-bg-2)]"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-full bg-[var(--de-lavender-tint)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--de-lavender)]">
          {marketKindLabel(event.market_kind)}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-[var(--de-ink-4)]">
          {resolverClassLabel(event.resolver_class)}
        </span>
      </div>

      <p className="mb-6 text-sm leading-relaxed text-[var(--de-ink)] group-hover:text-white">
        {event.description}
      </p>

      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
            YES
          </div>
          <div className="font-mono text-2xl tabular-nums text-[var(--de-mint)]">
            {yesPct}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
            NO
          </div>
          <div className="font-mono text-lg tabular-nums text-[var(--de-ink-2)]">
            {noPct}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-[var(--de-line)] pt-3 text-[11px] text-[var(--de-ink-3)]">
        <span>Depth {formatDepth(event.depth_usd)}</span>
        <span className="capitalize">{event.status}</span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-12 text-center">
      <p className="font-serif text-2xl text-[var(--de-ink)]">No events yet.</p>
      <p className="mt-2 text-sm text-[var(--de-ink-2)]">
        Markets are being deployed to devnet now. Refresh in a minute.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-8">
      <p className="font-medium text-[var(--de-ink)]">Couldn’t load events.</p>
      <p className="mt-1 font-mono text-xs text-[var(--de-ink-3)]">{message}</p>
      <p className="mt-3 text-sm text-[var(--de-ink-2)]">
        Backend may still be starting up. Try again in a few seconds.
      </p>
    </div>
  );
}
