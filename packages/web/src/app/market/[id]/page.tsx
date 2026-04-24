import Link from 'next/link'

export const revalidate = 30

export default function MarketDetailPage({
  params,
}: {
  params: { id: string }
}) {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <Link
        href="/markets"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-purple-300 hover:text-purple-200"
      >
        ← Back to markets
      </Link>
      <h1 className="font-serif text-display text-neutral-900 mt-4 mb-2">
        Market <em className="text-purple-300">detail</em>
      </h1>
      <p className="text-neutral-700 mb-8 font-mono text-sm break-all">
        {params.id}
      </p>
      <div className="rounded-xl border border-dashed border-neutral-300 bg-surface p-10 text-center">
        <p className="font-serif text-[22px] text-neutral-900 mb-2">
          Detail view coming in Phase 5.
        </p>
        <p className="text-sm text-neutral-700 max-w-md mx-auto">
          The rate-market detail page ships with the chaos-sim seed — creator
          identity, live rate readings, payoff curve, and LS-LMSR state.
        </p>
      </div>
    </main>
  )
}
