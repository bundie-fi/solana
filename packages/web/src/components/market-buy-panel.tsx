"use client";

import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { buildBuySharesTx, buildRedeemTx } from "@/lib/tx-builders";
import type { MarketView } from "@/lib/markets";

interface MarketBuyPanelProps {
  market: MarketView;
  yesProbability: number; // 0..1
}

/**
 * YES / NO buy panel for a prediction market. Sticky to the top of
 * the fold on mobile (where screen real-estate is precious) and
 * full-width on desktop.
 *
 * Hand-encodes the `buy_shares` ix via `lib/tx-builders.ts` — no Anchor
 * method-builder on the client bundle.
 */
export function MarketBuyPanel({ market, yesProbability }: MarketBuyPanelProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, sendTransaction, connected } = wallet;

  const [amount, setAmount] = useState("10");
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const isResolved = market.status === "resolved";
  const resolvable =
    market.status === "active" && market.resolutionSlot > 0;

  async function handleBuy() {
    if (!publicKey || !connected) return;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setError("Enter a valid USDC amount.");
      return;
    }

    setError(null);
    setTxSig(null);
    setLoading(true);

    try {
      const amountLamports = BigInt(Math.round(parsed * 1_000_000));
      const tx = await buildBuySharesTx(connection, {
        market,
        buyer: publicKey,
        outcome: side,
        amount: amountLamports,
      });
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setTxSig(sig);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("User rejected")) setError("Transaction rejected.");
      else setError(msg.slice(0, 160));
    } finally {
      setLoading(false);
    }
  }

  async function handleRedeem() {
    if (!publicKey || !connected) return;
    setError(null);
    setTxSig(null);
    setLoading(true);
    try {
      const tx = await buildRedeemTx(connection, {
        market,
        redeemer: publicKey,
      });
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setTxSig(sig);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.slice(0, 160));
    } finally {
      setLoading(false);
    }
  }

  const yesPrice = yesProbability; // 0..1, treat as "cents per share"
  const noPrice = 1 - yesProbability;

  if (!connected) {
    return (
      <div className="rounded-2xl border border-neutral-300 bg-gradient-to-br from-neutral-200 to-neutral-100 p-5 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <DisabledOutcomeButton
            label="Buy YES"
            priceCents={Math.round(yesPrice * 100)}
            color="success"
          />
          <DisabledOutcomeButton
            label="Buy NO"
            priceCents={Math.round(noPrice * 100)}
            color="amber"
          />
        </div>
        <div className="pt-2 border-t border-neutral-300 flex flex-col items-center gap-2">
          <p className="text-xs text-neutral-700 text-center">
            Connect a wallet to bet on this market.
          </p>
          <WalletMultiButton
            style={{
              background: "rgba(109,40,217,0.18)",
              border: "1px solid rgba(109,40,217,0.4)",
              borderRadius: "10px",
              color: "#b691f1",
              fontSize: "13px",
              height: "40px",
              padding: "0 16px",
            }}
          />
        </div>
      </div>
    );
  }

  if (isResolved) {
    return (
      <div className="rounded-2xl border border-neutral-300 bg-surface p-5 flex flex-col gap-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600">
          Market resolved
        </div>
        <p className="text-sm text-neutral-800">
          Outcome:{" "}
          <span
            className={
              market.outcome === "yes"
                ? "text-success-400 font-semibold"
                : "text-amber-400 font-semibold"
            }
          >
            {(market.outcome ?? "—").toUpperCase()}
          </span>
        </p>
        <button
          type="button"
          onClick={handleRedeem}
          disabled={loading || market.outcome == null}
          className="h-12 rounded-xl bg-success-400/20 border border-success-400/40 text-success-400 font-mono text-sm uppercase tracking-[0.14em] hover:bg-success-400/30 transition disabled:opacity-50"
        >
          {loading ? "Redeeming…" : "Redeem winning shares"}
        </button>
        <TxStatus error={error} sig={txSig} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-300 bg-gradient-to-br from-neutral-200 to-neutral-100 p-5 flex flex-col gap-4">
      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-2">
        <OutcomeToggleButton
          label="YES"
          priceCents={Math.round(yesPrice * 100)}
          selected={side === "yes"}
          onClick={() => setSide("yes")}
          color="success"
        />
        <OutcomeToggleButton
          label="NO"
          priceCents={Math.round(noPrice * 100)}
          selected={side === "no"}
          onClick={() => setSide("no")}
          color="amber"
        />
      </div>

      {/* Amount input */}
      <div>
        <label
          htmlFor="bet-usdc"
          className="block font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600 mb-1"
        >
          Collateral (USDC)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600 text-sm">
            $
          </span>
          <input
            id="bet-usdc"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            disabled={loading}
            className="w-full h-12 rounded-xl border border-neutral-300 bg-background pl-7 pr-4 text-neutral-900 text-base focus:outline-none focus:border-amber-400/70 transition-colors"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleBuy}
        disabled={loading || !amount || parseFloat(amount) <= 0 || !resolvable}
        className={[
          "h-14 rounded-xl font-mono text-sm uppercase tracking-[0.14em] transition-all",
          side === "yes"
            ? "bg-success-500 text-background hover:bg-success-400"
            : "bg-amber-500 text-background hover:bg-amber-400",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          "shadow-pop",
        ].join(" ")}
      >
        {loading ? "Confirming…" : `Buy ${side.toUpperCase()}`}
      </button>

      <TxStatus error={error} sig={txSig} />
    </div>
  );
}

function OutcomeToggleButton({
  label,
  priceCents,
  selected,
  onClick,
  color,
}: {
  label: string;
  priceCents: number;
  selected: boolean;
  onClick: () => void;
  color: "success" | "amber";
}) {
  const activeClass =
    color === "success"
      ? "bg-success-400/20 border-success-400 text-success-400"
      : "bg-amber-400/20 border-amber-400 text-amber-400";
  const idleClass = "bg-surface border-neutral-300 text-neutral-700";
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-14 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-all font-mono",
        selected ? activeClass : idleClass,
      ].join(" ")}
    >
      <span className="text-base font-semibold tracking-[0.14em]">{label}</span>
      <span className="text-[11px] uppercase tracking-[0.14em] nums">
        {priceCents}¢
      </span>
    </button>
  );
}

function DisabledOutcomeButton({
  label,
  priceCents,
  color,
}: {
  label: string;
  priceCents: number;
  color: "success" | "amber";
}) {
  const tone =
    color === "success"
      ? "bg-success-400/10 border-success-400/40 text-success-400"
      : "bg-amber-400/10 border-amber-400/40 text-amber-400";
  return (
    <div
      className={`h-14 rounded-xl border-2 ${tone} flex flex-col items-center justify-center gap-0.5 font-mono opacity-80`}
    >
      <span className="text-base font-semibold tracking-[0.14em]">{label}</span>
      <span className="text-[11px] uppercase tracking-[0.14em] nums">
        {priceCents}¢
      </span>
    </div>
  );
}

function TxStatus({ error, sig }: { error: string | null; sig: string | null }) {
  if (!error && !sig) return null;
  return (
    <div className="text-xs">
      {error && (
        <p className="rounded-lg border border-danger-400/30 bg-danger-400/10 px-3 py-2 text-danger-400 break-words">
          {error}
        </p>
      )}
      {sig && (
        <div className="rounded-lg border border-success-400/30 bg-success-400/10 px-3 py-2">
          <p className="text-success-400 font-medium">Confirmed.</p>
          <a
            href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="text-amber-400 hover:underline font-mono break-all"
          >
            {sig.slice(0, 20)}…{sig.slice(-8)}
          </a>
        </div>
      )}
    </div>
  );
}
