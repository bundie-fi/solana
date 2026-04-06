// TODO: Strategy leaderboard with sortable cards
// - Strategy cards showing name, 7d/30d performance, TVL, sparkline chart
// - Timeframe filter tabs (24h, 7d, 30d, All)
// - Search/filter by asset class or strategy type
// - Link each card to /strategy/[id]

export default function DiscoverPage() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-earn-gold mb-2">Discover</h1>
      <p className="text-gray-400 mb-8">Strategy Leaderboard</p>
      <div className="rounded-xl border border-border bg-surface p-12 text-center text-gray-500">
        Strategy cards, sparklines, and timeframe filters go here.
      </div>
    </main>
  );
}
