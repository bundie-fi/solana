/**
 * Two-color split bar showing the implied YES vs NO probability of a market.
 *
 * `yesPrice` is the LS-LMSR softmax probability in [0, 1]; the NO portion
 * fills the remainder. Heights / colors match the predict-mode brand
 * (success-400 for YES, danger-400 for NO).
 */
export function PriceBar({
  yesPrice,
  height = "h-2",
  className = "",
}: {
  yesPrice: number
  height?: string
  className?: string
}) {
  const clamped = Number.isFinite(yesPrice) ? Math.min(1, Math.max(0, yesPrice)) : 0.5
  const yesPct = Math.round(clamped * 100)
  const noPct = 100 - yesPct
  return (
    <div className={`flex ${height} rounded-full overflow-hidden ${className}`}>
      <div className="bg-success-400" style={{ width: `${yesPct}%` }} />
      <div className="bg-danger-400" style={{ width: `${noPct}%` }} />
    </div>
  )
}
