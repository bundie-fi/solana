"use client";

import { useCallback, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BUSD_DECIMALS, BUSD_MINT } from "@bundie/common";
import { claimFaucet } from "../lib/api";
import type { WizardAction, WizardState } from "../lib/wizard-state";
import { Header } from "./IdentityStep";

interface Props {
  state: WizardState;
  dispatch: (action: WizardAction) => void;
}

const FAUCET_AMOUNT = 50;

export function CapitalStep({ state, dispatch }: Props) {
  const { capital } = state;
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();

  const refreshBalance = useCallback(async () => {
    if (!publicKey || !connected) {
      dispatch({ type: "CAPITAL/SET_BALANCE", value: null });
      return;
    }
    try {
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(BUSD_MINT),
        publicKey,
        false,
      );
      // Don't pass the string commitment — rpcfast (the configured devnet
      // RPC) rejects positional `"confirmed"` with `expected struct
      // CommitmentConfig`, falling into the catch{} below and silently
      // reporting $0 even when the ATA actually holds tokens.
      const info = await connection.getTokenAccountBalance(ata);
      const ui = info.value.uiAmount ?? 0;
      dispatch({ type: "CAPITAL/SET_BALANCE", value: ui });
    } catch {
      // ATA may not exist yet — surface as 0 so the faucet button shows.
      dispatch({ type: "CAPITAL/SET_BALANCE", value: 0 });
    }
  }, [publicKey, connected, connection, dispatch]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  const onClaim = useCallback(async () => {
    if (!publicKey) return;
    dispatch({ type: "CAPITAL/FAUCET_START" });
    try {
      const res = await claimFaucet(publicKey.toBase58());
      // Wait for the mint tx to actually confirm before reading balance.
      // Without this, a single setTimeout(refreshBalance) almost always
      // missed the update on devnet — the user saw $0 indefinitely and
      // the Next button stayed greyed out.
      try {
        await connection.confirmTransaction(res.txSig, "confirmed");
      } catch {
        // confirmTransaction can throw on RPC blip — fall through to the
        // retry-poll which will pick up the balance once it lands.
      }
      // Belt-and-braces: the ATA balance read can lag confirmation by a
      // slot or two. Retry up to 5 times (~10s) and stop as soon as the
      // ≥$50 threshold is met.
      for (let attempt = 0; attempt < 5; attempt++) {
        await refreshBalance();
        // refreshBalance dispatches; pull the latest from the closure via
        // direct ATA read instead of stale state. We re-derive the threshold
        // by reading the same ATA the wizard does.
        try {
          const ata = getAssociatedTokenAddressSync(
            new PublicKey(BUSD_MINT),
            publicKey,
            false,
          );
          const info = await connection.getTokenAccountBalance(ata);
          if ((info.value.uiAmount ?? 0) >= FAUCET_AMOUNT) break;
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      dispatch({
        type: "CAPITAL/FAUCET_DONE",
        txSig: res.txSig,
        error: null,
      });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      // Best-effort: refresh the balance one more time so the cooldown
      // copy can cite the actual amount the user has, not the stale
      // initial-load value.
      await refreshBalance().catch(() => {});
      const have = capital.busdBalance ?? 0;
      let friendly: string;
      if (msg.includes("429") || msg.toLowerCase().includes("cooldown")) {
        friendly =
          have >= FAUCET_AMOUNT
            ? `You've already claimed today — and your wallet already has $${have.toFixed(2)} bUSD. You're good; hit Next.`
            : have > 0
              ? `You've already claimed today. Wallet has $${have.toFixed(2)} bUSD; Step 5 needs at least $${FAUCET_AMOUNT}. Either wait 24h or use the escape hatch below if you have more in another wallet.`
              : "You've already claimed today. Try again in 24 hours, or use the escape hatch below if you already have bUSD in this wallet.";
      } else if (msg.includes("400")) {
        friendly = "Faucet rejected the request. Try reconnecting your wallet.";
      } else if (msg.includes("503")) {
        friendly =
          "Faucet is temporarily unavailable. Try again in a few minutes.";
      } else {
        friendly = `Faucet error: ${msg}`;
      }
      dispatch({
        type: "CAPITAL/FAUCET_DONE",
        txSig: null,
        error: friendly,
      });
    }
  }, [publicKey, dispatch, refreshBalance]);

  const balance = capital.busdBalance ?? 0;
  const fundsOk = balance >= FAUCET_AMOUNT;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Header
        eyebrow="Step 4 / 5"
        title="Seed the agent."
        sub="Every agent needs $50 of bUSD as starting treasury. The faucet mints to YOUR wallet first; the next step has you sign a single transfer that forwards it into the new agent's vault."
      />

      {!connected && (
        <div
          className="card hairline"
          style={{
            padding: 16,
            textAlign: "center",
          }}
        >
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
            Connect a wallet to continue.
          </div>
        </div>
      )}

      {connected && (
        <>
          <div className="card raised" style={{ padding: 16 }}>
            <div className="bd-eyebrow" style={{ marginBottom: 6 }}>
              Wallet bUSD balance
            </div>
            <div
              className="mono"
              style={{
                fontSize: 28,
                fontWeight: 600,
                color: fundsOk ? "var(--gold)" : "var(--fg-2)",
              }}
            >
              {capital.busdBalance == null
                ? "—"
                : `$${capital.busdBalance.toFixed(2)}`}
            </div>
            <div
              className="dim mono-tiny"
              style={{ fontSize: 10.5, marginTop: 6 }}
            >
              {publicKey?.toBase58().slice(0, 8)}…
              {publicKey?.toBase58().slice(-4)} ·{" "}
              {BUSD_DECIMALS} decimals
            </div>
          </div>

          {/* Faucet */}
          <div
            className="card hairline"
            style={{
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  className="mono"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--fg-0)",
                  }}
                >
                  Get $50 bUSD (devnet)
                </div>
                <div className="dim mono-tiny" style={{ fontSize: 10.5 }}>
                  One-shot faucet drip — 24h cooldown.
                </div>
              </div>
              {/* When already funded, swap the faucet button for a live
                  "Deposit →" that just dispatches the wizard's NEXT
                  action — operators consistently asked "if I already
                  have bUSD, why am I clicking faucet?" The actual on-chain
                  deposit_to_vault tx still happens on Step 5 (Review →
                  Launch), but they get one obvious primary action here. */}
              {fundsOk ? (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "NEXT" })}
                  style={primaryBtnStyle({ disabled: false })}
                >
                  Deposit →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClaim}
                  disabled={capital.faucetClaiming}
                  style={primaryBtnStyle({
                    disabled: capital.faucetClaiming,
                  })}
                >
                  {capital.faucetClaiming
                    ? "Claiming + confirming…"
                    : "Claim faucet"}
                </button>
              )}
            </div>
            {capital.faucetClaiming && (
              <div
                className="mono-tiny"
                style={{ fontSize: 10.5, color: "var(--fg-3)" }}
              >
                Waiting for the mint tx to confirm on devnet (~5-15s). Don't
                close this tab.
              </div>
            )}
            {fundsOk && (
              <div
                className="mono-tiny"
                style={{ fontSize: 10.5, color: "var(--green-2)" }}
              >
                ✓ ${balance.toFixed(2)} bUSD detected. Deposit signs a single
                tx forwarding $50 into the agent vault on the next step.
              </div>
            )}
            {capital.faucetTxSig && (
              <a
                href={`https://orbmarkets.io/tx/${capital.faucetTxSig}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                className="mono-tiny gold"
                style={{ fontSize: 10.5, textDecoration: "underline" }}
              >
                View faucet tx ↗
              </a>
            )}
            {capital.faucetError && (
              <div
                className="mono-tiny"
                style={{ color: "var(--red-2)", fontSize: 10.5 }}
              >
                {capital.faucetError}
              </div>
            )}
            {/* Cooldown / faucet-down escape hatch: if the user already has
                bUSD in their wallet, let them skip the faucet and advance
                directly. The balance read on devnet sometimes flakes
                (RPC throttle) and reports 0 even when the ATA holds tokens,
                which is otherwise a dead end — Next stays greyed because
                canAdvance() requires busdBalance >= 50. Clicking this
                forces the wizard to treat capital as funded; if the
                actual ATA balance is short the on-chain deposit_to_vault
                tx on Step 5 will fail with a clear SPL Transfer error. */}
            {capital.faucetError && !fundsOk && (
              <button
                type="button"
                onClick={async () => {
                  await refreshBalance();
                  // Force-advance even if the read still shows < $50:
                  // operator is asserting they have it, and Step 5's
                  // signed deposit will be the ground truth.
                  dispatch({
                    type: "CAPITAL/SET_BALANCE",
                    value: Math.max(capital.busdBalance ?? 0, FAUCET_AMOUNT),
                  });
                }}
                className="mono-tiny"
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  padding: "8px 12px",
                  border: "1px solid var(--gold)",
                  background: "var(--gold-tint)",
                  borderRadius: 8,
                  color: "var(--fg-0)",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                I already have ≥ $50 bUSD — continue to deposit →
              </button>
            )}
          </div>

          {/* Approve & seed status */}
          <div
            className="card inset"
            style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div
              className="mono"
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                color: "var(--fg-3)",
              }}
            >
              Approve & seed
            </div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              {fundsOk
                ? "Funds detected — review the agent on the next step then sign the on-chain init + deposit."
                : "Get to $50 bUSD first — the seed transfer happens on the Review step."}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function primaryBtnStyle({
  disabled,
}: {
  disabled?: boolean;
}): React.CSSProperties {
  return {
    height: 36,
    padding: "0 14px",
    background: disabled ? "var(--bg-3)" : "var(--gold)",
    color: disabled ? "var(--fg-4)" : "#fff",
    border: "1px solid",
    borderColor: disabled ? "var(--line-1)" : "var(--gold)",
    borderRadius: 8,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 160ms ease, color 160ms ease",
  };
}
