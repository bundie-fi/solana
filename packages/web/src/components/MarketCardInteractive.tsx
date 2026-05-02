"use client";

import Link from "next/link";
import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import type { MarketDisplay } from "@bundie/common";
import { PredictPanel } from "./PredictPanel";
import {
  QUALITY_GATE_MIN_DAYS,
  type QualityGateResult,
} from "@/lib/quality-gate";

const PREDICTION_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4"
);

// USDC devnet mint
const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

function PriceBar({ yesPrice }: { yesPrice: number }) {
  const yesPct = Math.round(yesPrice * 100);
  const noPct = 100 - yesPct;
  return (
    <div className="flex h-2 rounded-full overflow-hidden mt-3">
      <div className="bg-green-500" style={{ width: `${yesPct}%` }} />
      <div className="bg-red-500" style={{ width: `${noPct}%` }} />
    </div>
  );
}

interface MarketCardInteractiveProps {
  m: MarketDisplay;
  /** Optional track-record gate result for the underlying agent.
   *  Computed server-side and passed down so the inline "Predict" CTA
   *  can render in a disabled state (with a "Track record building"
   *  badge) for agents younger than 7 days. */
  qualityGate?: QualityGateResult;
}

export function MarketCardInteractive({
  m,
  qualityGate,
}: MarketCardInteractiveProps) {
  const [showPredict, setShowPredict] = useState(false);
  const gateBlocked = qualityGate ? !qualityGate.passes : false;

  const yesPct = Math.round(m.yesPrice * 100);
  const noPct = Math.round(m.noPrice * 100);
  const vol = Number(m.totalVolume) / 1e6;

  // Derive PDAs from market address
  const marketPk = new PublicKey(m.address);

  const [yesMintPk] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), marketPk.toBuffer()],
    PREDICTION_PROGRAM_ID
  );
  const [noMintPk] = PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), marketPk.toBuffer()],
    PREDICTION_PROGRAM_ID
  );
  const [vaultPk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPk.toBuffer()],
    PREDICTION_PROGRAM_ID
  );

  const collateralMint = m.collateralMint ?? USDC_DEVNET;

  return (
    <div
      className={`rounded-xl border bg-surface p-5 transition-colors ${
        showPredict
          ? "border-predict-purple/50"
          : "border-neutral-300 hover:border-predict-purple/40"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs px-2 py-0.5 rounded-full bg-predict-purple/20 text-predict-purple font-medium">
          {m.marketType === "absolute" ? "Performance" : "Vs Match"}
        </span>
        <span
          className={`text-xs font-medium ${
            m.status === "active" ? "text-success-400" : "text-neutral-800"
          }`}
        >
          {m.status === "resolved"
            ? `Settled: ${m.outcome?.toUpperCase()}`
            : "Active"}
        </span>
      </div>

      <Link
        href={`/market/${m.address}`}
        className="block group"
      >
        <p className="text-sm text-neutral-900 font-medium mt-2 mb-1 leading-snug group-hover:text-purple-300 transition-colors">
          {m.question}
        </p>
        <p className="text-xs text-neutral-800 font-mono mb-3">{m.strategyName}</p>
      </Link>

      <div className="flex justify-between text-sm font-semibold mb-1">
        <span className="text-success-400">YES {yesPct}¢</span>
        <span className="text-danger-400">NO {noPct}¢</span>
      </div>
      <PriceBar yesPrice={m.yesPrice} />

      {gateBlocked && qualityGate && (
        <div
          className="mt-3 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            background: "var(--gold-tint)",
            color: "var(--gold)",
            border: "1px solid var(--gold)",
          }}
        >
          Track record building · {qualityGate.daysOfHistory}/
          {QUALITY_GATE_MIN_DAYS} days
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <p className="text-xs text-neutral-800">Vol: ${vol.toFixed(2)}</p>
        {m.status === "active" && (
          <button
            onClick={() => !gateBlocked && setShowPredict((v) => !v)}
            disabled={gateBlocked}
            title={
              gateBlocked
                ? `Bets disabled , agent has only ${qualityGate?.daysOfHistory ?? 0} of ${QUALITY_GATE_MIN_DAYS} days of NAV history.`
                : undefined
            }
            className={`text-xs font-semibold px-3 py-1 rounded-lg transition-colors ${
              gateBlocked
                ? "bg-neutral-200 border border-neutral-300 text-neutral-500 cursor-not-allowed"
                : showPredict
                  ? "bg-predict-purple/20 border border-predict-purple/40 text-predict-purple"
                  : "bg-predict-purple/10 border border-predict-purple/20 text-predict-purple hover:bg-predict-purple/20"
            }`}
          >
            {gateBlocked ? "Predict (locked)" : showPredict ? "Close" : "Predict"}
          </button>
        )}
      </div>

      {showPredict && !gateBlocked && (
        <PredictPanel
          marketAddress={m.address}
          yesMintAddress={yesMintPk.toBase58()}
          noMintAddress={noMintPk.toBase58()}
          vaultAddress={vaultPk.toBase58()}
          yesPrice={m.yesPrice}
          noPrice={m.noPrice}
          collateralMint={collateralMint}
        />
      )}
    </div>
  );
}
