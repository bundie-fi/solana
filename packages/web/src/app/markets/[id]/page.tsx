import Link from "next/link";
import { notFound } from "next/navigation";
import {
  formatDepth,
  formatPrice,
  getEventDetail,
  getEventPrice,
  type EventDetail,
  type EventPrice,
} from "@/lib/events";
import { TradeButtons } from "./TradeButtons";
import { PositionDisplay } from "./PositionDisplay";
import { AgentPanel } from "./AgentPanel";

export const dynamic = "force-dynamic";
export const revalidate = 5;

interface EventPageProps {
  params: Promise<{ id: string }>;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://backend.solana.bundie.fi";

async function getAttestationKey(): Promise<string | undefined> {
  try {
    const res = await fetch(`${BACKEND_URL}/v1/attestation-key`, {
      next: { revalidate: 600, tags: ["attestation-key"] },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { public_key_base58?: string };
    return body.public_key_base58;
  } catch {
    return undefined;
  }
}

export default async function EventPage(props: EventPageProps) {
  const { id } = await props.params;
  const eventId = decodeURIComponent(id);

  let price: EventPrice | null = null;
  let detail: EventDetail | null = null;
  let attestationKey: string | undefined;

  try {
    [price, detail, attestationKey] = await Promise.all([
      getEventPrice(eventId),
      getEventDetail(eventId),
      getAttestationKey(),
    ]);
  } catch {
    notFound();
  }

  if (!price || !detail) notFound();

  const yesPct = formatPrice(price.price);
  const noPct = formatPrice(1 - price.price);
  const lowConfidence = price.confidence < 0.3;
  const liveStats = {
    depth: price.depth_usd,
    trades: price.trade_count_24h,
    traders: price.unique_traders_24h,
    twap: price.twap_24h,
    change: price.last_change_24h,
    spotVsTwap: price.spot_vs_twap_pct,
    resolverTotal: price.resolver_track_record.total,
    resolverLost: price.resolver_track_record.lost,
  };
  const showMarketDataSection =
    liveStats.depth > 0 ||
    liveStats.trades > 0 ||
    liveStats.traders > 0 ||
    liveStats.resolverTotal > 0;

  return (
    <main className="min-h-screen bg-[var(--de-bg)] text-[var(--de-ink)]">
      <TopNav eventId={eventId} />

      <section
        className="relative overflow-hidden border-b border-[var(--de-line)] px-6 pb-12 pt-12 sm:px-12"
        style={{
          background:
            "radial-gradient(50% 35% at 50% 0%, var(--de-lavender-glow), transparent)",
        }}
      >
        <div className="relative mx-auto max-w-5xl">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
            {detail.market_kind_proposed.replace(/([A-Z])/g, " $1").trim()}
            {lowConfidence ? " · low confidence" : ""}
          </p>
          <h1 className="font-serif text-3xl leading-tight tracking-tight sm:text-5xl">
            {price.description}
          </h1>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
            Window closes{" "}
            <time
              dateTime={price.window_end}
              className="text-[var(--de-ink)] normal-case tracking-normal"
            >
              {new Date(price.window_end).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </p>
        </div>
      </section>

      {/* Hero band: prices on the left, agent panel on the right. */}
      <section className="border-b border-[var(--de-line)] px-6 py-10 sm:px-12">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="grid grid-cols-2 gap-4">
            <OutcomeCard
              label="YES"
              value={yesPct}
              accent="mint"
              caption={
                detail.outcome_yes ? humanResolution(detail.outcome_yes) : null
              }
            />
            <OutcomeCard
              label="NO"
              value={noPct}
              accent="rose"
              caption={
                detail.outcome_no ? humanResolution(detail.outcome_no) : null
              }
            />
          </div>
          <AgentPanel
            eventId={eventId}
            attestationKey={attestationKey}
            backendUrl={BACKEND_URL}
          />
        </div>
      </section>

      {/* Trade panel + position strip. Visually one panel, two layers. */}
      <section className="border-b border-[var(--de-line)] px-6 py-10 sm:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
            Trade
          </h2>
          <div className="overflow-hidden rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)]">
            <TradeButtons
              eventId={eventId}
              marketAddress={detail.market_address ?? undefined}
              yesPrice={price.price}
            />
            <PositionDisplay marketAddress={detail.market_address ?? undefined} />
          </div>
        </div>
      </section>

      {showMarketDataSection ? (
        <section className="border-b border-[var(--de-line)] px-6 py-10 sm:px-12">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-5 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
              Market data
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Stat label="Depth" value={formatDepth(liveStats.depth)} />
              <Stat
                label="Confidence"
                value={`${Math.round(price.confidence * 100)}%`}
              />
              <Stat label="24h trades" value={liveStats.trades.toString()} />
              <Stat label="24h traders" value={liveStats.traders.toString()} />
              <Stat label="TWAP 24h" value={formatPrice(liveStats.twap)} />
              <Stat
                label="24h change"
                value={`${(liveStats.change * 100).toFixed(2)}%`}
              />
              <Stat
                label="Spot vs TWAP"
                value={`${(liveStats.spotVsTwap * 100).toFixed(2)}%`}
              />
              <Stat
                label="Resolver wins"
                value={
                  liveStats.resolverTotal > 0
                    ? `${liveStats.resolverTotal - liveStats.resolverLost}/${liveStats.resolverTotal}`
                    : "Fresh"
                }
              />
            </dl>
          </div>
        </section>
      ) : (
        <section className="border-b border-[var(--de-line)] px-6 py-8 sm:px-12">
          <div className="mx-auto max-w-5xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
              Market data
            </p>
            <p className="mt-2 text-sm text-[var(--de-ink-2)]">
              Brand new market.{" "}
              <span className="text-[var(--de-ink-3)]">
                Depth {formatDepth(liveStats.depth)} · first trade opens the book.
              </span>
            </p>
          </div>
        </section>
      )}

      <section className="border-b border-[var(--de-line)] px-6 py-10 sm:px-12">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
            How it resolves
          </h2>
          <div className="space-y-2 text-[15px] leading-relaxed text-[var(--de-ink-2)]">
            <p>
              <span className="font-mono text-[var(--de-mint)]">YES</span> if{" "}
              {humanResolution(detail.outcome_yes)}.
            </p>
            <p>
              <span className="font-mono text-[var(--de-rose)]">NO</span> if{" "}
              {humanResolution(detail.outcome_no)}.
            </p>
          </div>
          {detail.notes ? (
            <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-[var(--de-ink-3)]">
              {detail.notes}
            </p>
          ) : null}
        </div>
      </section>

      <footer className="px-6 py-10 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-4)] sm:px-12">
        <time dateTime={price.as_of}>
          As of{" "}
          {new Date(price.as_of).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
      </footer>
    </main>
  );
}

function TopNav({ eventId }: { eventId: string }) {
  return (
    <nav className="sticky top-0 z-10 border-b border-[var(--de-line)] bg-[var(--de-bg)]/85 px-6 py-3 backdrop-blur sm:px-12">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <Link
          href="/events"
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-ink-3)] transition-colors duration-150 ease-out hover:text-[var(--de-ink)] focus-visible:outline-none focus-visible:underline"
        >
          ← All events
        </Link>
        <code
          className="truncate font-mono text-[10px] text-[var(--de-ink-4)]"
          title={eventId}
        >
          {eventId}
        </code>
      </div>
    </nav>
  );
}

function OutcomeCard({
  label,
  value,
  accent,
  caption,
}: {
  label: string;
  value: string;
  accent: "mint" | "rose";
  caption?: string | null;
}) {
  const color = accent === "mint" ? "var(--de-mint)" : "var(--de-rose)";
  const tint = accent === "mint" ? "var(--de-mint-tint)" : "var(--de-rose-tint)";
  return (
    <div
      className="rounded-2xl border bg-[var(--de-bg-raised)] p-6"
      style={{ borderColor: tint }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
        {label}
      </p>
      <p
        className="mt-2 font-mono text-5xl tabular-nums"
        style={{ color }}
      >
        {value}
      </p>
      {caption ? (
        <p className="mt-3 text-[11px] leading-snug text-[var(--de-ink-3)]">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-lg tabular-nums text-[var(--de-ink)]">
        {value}
      </dd>
    </div>
  );
}

function humanResolution(raw: string): string {
  // Drop the underscore taxonomy and round it into a readable phrase.
  // Keeps the source unchanged on /v1/event-detail but presents better here.
  return raw
    .replaceAll("_", " ")
    .replace(/\b(\d+)d\b/g, "$1-day")
    .replace(/\b(\d+)h\b/g, "$1-hour")
    .replace(/\bbreaches\b/g, "exceeds")
    .replace(/\bany\b/gi, "any")
    .replace(/\bwindow expired\b/gi, "the window closes")
    .trim();
}
