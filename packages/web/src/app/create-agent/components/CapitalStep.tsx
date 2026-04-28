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
    if (!publicKey || !connected || BUSD_MINT === "REPLACE_AFTER_SETUP") {
      dispatch({ type: "CAPITAL/SET_BALANCE", value: null });
      return;
    }
    try {
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(BUSD_MINT),
        publicKey,
        false,
      );
      const info = await connection.getTokenAccountBalance(ata, "confirmed");
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
          const info = await connection.getTokenAccountBalance(
            ata,
            "confirmed",
          );
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
      let friendly: string;
      if (msg.includes("429") || msg.toLowerCase().includes("cooldown")) {
        friendly =
          "You've already claimed today. Try again in 24 hours, or use existing bUSD in your wallet.";
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
              <button
                type="button"
                onClick={onClaim}
                disabled={capital.faucetClaiming || fundsOk}
                style={primaryBtnStyle({
                  disabled: capital.faucetClaiming || fundsOk,
                })}
              >
                {capital.faucetClaiming
                  ? "Claiming + confirming…"
                  : fundsOk
                    ? "Already funded"
                    : "Claim faucet"}
              </button>
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
                ✓ Funded. Hit Next — Step 5 has you sign the transfer that
                forwards this $50 into the agent vault.
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
