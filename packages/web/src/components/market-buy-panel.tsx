"use client";

import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import { buildBuySharesTx, buildRedeemTx } from "@/lib/tx-builders";
import type { MarketView } from "@/lib/markets";
import { ChainBadge } from "@/components/chain-badge";

const WalletButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

interface MarketBuyPanelProps {
  market: MarketView;
  yesProbability: number; // 0..1
}

type Stage = "idle" | "preview" | "confirm" | "success";

/**
 * Bet panel with 3-stage flow: idle → preview → confirm (Zerion routing) → success.
 * Matches the BetOverlay pattern from the Seeker design.
 */
export function MarketBuyPanel({ market, yesProbability }: MarketBuyPanelProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, sendTransaction, connected } = wallet;

  const [amount, setAmount] = useState("0.5");
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");

  const isResolved = market.status === "resolved";

  const yesPrice = yesProbability;
  const noPrice = 1 - yesProbability;
  const price = side === "yes" ? yesPrice : noPrice;
  const amountNum = parseFloat(amount) || 0;
  const shares = price > 0 ? amountNum / price : 0;
  const payout = shares;

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
    setStage("confirm");

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
      setStage("success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("User rejected")) setError("Transaction rejected.");
      else setError(msg.slice(0, 160));
      setStage("idle");
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

  if (isResolved) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="bd-eyebrow" style={{ marginBottom: 10 }}>Market resolved</div>
        <div style={{ fontSize: 13, marginBottom: 14 }}>
          Outcome:{" "}
          <span
            style={{
              color: market.outcome === "yes" ? "var(--green-2)" : "var(--red-2)",
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
            }}
          >
            {(market.outcome ?? "—").toUpperCase()}
          </span>
        </div>
        {connected ? (
          <button
            type="button"
            onClick={handleRedeem}
            disabled={loading || market.outcome == null}
            className="btn btn-primary"
            style={{ width: "100%", padding: "13px" }}
          >
            {loading ? "Redeeming…" : "Redeem winning shares"}
          </button>
        ) : (
          <WalletButton
            style={{
              width: "100%",
              background: "var(--fg-0)",
              border: "none",
              borderRadius: "8px",
              color: "#FAF7F0",
              fontSize: "13px",
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              height: "46px",
              padding: "0 16px",
            }}
          />
        )}
        <TxStatus error={error} sig={txSig} />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="bd-eyebrow" style={{ marginBottom: 12 }}>Place bet</div>

        {/* Side toggle (disabled) */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <div
            className="btn btn-yes"
            style={{ flex: 1, padding: "12px", fontSize: 13, fontWeight: 600, opacity: 0.6, cursor: "default" }}
          >
            YES · {Math.round(yesPrice * 100)}¢
          </div>
          <div
            className="btn btn-no"
            style={{ flex: 1, padding: "12px", fontSize: 13, fontWeight: 600, opacity: 0.6, cursor: "default" }}
          >
            NO · {Math.round(noPrice * 100)}¢
          </div>
        </div>

        <p style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 14, textAlign: "center" }}>
          Connect a wallet to bet on this market.
        </p>
        <WalletButton
          style={{
            width: "100%",
            background: "var(--fg-0)",
            border: "none",
            borderRadius: "8px",
            color: "#0a0a0a",
            fontSize: "13px",
            fontFamily: "var(--font-sans)",
            fontWeight: 600,
            height: "46px",
            padding: "0 16px",
          }}
        />
      </div>
    );
  }

  // Confirm stage overlay
  if (stage === "confirm" && loading) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center" }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: "2px solid var(--line-2)",
            borderTopColor: "var(--gold)",
            margin: "0 auto 16px",
            animation: "spin 0.9s linear infinite",
          }}
        />
        <div className="bd-eyebrow" style={{ marginBottom: 8 }}>Submitting</div>
        <div style={{ fontSize: 14, color: "var(--fg-1)" }}>Placing your bet…</div>
        <div className="dim mono-tiny" style={{ marginTop: 6, fontSize: 10 }}>
          waiting for confirmation
        </div>
      </div>
    );
  }

  // Success stage
  if (stage === "success" && txSig) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--green-tint)",
            border: "1px solid rgba(34,197,94,0.4)",
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 24px rgba(34,197,94,0.25)",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M5 12.5l4.5 4.5L19 7" stroke="var(--green-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            textAlign: "center",
            marginBottom: 8,
            letterSpacing: "-0.02em",
            color: "var(--fg-0)",
          }}
        >
          Bet placed.
        </div>
        <div className="muted" style={{ fontSize: 12.5, textAlign: "center", marginBottom: 18 }}>
          You hold{" "}
          <span
            className="mono"
            style={{ color: side === "yes" ? "var(--green-2)" : "var(--red-2)", fontSize: 12 }}
          >
            {shares.toFixed(2)} {side.toUpperCase()}
          </span>{" "}
          shares.
        </div>

        <div className="card inset" style={{ padding: 14, marginBottom: 16 }}>
          <BetRow label="Tx" value={<span className="mono dim" style={{ fontSize: 10 }}>{txSig.slice(0, 8)}…{txSig.slice(-6)}</span>} />
          <BetRow label="Chain" value={<ChainBadge chain="devnet" />} last />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: "100%", padding: "14px", fontSize: 13 }}
          onClick={() => { setStage("idle"); setTxSig(null); }}
        >
          Done
        </button>
      </div>
    );
  }

  // Preview stage
  if (stage === "preview") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="bd-eyebrow" style={{ marginBottom: 6 }}>Confirm bet</div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            marginBottom: 16,
            letterSpacing: "-0.02em",
            color: "var(--fg-0)",
          }}
        >
          Bet <em style={{ fontFamily: "var(--font-sans)", fontStyle: "italic", fontWeight: 300, color: side === "yes" ? "var(--green-2)" : "var(--red-2)" }}>{side.toLowerCase()}.</em>
        </div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 18 }}>
          {market.question}
        </div>

        <div className="card inset" style={{ padding: 14, marginBottom: 16 }}>
          <BetRow label="Side" value={<span style={{ color: side === "yes" ? "var(--green-2)" : "var(--red-2)" }}>{side.toUpperCase()}</span>} />
          <BetRow label="Stake" value={`${amountNum.toFixed(2)} USDC`} />
          <BetRow label="Shares" value={`${shares.toFixed(2)} ${side.toUpperCase()}`} />
          <BetRow label="Max payout" value={<span style={{ color: side === "yes" ? "var(--green-2)" : "var(--red-2)", fontFamily: "var(--font-mono)" }}>◎{payout.toFixed(2)}</span>} last />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: "100%", padding: "14px", fontSize: 13, marginBottom: 8 }}
          onClick={handleBuy}
        >
          Confirm bet
        </button>
        <button
          className="btn btn-ghost"
          style={{ width: "100%", padding: "12px", fontSize: 12 }}
          onClick={() => setStage("idle")}
        >
          Cancel
        </button>
      </div>
    );
  }

  // Idle state — main bet panel
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="bd-eyebrow" style={{ marginBottom: 12 }}>Place bet</div>

      {/* Side toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          className={`btn btn-yes flex-1${side === "yes" ? " solid" : ""}`}
          style={{ padding: "12px", fontSize: 13, fontWeight: 600 }}
          onClick={() => setSide("yes")}
        >
          YES · {Math.round(yesPrice * 100)}%
        </button>
        <button
          className={`btn btn-no flex-1${side === "no" ? " solid" : ""}`}
          style={{ padding: "12px", fontSize: 13, fontWeight: 600 }}
          onClick={() => setSide("no")}
        >
          NO · {Math.round(noPrice * 100)}%
        </button>
      </div>

      {/* Amount */}
      <div className="bd-eyebrow" style={{ marginBottom: 6, fontSize: 9 }}>Amount</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <div
          className="card inset"
          style={{ flex: 1, padding: "10px 14px", display: "flex", alignItems: "center" }}
        >
          <input
            type="number"
            step="0.1"
            min="0"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            disabled={loading}
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: 0,
              color: "var(--fg-0)",
              fontFamily: "var(--font-mono)",
              fontSize: 18,
              fontWeight: 600,
              padding: 0,
              WebkitAppearance: "none",
            }}
          />
          <span className="mono muted" style={{ fontSize: 12 }}>USDC</span>
        </div>
        <button
          className="btn btn-ghost"
          style={{ padding: "10px 14px", fontSize: 11 }}
          onClick={() => setAmount("10")}
        >
          MAX
        </button>
      </div>

      {/* Quick amounts */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[0.1, 0.5, 1.0, 2.0].map((v) => (
          <button
            key={v}
            className="btn btn-ghost flex-1"
            style={{ padding: "8px", fontSize: 11, fontFamily: "var(--font-mono)" }}
            onClick={() => setAmount(v.toString())}
          >
            ◎{v.toFixed(1)}
          </button>
        ))}
      </div>

      {/* Preview */}
      <div className="card inset" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span className="muted" style={{ fontSize: 11 }}>You receive</span>
          <span className="mono hl" style={{ fontSize: 13, fontWeight: 600 }}>
            {shares.toFixed(2)} {side.toUpperCase()} shares
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span className="muted" style={{ fontSize: 11 }}>Avg price</span>
          <span className="mono" style={{ fontSize: 12 }}>◎{price.toFixed(3)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 11 }}>Payout if correct</span>
          <span
            className="mono"
            style={{ fontSize: 13, fontWeight: 600, color: side === "yes" ? "var(--green-2)" : "var(--red-2)" }}
          >
            ◎{payout.toFixed(2)}
          </span>
        </div>
      </div>

      <button
        className="btn btn-primary"
        style={{ width: "100%", padding: "14px", fontSize: 13 }}
        disabled={loading || amountNum <= 0}
        onClick={() => setStage("preview")}
      >
        Review bet
      </button>
      <div className="dim mono-tiny" style={{ textAlign: "center", marginTop: 10, fontSize: 9.5 }}>
        0.3% slippage · 0 fees on devnet
      </div>

      <TxStatus error={error} sig={null} />
    </div>
  );
}

function BetRow({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "7px 0",
        borderBottom: last ? "none" : "1px solid var(--line-1)",
      }}
    >
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
      <span className="mono hl" style={{ fontSize: 12, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function TxStatus({ error, sig }: { error: string | null; sig: string | null }) {
  if (!error && !sig) return null;
  return (
    <div style={{ marginTop: 10, fontSize: 12 }}>
      {error && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--red-tint)",
            border: "1px solid rgba(239,68,68,0.24)",
            color: "var(--red-2)",
            fontSize: 11,
            wordBreak: "break-word",
          }}
        >
          {error}
        </div>
      )}
      {sig && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--green-tint)",
            border: "1px solid rgba(34,197,94,0.24)",
          }}
        >
          <div style={{ color: "var(--green-2)", fontWeight: 600, fontSize: 11, marginBottom: 4 }}>Confirmed.</div>
          <a
            href={`https://orbmarkets.io/tx/${sig}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--gold)", fontFamily: "var(--font-mono)", fontSize: 10, wordBreak: "break-all" }}
          >
            {sig.slice(0, 20)}…{sig.slice(-8)}
          </a>
        </div>
      )}
    </div>
  );
}
