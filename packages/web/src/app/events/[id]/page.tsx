import Link from "next/link";
import { notFound } from "next/navigation";
import {
  formatDepth,
  formatPrice,
  getEventDetail,
  getEventPrice,
  resolverClassLabel,
  type EventDetail,
  type EventPrice,
} from "@/lib/events";

export const dynamic = "force-dynamic";
export const revalidate = 5;

interface EventPageProps {
  params: Promise<{ id: string }>;
}

export default async function EventPage(props: EventPageProps) {
  const { id } = await props.params;
  const eventId = decodeURIComponent(id);

  let price: EventPrice | null = null;
  let detail: EventDetail | null = null;

  try {
    [price, detail] = await Promise.all([
      getEventPrice(eventId),
      getEventDetail(eventId),
    ]);
  } catch {
    notFound();
  }

  if (!price || !detail) notFound();

  const yesPct = formatPrice(price.price);
  const noPct = formatPrice(1 - price.price);
  const lowConfidence = price.confidence < 0.3;

  return (
    <main className="min-h-screen bg-[var(--de-bg)] text-[var(--de-ink)]">
      <nav className="border-b border-[var(--de-line)] px-6 py-4 sm:px-12">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link
            href="/events"
            className="text-xs uppercase tracking-[0.18em] text-[var(--de-ink-3)] hover:text-[var(--de-ink)]"
          >
            ← All events
          </Link>
          <span className="font-mono text-[10px] text-[var(--de-ink-4)]">
            {eventId}
          </span>
        </div>
      </nav>

      <section className="px-6 py-10 sm:px-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-[var(--de-lavender-tint)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--de-lavender)]">
              {resolverClassLabel(price.resolver_class)}
            </span>
            {lowConfidence ? (
              <span className="rounded-full border border-[var(--de-line-3)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
                Low confidence
              </span>
            ) : null}
          </div>
          <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
            {price.description}
          </h1>
          <p className="mt-3 text-sm text-[var(--de-ink-3)]">
            Resolves by{" "}
            {new Date(price.window_end).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--de-line)] px-6 py-8 sm:px-12">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2">
          <OutcomeCard label="YES" value={yesPct} accent="mint" highlighted />
          <OutcomeCard label="NO" value={noPct} accent="lavender" />
        </div>
      </section>

      <section className="border-t border-[var(--de-line)] px-6 py-8 sm:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
            Market data
          </h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Depth" value={formatDepth(price.depth_usd)} />
            <Stat
              label="Confidence"
              value={`${(price.confidence * 100).toFixed(0)}%`}
            />
            <Stat label="24h trades" value={price.trade_count_24h.toString()} />
            <Stat
              label="24h traders"
              value={price.unique_traders_24h.toString()}
            />
            <Stat label="TWAP 24h" value={formatPrice(price.twap_24h)} />
            <Stat
              label="24h change"
              value={`${(price.last_change_24h * 100).toFixed(2)}%`}
            />
            <Stat
              label="Spot vs TWAP"
              value={`${(price.spot_vs_twap_pct * 100).toFixed(2)}%`}
            />
            <Stat
              label="Resolver wins"
              value={`${price.resolver_track_record.total - price.resolver_track_record.lost}/${price.resolver_track_record.total || "—"}`}
            />
          </dl>
        </div>
      </section>

      <section className="border-t border-[var(--de-line)] px-6 py-8 sm:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
            How it resolves
          </h2>
          <p className="text-sm text-[var(--de-ink-2)]">
            <span className="text-[var(--de-mint)]">YES</span> if:{" "}
            {detail.outcome_yes.replaceAll("_", " ")}.
          </p>
          <p className="mt-1 text-sm text-[var(--de-ink-2)]">
            <span className="text-[var(--de-ink)]">NO</span> if:{" "}
            {detail.outcome_no.replaceAll("_", " ")}.
          </p>
          {detail.notes ? (
            <p className="mt-3 text-xs text-[var(--de-ink-3)]">
              <span className="uppercase tracking-wider">Notes:</span>{" "}
              {detail.notes}
            </p>
          ) : null}
        </div>
      </section>

      <section className="border-t border-[var(--de-line)] px-6 py-8 sm:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
            Query this price programmatically
          </h2>
          <pre className="overflow-x-auto rounded-xl border border-[var(--de-line-2)] bg-[var(--de-bg-3)] p-4 font-mono text-xs leading-relaxed text-[var(--de-ink-2)]">
            <code>
              {`curl https://api.bundie.fi/v1/event-price?id=${eventId} \\\n  -H "X-PAYMENT: <x402-signed-tx-for-0.001-USDC>"`}
            </code>
          </pre>
          <p className="mt-3 text-xs text-[var(--de-ink-3)]">
            $0.001 USDC per query via x402. No accounts, no keys.
          </p>
        </div>
      </section>

      <footer className="px-6 py-10 text-center text-xs text-[var(--de-ink-3)] sm:px-12">
        Snapshot as of{" "}
        {new Date(price.as_of).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </footer>
    </main>
  );
}

function OutcomeCard({
  label,
  value,
  accent,
  highlighted,
}: {
  label: string;
  value: string;
  accent: "mint" | "lavender";
  highlighted?: boolean;
}) {
  const color = accent === "mint" ? "var(--de-mint)" : "var(--de-lavender)";
  return (
    <div
      className={`rounded-2xl border bg-[var(--de-bg-raised)] p-8 ${
        highlighted
          ? "border-[var(--de-line-3)]"
          : "border-[var(--de-line-2)]"
      }`}
    >
      <div className="mb-2 text-xs uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
        {label}
      </div>
      <div
        className="font-mono text-5xl tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
      <p className="mt-3 text-xs text-[var(--de-ink-4)]">
        Buy {label} shares (devnet beta — trading UI lands next)
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-lg tabular-nums text-[var(--de-ink)]">
        {value}
      </dd>
    </div>
  );
}
