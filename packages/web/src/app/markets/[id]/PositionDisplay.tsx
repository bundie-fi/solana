"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PREDICTION_PROGRAM_ID ??
    "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);

interface PositionDisplayProps {
  marketAddress?: string;
}

interface Balances {
  yes: number;
  no: number;
}

/**
 * PositionDisplay — thin position strip designed to sit BELOW TradeButtons
 * inside the same panel. Visually a continuation of the trade action, not a
 * separate card. Empty state is intentionally quiet (the user hasn't traded
 * yet, no need to shout "no position").
 */
export function PositionDisplay({ marketAddress }: PositionDisplayProps) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [balances, setBalances] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!marketAddress || !connected || !publicKey) {
      setBalances(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const market = new PublicKey(marketAddress);
        const [yesMint] = PublicKey.findProgramAddressSync(
          [Buffer.from("yes_mint"), market.toBuffer()],
          PROGRAM_ID,
        );
        const [noMint] = PublicKey.findProgramAddressSync(
          [Buffer.from("no_mint"), market.toBuffer()],
          PROGRAM_ID,
        );
        const yesAta = await getAssociatedTokenAddress(yesMint, publicKey);
        const noAta = await getAssociatedTokenAddress(noMint, publicKey);

        const [yesAccount, noAccount] = await Promise.all([
          getAccount(connection, yesAta).catch(() => null),
          getAccount(connection, noAta).catch(() => null),
        ]);
        if (cancelled) return;
        setBalances({
          yes: yesAccount ? Number(yesAccount.amount) / 1_000_000 : 0,
          no: noAccount ? Number(noAccount.amount) / 1_000_000 : 0,
        });
      } catch (err) {
        if (!cancelled) {
          console.warn(`[position-display] ${(err as Error).message}`);
          setBalances({ yes: 0, no: 0 });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, connected, marketAddress]);

  if (!connected || !marketAddress) return null;

  const hasPosition = balances && (balances.yes > 0 || balances.no > 0);

  // Layout: a thin horizontal strip. Inline with TradeButtons by wrapping
  // them in a shared border in the page composition.
  return (
    <div
      className="border-t border-[var(--de-line)] px-6 py-3"
      aria-label="Your position"
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          Your position
        </p>
        {loading ? (
          <div className="flex items-baseline gap-3" aria-hidden="true">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-12" />
          </div>
        ) : hasPosition ? (
          <div className="flex items-baseline gap-4 font-mono text-sm tabular-nums">
            <span className="text-[var(--de-mint)]">
              {balances!.yes.toFixed(2)}
              <span className="ml-1 text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
                YES
              </span>
            </span>
            <span className="text-[var(--de-rose)]">
              {balances!.no.toFixed(2)}
              <span className="ml-1 text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
                NO
              </span>
            </span>
          </div>
        ) : (
          <p className="font-mono text-[11px] text-[var(--de-ink-4)]">
            First trade opens a position
          </p>
        )}
      </div>
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-pulse rounded bg-[var(--de-bg-3)] ${className}`}
    />
  );
}
