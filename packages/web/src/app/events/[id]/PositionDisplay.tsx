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

  const hasPosition =
    balances && (balances.yes > 0 || balances.no > 0);

  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6">
        <div className="text-xs uppercase tracking-wider text-[var(--de-ink-3)]">
          Your position
        </div>
        <div className="mt-2 font-mono text-sm text-[var(--de-ink-4)]">
          Loading…
        </div>
      </div>
    );
  }

  if (!hasPosition) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6">
        <div className="text-xs uppercase tracking-wider text-[var(--de-ink-3)]">
          Your position
        </div>
        <div className="mt-2 text-sm text-[var(--de-ink-2)]">
          No YES or NO shares yet for this market.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6">
      <div className="mb-3 text-xs uppercase tracking-wider text-[var(--de-ink-3)]">
        Your position
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
            YES
          </div>
          <div className="font-mono text-2xl tabular-nums text-[var(--de-mint)]">
            {balances!.yes.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
            NO
          </div>
          <div className="font-mono text-2xl tabular-nums text-[var(--de-lavender)]">
            {balances!.no.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
