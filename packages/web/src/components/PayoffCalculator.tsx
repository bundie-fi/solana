"use client"

import { useMemo, useState } from "react"

/**
 * Client-side port of programs/prediction-market/src/math/lmsr.rs
 *
 * On-chain cost function (binary market):
 *   C(q_yes, q_no, b) = b * ln( exp(q_yes / b) + exp(q_no / b) )
 *   cost(buy outcome, Δ) = C(q_after) − C(q_before)
 *
 * The on-chain implementation uses log-sum-exp + 5th-order Taylor for
 * exp/ln in u128 fixed-point. JS doubles let us compute it directly while
 * still using the log-sum-exp trick so large q/b ratios don't blow up.
 *
 * b = liquidityParam (already chain-derived, so we don't need calculate_b).
 *
 * Settlement convention: each winning share pays out 1 USDC (1e6 base
 * units). The form inputs USDC; we binary-search the share count Δ such
 * that cost(Δ) == stake to surface "shares received for $X".
 */

function lmsrCost(qYes: number, qNo: number, b: number): number {
  if (b <= 0) return 0
  const a = qYes / b
  const c = qNo / b
  const m = Math.max(a, c)
  // log-sum-exp: m + ln(1 + e^(-|a-c|))
  return b * (m + Math.log(1 + Math.exp(-Math.abs(a - c))))
}

function costToBuy(
  yesShares: number,
  noShares: number,
  b: number,
  outcomeIsYes: boolean,
  shares: number,
): number {
  const before = lmsrCost(yesShares, noShares, b)
  const after = outcomeIsYes
    ? lmsrCost(yesShares + shares, noShares, b)
    : lmsrCost(yesShares, noShares + shares, b)
  return Math.max(0, after - before)
}

/**
 * Invert the cost function: given a USDC stake, find the share count Δ
 * such that costToBuy(Δ) ≈ stake. Cost is strictly monotonic increasing
 * in Δ for the buy-side, so a bisection over [0, hi] converges quickly.
 */
function sharesForStake(
  yesShares: number,
  noShares: number,
  b: number,
  outcomeIsYes: boolean,
  stakeBase: number,
): number {
  if (stakeBase <= 0 || b <= 0) return 0
  // Upper bound: even at the worst (price → 1) you get ~stakeBase shares.
  // Start with 4× stake to leave headroom; expand if needed.
  let hi = Math.max(stakeBase * 4, 1_000)
  let guard = 0
  while (
    costToBuy(yesShares, noShares, b, outcomeIsYes, hi) < stakeBase &&
    guard < 40
  ) {
    hi *= 2
    guard += 1
  }
  let lo = 0
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    const c = costToBuy(yesShares, noShares, b, outcomeIsYes, mid)
    if (c < stakeBase) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function PayoffCalculator({
  yesShares,
  noShares,
  liquidityParam,
  feeBps,
}: {
  yesShares: bigint
  noShares: bigint
  liquidityParam: bigint
  feeBps: number
}) {
  const [yesStake, setYesStake] = useState("10")
  const [noStake, setNoStake] = useState("10")

  const qY = Number(yesShares)
  const qN = Number(noShares)
  const b = Number(liquidityParam)

  const result = useMemo(() => {
    const compute = (raw: string, side: "yes" | "no") => {
      const stake = parseFloat(raw)
      if (!Number.isFinite(stake) || stake <= 0 || b <= 0) return null
      const stakeBase = stake * 1e6 // USDC has 6 decimals
      // Apply fee on the stake before computing shares (matches typical AMM UX).
      const stakeAfterFee = stakeBase * (1 - feeBps / 10_000)
      const shares = sharesForStake(qY, qN, b, side === "yes", stakeAfterFee)
      // Settlement convention: 1 winning share = 1 USDC = 1e6 base units.
      const payoutBase = shares
      const payoutUsdc = payoutBase / 1e6
      const entryPrice = shares > 0 ? stakeAfterFee / shares : 0
      const roi = stakeBase > 0 ? (payoutBase - stakeBase) / stakeBase : 0
      return {
        shares: shares / 1e6,
        entryPrice,
        payoutUsdc,
        roi,
      }
    }
    return {
      yes: compute(yesStake, "yes"),
      no: compute(noStake, "no"),
    }
  }, [yesStake, noStake, qY, qN, b, feeBps])

  return (
    <div className="rounded-xl border border-neutral-300 bg-surface p-6">
      <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-purple-300 mb-4">
        Payoff calculator
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Side
          label="Buy YES with"
          accent="success"
          stake={yesStake}
          onStake={setYesStake}
          result={result.yes}
        />
        <Side
          label="Buy NO with"
          accent="danger"
          stake={noStake}
          onStake={setNoStake}
          result={result.no}
        />
      </div>

      <p className="font-mono text-[10px] text-neutral-800 mt-4 leading-relaxed">
        cost = b · ln(exp(q_yes/b) + exp(q_no/b)) , on-chain LS-LMSR. Each
        winning share settles to 1 USDC. Fee of {(feeBps / 100).toFixed(2)}%
        applied to stake.
      </p>
    </div>
  )
}

type Result = {
  shares: number
  entryPrice: number
  payoutUsdc: number
  roi: number
} | null

function Side({
  label,
  accent,
  stake,
  onStake,
  result,
}: {
  label: string
  accent: "success" | "danger"
  stake: string
  onStake: (v: string) => void
  result: Result
}) {
  const accentText = accent === "success" ? "text-success-400" : "text-danger-400"
  const accentBorder =
    accent === "success" ? "border-success-400/30" : "border-danger-400/30"

  return (
    <div className={`rounded-lg border ${accentBorder} bg-neutral-50 p-4`}>
      <label className="block">
        <span className={`font-mono text-[11px] uppercase tracking-[0.12em] ${accentText}`}>
          {label}
        </span>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-neutral-800 text-sm">$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={stake}
            onChange={(e) => onStake(e.target.value)}
            className="flex-1 bg-transparent border-b border-neutral-300 focus:border-purple-300 outline-none font-mono nums text-lg text-neutral-900 py-1"
          />
          <span className="font-mono text-[11px] text-neutral-800">USDC</span>
        </div>
      </label>

      <dl className="mt-4 space-y-2 text-sm">
        <Row
          label="Shares received"
          value={result ? formatNumber(result.shares, 4) : "-"}
        />
        <Row
          label="Entry price"
          value={result ? `${(result.entryPrice * 100).toFixed(2)}¢` : "-"}
        />
        <Row
          label="Max payout"
          value={result ? `$${formatNumber(result.payoutUsdc, 2)}` : "-"}
          tone={accent}
        />
        <Row
          label="Max ROI"
          value={result ? `${(result.roi * 100).toFixed(1)}%` : "-"}
          tone={accent}
        />
      </dl>
    </div>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "success" | "danger"
}) {
  const toneClass =
    tone === "success"
      ? "text-success-400"
      : tone === "danger"
      ? "text-danger-400"
      : "text-neutral-900"
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-neutral-800 text-xs">{label}</dt>
      <dd className={`font-mono nums text-sm ${toneClass}`}>{value}</dd>
    </div>
  )
}

function formatNumber(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return "-"
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
