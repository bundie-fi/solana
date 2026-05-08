"use client";

import Link from "next/link";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { buildRedeemTx } from "@/lib/tx-builders";
import { isMobileWalletAdapter, sendTxViaMwa } from "@/lib/mwa-tx";
import { resolveSns, truncatePubkey } from "@/lib/sns-resolver";
import type { MarketView } from "@/lib/markets";

export type PositionState = "open" | "pending" | "resolved";

export interface Position {
  market: MarketView;
  side: "yes" | "no";
  shares: number;
  state: PositionState;
}

/**
 * One row in the /portfolio list. Hoisted out of page.tsx so the
 * page stays under the ~350-line soft cap and so the redeem wallet-call
 * state doesn't force a whole-list re-render when one row's ix lands.
 */
export function PositionCard({ position: p }: { position: Position }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, wallet } = useWallet();
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);

  const creatorSns = resolveSns(p.market.createdBy);
  const creatorLabel =
    creatorSns?.devnetName ?? truncatePubkey(p.market.createdBy);

  // On mobile (Mobile Wallet Adapter), the wallet-adapter-react cached
  // publicKey can drift from the wallet's actively-authorized signing key
  // — same gotcha market-buy-panel.tsx already handles. If we feed the
  // cached key into the redeem ix as `redeemer`, the runtime rejects the
  // submitted tx with `signature verification failed` because the signer
  // slot's pubkey doesn't match the signature's. Build via the MWA helper
  // so the ix is constructed with the FRESHLY authorised pubkey.
  const isMwa = isMobileWalletAdapter(wallet?.adapter?.name);

  const canRedeem =
    p.state === "resolved" &&
    p.market.outcome != null &&
    p.market.outcome === p.side;

  async function handleRedeem() {
    if (!publicKey) return;
    setRedeeming(true);
    setRedeemMsg(null);
    try {
      let sig: string;
      if (isMwa) {
        const result = await sendTxViaMwa({
          connection,
          logPrefix: "[redeem]",
          buildTx: async (signer) =>
            buildRedeemTx(connection, { market: p.market, redeemer: signer }),
        });
        sig = result.signature;
        await connection.confirmTransaction(
          {
            signature: sig,
            blockhash: result.blockhash,
            lastValidBlockHeight: result.lastValidBlockHeight,
          },
          "confirmed",
        );
      } else {
        const tx = await buildRedeemTx(connection, {
          market: p.market,
          redeemer: publicKey,
        });
        sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, "confirmed");
      }
      setRedeemMsg(`confirmed · ${sig.slice(0, 12)}…`);
    } catch (e) {
      setRedeemMsg(e instanceof Error ? e.message.slice(0, 100) : "failed");
    } finally {
      setRedeeming(false);
    }
  }

  const sideColor =
    p.side === "yes"
      ? "bg-success-400/10 border-success-400/40 text-success-400"
      : "bg-amber-400/10 border-amber-400/40 text-amber-400";

  return (
    <li className="rounded-xl border border-neutral-300 bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="text-lg shrink-0" aria-hidden="true">
          📊
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600">
              Agent market
            </span>
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded border ${sideColor}`}
            >
              {p.side}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-500 ml-auto">
              by {creatorLabel}
            </span>
          </div>
          <Link
            href={`/market/${p.market.address}`}
            className="block font-serif text-[15px] text-neutral-900 line-clamp-2 hover:text-amber-400 transition-colors"
          >
            {p.market.question || "-"}
          </Link>
          <div className="flex items-center justify-between gap-3 mt-2">
            <span className="font-mono text-xs text-neutral-700 nums">
              {p.shares.toLocaleString()} shares
            </span>
            {canRedeem && (
              <button
                type="button"
                onClick={handleRedeem}
                disabled={redeeming}
                className="min-h-[44px] py-2 rounded-lg bg-success-400/20 border border-success-400/40 text-success-400 font-mono text-[11px] uppercase tracking-[0.14em] px-4 hover:bg-success-400/30 transition disabled:opacity-50"
              >
                {redeeming ? "redeeming…" : "redeem"}
              </button>
            )}
            {p.state === "resolved" && !canRedeem && (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                lost · {p.market.outcome?.toUpperCase()} won
              </span>
            )}
          </div>
          {redeemMsg && (
            <div className="mt-2 font-mono text-[11px] text-neutral-600 break-all">
              {redeemMsg}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
