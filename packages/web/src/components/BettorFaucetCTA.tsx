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
      toast.success("Claimed $50 bUSD — you're ready to bet.");
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
        gap: 12,
        padding: "10px 12px",
        margin: "12px 0",
        border: "1px solid var(--line-1)",
        borderRadius: 8,
        background: needsMore ? "var(--gold-tint)" : "var(--bg-1)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span className="mono-tiny" style={{ fontSize: 10, color: "var(--fg-3)", letterSpacing: "0.16em" }}>
          BETTING BALANCE
        </span>
        <span className="mono" style={{ fontSize: 14, color: "var(--fg-0)", fontWeight: 600 }}>
          ${balance.toFixed(2)} bUSD
        </span>
      </div>
      <button
        type="button"
        onClick={onClaim}
        disabled={claiming}
        className="mono"
        style={{
          padding: "8px 14px",
          border: "1px solid var(--gold)",
          background: needsMore ? "var(--gold)" : "transparent",
          color: needsMore ? "var(--bg-0)" : "var(--gold)",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          cursor: claiming ? "wait" : "pointer",
          opacity: claiming ? 0.6 : 1,
        }}
      >
        {claiming ? "CLAIMING…" : needsMore ? "CLAIM $50 bUSD" : "+ TOP UP"}
      </button>
    </div>
  );
}
