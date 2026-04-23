"use client";

import { useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SnsName } from "@/components/SnsName";
import { lookupSnsForAddress } from "@/lib/sns";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

interface TokenAccount {
  mint: string;
  balance: number;
  decimals: number;
  uiAmount: string;
}

export default function PortfolioPage() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenAccounts, setTokenAccounts] = useState<TokenAccount[]>([]);
  const [loading, setLoading] = useState(false);
  // SNS reverse lookup for the connected wallet — surfaces the user's
  // `<name>.sol` as the page title when one is set. Falls back to the
  // generic "Your positions" header when null.
  const [ownerSns, setOwnerSns] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setOwnerSns(null);
      return;
    }
    let cancelled = false;
    lookupSnsForAddress(publicKey.toBase58())
      .then((n) => {
        if (!cancelled) setOwnerSns(n);
      })
      .catch(() => {
        if (!cancelled) setOwnerSns(null);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey || !connected) {
      setSolBalance(null);
      setTokenAccounts([]);
      return;
    }

    let cancelled = false;

    async function loadPortfolio() {
      if (!publicKey) return;
      setLoading(true);
      try {
        const [lamports, tokenRes] = await Promise.all([
          connection.getBalance(publicKey, "confirmed"),
          connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: TOKEN_PROGRAM_ID,
          }),
        ]);

        if (cancelled) return;

        setSolBalance(lamports / LAMPORTS_PER_SOL);

        const accounts: TokenAccount[] = tokenRes.value
          .map((ta) => {
            const info = ta.account.data.parsed?.info;
            const amount: number = info?.tokenAmount?.uiAmount ?? 0;
            if (amount <= 0) return null;
            return {
              mint: info?.mint ?? "unknown",
              balance: amount,
              decimals: info?.tokenAmount?.decimals ?? 0,
              uiAmount: info?.tokenAmount?.uiAmountString ?? "0",
            } as TokenAccount;
          })
          .filter((a): a is TokenAccount => a !== null)
          .sort((a, b) => b.balance - a.balance);

        setTokenAccounts(accounts);
      } catch (err) {
        console.error("Portfolio load error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPortfolio();
    return () => { cancelled = true; };
  }, [publicKey, connected, connection]);

  if (!connected) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400">
          Portfolio
        </span>
        <h1 className="font-serif text-display text-neutral-900 mt-1 mb-2">
          Your <em className="text-amber-400">positions</em>.
        </h1>
        <p className="text-neutral-700 mb-8">Strategy shares and prediction tokens.</p>
        <div className="rounded-xl border border-neutral-300 bg-surface p-12 flex flex-col items-center gap-4">
          <p className="text-neutral-700 text-sm">Connect your wallet to view your portfolio</p>
          <WalletMultiButton
            style={{
              background: "rgba(109,40,217,0.18)",
              border: "1px solid rgba(109,40,217,0.4)",
              borderRadius: "10px",
              color: "#b691f1",
              fontSize: "14px",
              height: "42px",
              padding: "0 20px",
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400">
        Portfolio
      </span>
      <h1 className="font-serif text-display text-neutral-900 mt-1 mb-2">
        {ownerSns ? (
          <>
            <em className="text-amber-400">{ownerSns}</em>&apos;s positions.
          </>
        ) : (
          <>
            Your <em className="text-amber-400">positions</em>.
          </>
        )}
      </h1>
      <p className="text-neutral-700 mb-8">
        {ownerSns
          ? "Strategy shares and prediction tokens for this identity."
          : "Strategy shares and prediction tokens."}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {/* SOL Balance */}
        <div className="rounded-xl border border-neutral-300 bg-surface p-5">
          <p className="text-xs text-neutral-600 uppercase tracking-wider mb-1">SOL Balance</p>
          {loading ? (
            <div className="h-7 w-24 rounded bg-neutral-200 animate-pulse" />
          ) : (
            <p className="text-2xl font-bold text-neutral-900">
              {solBalance !== null ? solBalance.toFixed(4) : "—"}
              <span className="text-sm text-neutral-600 font-normal ml-1">SOL</span>
            </p>
          )}
          <p className="text-xs text-neutral-500 mt-1 font-mono truncate">
            {publicKey ? (
              <SnsName addr={publicKey.toBase58()} head={6} tail={6} />
            ) : null}
          </p>
        </div>

        {/* Token accounts count */}
        <div className="rounded-xl border border-neutral-300 bg-surface p-5">
          <p className="text-xs text-neutral-600 uppercase tracking-wider mb-1">Token Holdings</p>
          {loading ? (
            <div className="h-7 w-16 rounded bg-neutral-200 animate-pulse" />
          ) : (
            <p className="text-2xl font-bold text-neutral-900">
              {tokenAccounts.length}
              <span className="text-sm text-neutral-600 font-normal ml-1">accounts</span>
            </p>
          )}
          <p className="text-xs text-neutral-500 mt-1">Strategy shares &amp; prediction tokens</p>
        </div>
      </div>

      {/* Strategy Holdings */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-earn-gold" />
          <h2 className="text-sm font-medium text-earn-gold uppercase tracking-wider">
            Strategy Holdings
          </h2>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-surface border border-neutral-300 animate-pulse" />
            ))}
          </div>
        ) : tokenAccounts.length === 0 ? (
          <div className="rounded-xl border border-neutral-300 bg-surface p-8 text-center">
            <p className="text-neutral-600 text-sm">No token holdings found</p>
            <p className="text-neutral-500 text-xs mt-1">
              Invest in a strategy to see your shares here
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-300 bg-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-300">
                  <th className="text-left text-xs text-neutral-600 font-medium px-4 py-3 uppercase tracking-wider">
                    Mint
                  </th>
                  <th className="text-right text-xs text-neutral-600 font-medium px-4 py-3 uppercase tracking-wider">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {tokenAccounts.map((ta, i) => (
                  <tr
                    key={ta.mint}
                    className={`${
                      i < tokenAccounts.length - 1 ? "border-b border-neutral-300" : ""
                    } hover:bg-neutral-200 transition-colors`}
                  >
                    <td className="px-4 py-3">
                      <a
                        href={`https://orbmarkets.io/address/${ta.mint}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-neutral-800 hover:text-predict-purple transition-colors"
                      >
                        {ta.mint.slice(0, 8)}…{ta.mint.slice(-6)}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-neutral-900 font-semibold font-mono">
                        {ta.uiAmount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Prediction Positions — coming soon */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-predict-purple" />
          <h2 className="text-sm font-medium text-predict-purple uppercase tracking-wider">
            Your Predictions
          </h2>
        </div>
        <div className="rounded-xl border border-neutral-300 bg-surface p-8 text-center">
          <p className="text-neutral-600 text-sm">Coming soon</p>
          <p className="text-neutral-500 text-xs mt-1">
            Open prediction positions with P&amp;L will appear here
          </p>
        </div>
      </section>
    </main>
  );
}
