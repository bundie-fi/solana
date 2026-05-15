import Link from "next/link";
import {
  CATEGORIES,
  formatPrice,
  listEvents,
  type EventSummary,
} from "@/lib/events";
import { ProposalForm } from "./ProposalForm";

// 5-min ISR. The category catalog only changes when sources.json is
// updated, and the form is a client component so user input doesn't
// flow through this server render.
export const revalidate = 300;

export const metadata = {
  title: "Launch a market · Bundie",
  description:
    "Suggest a market and Bundie deploys it. Stablecoins, asset prices, protocol TVL, AI uptime, cloud incidents, network health — anything measurable.",
};

export default async function LaunchPage() {
  let events: EventSummary[] = [];
  try {
    events = await listEvents();
  } catch {
    // Catalog grid degrades gracefully if backend is down.
  }

  const byCategory: Record<string, EventSummary[]> = {};
  for (const e of events) {
    const key = e.category ?? "other";
    (byCategory[key] ||= []).push(e);
  }

  return (
    <main className="min-h-screen bg-[var(--de-bg)] text-[var(--de-ink)]">
      <Hero />
      <Catalog byCategory={byCategory} />
      <Process />
      <FormSection />
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
      <div className="relative mx-auto max-w-5xl">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
          Bundie · Launch a market
        </p>
        <h1 className="max-w-3xl font-serif text-4xl leading-[1.05] tracking-tight sm:text-6xl">
          What should Bundie
          <span className="text-[var(--de-lavender)]"> price next</span>?
        </h1>
        <p className="mt-5 max-w-xl text-base text-[var(--de-ink-2)]">
          Suggest a market. If it has a verifiable on-chain or public-data
          trigger, we&rsquo;ll deploy it and it starts trading immediately.
          No committees, no manual settlement.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          <a
            href="#form"
            className="text-[var(--de-lavender)] transition-colors duration-150 ease-out hover:text-[var(--de-lavender-2)]"
          >
            Skip to the form ↓
          </a>
          <Link
            href="/markets"
            className="transition-colors duration-150 ease-out hover:text-[var(--de-ink)]"
          >
            ← Live markets
          </Link>
        </div>
      </div>
    </header>
  );
}

function Catalog({
  byCategory,
}: {
  byCategory: Record<string, EventSummary[]>;
}) {
  return (
    <section className="border-b border-[var(--de-line)] px-6 py-12 sm:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
            What we already price
          </p>
          <h2 className="max-w-3xl font-serif text-3xl tracking-tight text-[var(--de-ink)] sm:text-4xl">
            Six categories live or scheduled.{" "}
            <span className="italic text-[var(--de-lavender)]">
              Yours could be the seventh.
            </span>
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => {
            const markets = byCategory[c.key] ?? [];
            return (
              <CategoryCard
                key={c.key}
                label={c.label}
                blurb={c.blurb}
                markets={markets}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CategoryCard({
  label,
  blurb,
  markets,
}: {
  label: string;
  blurb: string;
  markets: EventSummary[];
}) {
  const liveCount = markets.filter((m) => m.status === "active").length;
  const scheduledCount = markets.filter((m) => m.status !== "active").length;
  return (
    <div className="flex flex-col rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-xl tracking-tight text-[var(--de-ink)]">
          {label}
        </h3>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-4)]">
          {liveCount} live · {scheduledCount} scheduled
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--de-ink-3)]">
        {blurb}
      </p>
      <ul className="mt-4 divide-y divide-[var(--de-line)] border-t border-[var(--de-line)]">
        {markets.slice(0, 3).map((m) => (
          <li key={m.event_id}>
            <Link
              href={`/markets/${encodeURIComponent(m.event_id)}`}
              className="group flex items-start gap-3 py-2.5 transition-colors duration-150 ease-out hover:bg-[var(--de-bg-2)]"
            >
              <span
                className={`mt-1.5 inline-block size-1.5 shrink-0 rounded-full ${
                  m.status === "active"
                    ? "bg-[var(--de-mint)]"
                    : "bg-[var(--de-ink-5)]"
                }`}
              />
              <span className="flex-1 text-[13px] leading-snug text-[var(--de-ink-2)]">
                {m.description}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--de-ink-3)]">
                {m.status === "active" ? formatPrice(m.price) : "—"}
              </span>
            </Link>
          </li>
        ))}
        {markets.length === 0 ? (
          <li className="py-2.5 text-[13px] italic text-[var(--de-ink-4)]">
            No markets in this category yet.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Process() {
  return (
    <section className="border-b border-[var(--de-line)] px-6 py-12 sm:px-12">
      <div className="mx-auto max-w-6xl">
        <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
          How it works
        </p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <Step n="01">
            <strong>You suggest a market.</strong> Pick a category and
            describe the event in plain English. If you have a specific
            resolver class or trigger in mind, include it.
          </Step>
          <Step n="02">
            <strong>We review within 24-48 hours.</strong> If the event has
            a clean on-chain or public-data trigger, we wire it up. If not,
            we tell you what would need to change.
          </Step>
          <Step n="03">
            <strong>Approved markets go live.</strong> The market deploys
            with an initial subsidy from Bundie. You&rsquo;re notified the
            moment it starts trading.
          </Step>
        </div>
      </div>
    </section>
  );
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-lavender)]">
        Step {n}
      </p>
      <p className="text-[15px] leading-relaxed text-[var(--de-ink-2)]">
        {children}
      </p>
    </div>
  );
}

function FormSection() {
  return (
    <section id="form" className="px-6 py-12 sm:px-12">
      <div className="mx-auto max-w-3xl">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
          Suggest a market
        </p>
        <h2 className="mb-6 font-serif text-3xl tracking-tight text-[var(--de-ink)] sm:text-4xl">
          The shorter your description, the faster we deploy.
        </h2>
        <ProposalForm />
      </div>
    </section>
  );
}

