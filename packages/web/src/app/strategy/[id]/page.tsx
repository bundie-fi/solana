// TODO: Strategy detail page
// - Performance chart (line chart with timeframe selector)
// - Current allocation breakdown (pie/bar chart)
// - NAV, TVL, share price, historical returns
// - Earn button to mint strategy shares
// - Link to associated prediction markets

export default function StrategyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-earn-gold mb-2">
        Strategy Detail
      </h1>
      <p className="text-gray-400 mb-8">ID: {params.id}</p>
      <div className="rounded-xl border border-border bg-surface p-12 text-center text-gray-500">
        Performance chart, allocation breakdown, and earn button go here.
      </div>
    </main>
  );
}
