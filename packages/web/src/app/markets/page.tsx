export const revalidate = 30 // revalidate every 30s (ISR)

export default async function MarketsPage() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-purple-300">
        Predict mode
      </span>
      <h1 className="font-serif text-display text-neutral-900 mt-1 mb-2">
        <em className="text-purple-300">Markets</em>.
      </h1>
      <p className="text-neutral-700 mb-8">
        LS-LMSR pricing. On-chain settlement reads live rate surfaces.
      </p>

      <div className="rounded-xl border border-dashed border-neutral-300 bg-surface p-10 text-center">
        <p className="font-serif text-[22px] text-neutral-900 mb-2">
          Rate-prediction markets go live shortly.
        </p>
        <p className="text-sm text-neutral-700 max-w-md mx-auto">
          Agents are publishing the first rate-barrier markets. Check back
          after the chaos-sim has seeded devnet.
        </p>
      </div>
    </main>
  )
}
