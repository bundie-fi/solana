// TODO: Portfolio dashboard
// - Three yield layer cards: Strategy Shares, Prediction Positions, LP Rewards
// - Total earnings summary with breakdown
// - Active strategy share holdings with current value
// - Open prediction positions with P&L
// - Claim/withdraw actions

export default function PortfolioPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-2">Portfolio</h1>
      <p className="text-gray-400 mb-8">Your Yields</p>
      <div className="rounded-xl border border-border bg-surface p-12 text-center text-gray-500">
        Three yield layer cards, earnings breakdown, and prediction positions go
        here.
      </div>
    </main>
  );
}
