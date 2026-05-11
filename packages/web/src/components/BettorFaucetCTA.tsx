"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { toast } from "sonner";
import { BUSD_MINT } from "@bundie/common";
import { claimFaucet } from "@/app/strategists/lib/api";

/**
 * Lightweight bUSD-balance + claim widget for bettors on /markets and
 * /market/:id. Exists so a user who wants to predict (but not launch
 * an agent) doesn't have to walk through the full wizard just to get
 * collateral. Hides itself entirely while the wallet is disconnected
 * — the empty hero already nudges visitors to connect.
 */
export function BettorFaucetCTA() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = useState<number | null>(null);
  const [claiming, setClaiming] = useState(false);

  const refresh = useCallback(async () => {
    if (!publicKey || !connected) {
      setBalance(null);
      return;
    }
    try {
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(BUSD_MINT),
        publicKey,
        false,
      );
      const info = await connection.getTokenAccountBalance(ata);
      setBalance(info.value.uiAmount ?? 0);
    } catch {
      // ATA missing → 0 (faucet creates it on first claim).
      setBalance(0);
    }
  }, [publicKey, connected, connection]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onClaim = useCallback(async () => {
    if (!publicKey) return;
    setClaiming(true);
    try {
      await claimFaucet(publicKey.toBase58());
      // Confirmation already happens server-side; give the RPC a moment
      // to ingest the mint then reread.
      await new Promise((r) => setTimeout(r, 1500));
      await refresh();
      toast.success("Claimed $100 bUSD — you're ready to bet.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.includes("429") ? "Faucet busy, try again in a moment." : `Faucet error: ${msg}`);
    } finally {
      setClaiming(false);
    }
  }, [publicKey, refresh]);

  if (!connected) return null;
  if (balance == null) return null; // first paint

  const needsMore = balance < 50;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "18px 22px",
        margin: "20px 0 4px",
        border: "1px solid var(--de-line)",
        borderLeft: needsMore
          ? "2px solid var(--de-lavender)"
          : "1px solid var(--de-line)",
        background: needsMore
          ? "linear-gradient(90deg, rgba(168,153,245,0.08), rgba(168,153,245,0.02) 60%, transparent)"
          : "var(--de-bg-raised)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 10,
            fontWeight: 700,
            color: needsMore ? "var(--de-lavender)" : "var(--de-ink-4)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          Betting Balance
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 26,
              lineHeight: 1,
              color: "var(--de-ink)",
              letterSpacing: "-0.02em",
            }}
          >
            ${balance.toFixed(2)}
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--de-ink-3)",
                letterSpacing: "0.12em",
                marginLeft: 8,
                textTransform: "uppercase",
              }}
            >
              bUSD
            </span>
          </span>
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              color: "var(--de-ink-3)",
              fontStyle: "italic",
            }}
          >
            {needsMore
              ? "Claim devnet bUSD to start betting on agent outcomes."
              : "Plenty in the tank. Top up any time."}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onClaim}
        disabled={claiming}
        style={{
          flexShrink: 0,
          padding: "12px 22px",
          border: "1px solid var(--de-lavender)",
          background: needsMore ? "var(--de-lavender)" : "transparent",
          color: needsMore ? "var(--de-bg)" : "var(--de-lavender)",
          fontFamily: "var(--font-sans)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          cursor: claiming ? "wait" : "pointer",
          opacity: claiming ? 0.6 : 1,
          transition: "background 160ms ease, color 160ms ease",
        }}
      >
        {claiming ? "Claiming…" : needsMore ? "Claim $100 bUSD" : "+ Top up"}
      </button>
    </div>
  );
}
