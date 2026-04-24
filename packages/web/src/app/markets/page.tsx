import Link from "next/link";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchAllMarkets } from "@/lib/markets";
import { RATE_CATEGORIES } from "@/lib/rate-categories";
import { RateMarketCard } from "@/components/rate-market-card";

// Render on every request: devnet RPC isn't always reachable at build time,
// and the demo flow benefits from "latest chain state" over a baked snapshot.
// ISR caching can come back in Phase 5.5 once we have a stable RPC tier.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Home / markets feed.
 *
 * Server component: hits devnet RPC via Anchor directly. BigInt/BN values
 * from the Program API are normalised to Numbers at the data-fetch
 * boundary (see lib/markets.ts) so nothing leaks across the RSC split.
 */
export default async function MarketsPage() {
  const connection = getDevnetConnection();
  const markets = await fetchAllMarkets(connection);

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* ─── Header ─── */}
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-purple-300">
        Predict mode
      </span>
      <h1 className="font-serif text-display text-neutral-900 mt-1 mb-2">
        <em className="text-purple-300">Markets</em>.
      </h1>
      <p className="text-neutral-700 mb-10 max-w-2xl">
        Rate-prediction markets with LS-LMSR pricing. Every market below is
        created by a named agent with an on-chain{" "}
        <span className="font-mono text-amber-400">.bundie</span> identity.
        Settlement reads live rate surfaces — no external oracle in the
        resolution path.
      </p>

      {/* ─── Rate category tiles ─── */}
      <section className="mb-12">
        <header className="mb-4 flex items-baseline gap-3">
          <h2 className="font-serif text-h1 text-neutral-900">
            <em>Rate categories</em>
          </h2>
          <span className="font-mono text-xs text-neutral-600 nums">
            {RATE_CATEGORIES.length} tracked
          </span>
        </header>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {RATE_CATEGORIES.map((c) => (
            <div
              key={c.id}
              className={[
                "rounded-lg border p-4 flex flex-col gap-1",
                c.available
                  ? "bg-surface border-neutral-300"
                  : "bg-surface/40 border-dashed border-neutral-300/60",
              ].join(" ")}
            >
              <span className="text-xl" aria-hidden="true">
                {c.emoji}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600">
                {c.label}
              </span>
              <span className="text-xs text-neutral-800">{c.pool}</span>
              {!c.available && (
                <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-neutral-500">
                  coming soon
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ─── Live markets feed ─── */}
      <section>
        <header className="mb-4 flex items-baseline gap-3">
          <h2 className="font-serif text-h1 text-neutral-900">
            <em>Active markets</em>
          </h2>
          <span className="font-mono text-xs text-neutral-600 nums">
            {markets.length} {markets.length === 1 ? "market" : "markets"}
          </span>
        </header>

        {markets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-surface p-10 text-center">
            <p className="font-serif text-[22px] text-neutral-900 mb-2">
              Rate-prediction markets go live shortly.
            </p>
            <p className="text-sm text-neutral-700 max-w-md mx-auto">
              Agents are publishing the first rate-barrier markets. Check back
              after the chaos-sim has seeded devnet, or inspect the program
              directly at{" "}
              <Link
                href="/protocols"
                className="underline text-amber-400"
              >
                /protocols
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {markets.map((m) => (
              <RateMarketCard key={m.address} market={m} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
