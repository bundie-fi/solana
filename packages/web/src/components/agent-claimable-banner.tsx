"use client";

/**
 * AgentClaimableBanner — surfaces unredeemed winnings on resolved markets
 * created by the agent being viewed. Lives on the agent profile page.
 *
 * Why client-side only: the banner is wallet-aware (we need the connected
 * pubkey to derive each ATA), and the agent profile page is otherwise
 * fully SSR. Putting the wallet read in the page would force the whole
 * page client. Instead this component takes the resolved-markets list as
 * a prop (already fetched server-side) and only does the per-wallet
 * balance reads in the browser.
 *
 * Per-market reads run in parallel via Promise.all. With <5 resolved
 * markets per agent on devnet today this is ~one RPC roundtrip; if we
 * ever exceed that we should switch to getMultipleAccountsInfo over the
 * derived ATAs.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { deriveMarketPdas, type MarketView } from "@/lib/markets";
import { PROGRAM_IDS } from "@/lib/constants";

interface Props {
  /** Resolved markets created by the agent being viewed. */
  resolvedMarkets: Pick<MarketView, "address" | "outcome">[];
}

export function AgentClaimableBanner({ resolvedMarkets }: Props) {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const [totalClaimableUsd, setTotalClaimableUsd] = useState<number>(0);
  const [marketsWithClaim, setMarketsWithClaim] = useState<number>(0);

  useEffect(() => {
    if (!connected || !publicKey || resolvedMarkets.length === 0) {
      setTotalClaimableUsd(0);
      setMarketsWithClaim(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const eligible = resolvedMarkets.filter(
        (m) => m.outcome === "yes" || m.outcome === "no",
      );
      const results = await Promise.all(
        eligible.map(async (m) => {
          try {
            const { yesMint, noMint } = deriveMarketPdas(
              PROGRAM_IDS.predictionMarket,
              new PublicKey(m.address),
            );
            const winnerMint = m.outcome === "yes" ? yesMint : noMint;
            const ata = getAssociatedTokenAddressSync(
              winnerMint,
              publicKey,
              false,
            );
            const info = await connection.getTokenAccountBalance(
              ata,
              "confirmed",
            );
            return BigInt(info.value.amount);
          } catch {
            return 0n;
          }
        }),
      );
      if (cancelled) return;
      let totalBase = 0n;
      let count = 0;
      for (const bal of results) {
        if (bal > 0n) {
          totalBase += bal;
          count += 1;
        }
      }
      setTotalClaimableUsd(Number(totalBase) / 1_000_000);
      setMarketsWithClaim(count);
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection, resolvedMarkets]);

  if (!connected || marketsWithClaim === 0 || totalClaimableUsd <= 0) {
    return null;
  }

  return (
    <div style={{ padding: "12px 16px 0" }}>
      <Link
        href="/markets"
        style={{ textDecoration: "none", display: "block" }}
      >
        <div
          className="card"
          style={{
            padding: "11px 14px",
            background: "rgba(167,139,250,0.08)",
            border: "1px solid rgba(167,139,250,0.32)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              className="bd-eyebrow"
              style={{ color: "var(--predict)", fontSize: 9, marginBottom: 2 }}
            >
              Unredeemed winnings
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.35,
                color: "var(--de-ink)",
                fontWeight: 500,
              }}
            >
              Claimable:{" "}
              <span
                className="mono"
                style={{ color: "var(--predict)", fontWeight: 600 }}
              >
                ${totalClaimableUsd.toFixed(2)}
              </span>{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                across {marketsWithClaim}{" "}
                {marketsWithClaim === 1 ? "market" : "markets"}
              </span>
            </div>
          </div>
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--predict)", flexShrink: 0 }}
          >
            view →
          </span>
        </div>
      </Link>
    </div>
  );
}
