// TODO: Prediction markets hub
// - List of active prediction markets (strategy outperformance bets)
// - Each market shows: question, YES/NO prices, liquidity, expiry
// - LS-LMSR pricing display (not constant-product)
// - Quick buy YES/NO buttons
// - Filter by strategy, status (active/resolved), volume

export default function MarketsPage() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-predict-purple mb-2">Markets</h1>
      <p className="text-gray-400 mb-8">Prediction Hub</p>
      <div className="rounded-xl border border-border bg-surface p-12 text-center text-gray-500">
        Prediction markets list with YES/NO prices and LS-LMSR pricing go here.
      </div>
    </main>
  );
}
