"use client";

/**
 * /wallet — connected-wallet hub.
 *
 * Hero: SOL + bUSD balance summary (USD-equivalent), truncated address
 * with copy. ActionRow: Send · Receive · Swap · Buy. Tabs: Tokens (live
 * SPL token balances), Domains (.bundie SNS list), Connected apps
 * (placeholder for the future MWA session list).
 *
 * Reads live state from wallet-adapter. No auto-poll — re-renders on
 * connection events. SOL price is fetched from Pyth; bUSD is treated as
 * USD-pegged (matches treasury sync semantics).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import dynamic from "next/dynamic";

const WalletButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

const BUSD_MINT =
  process.env.NEXT_PUBLIC_BUSD_MINT ?? "Bbusd1111111111111111111111111111111111112";

interface TokenBalance {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  decimals: number;
  usdValue: number | null;
  change24Pct: number | null;
}

const SOL_PRICE_FALLBACK = 180;

export default function WalletPage() {
  const { publicKey, connected, disconnect } = useWallet();
  const { connection } = useConnection();

  const [solLamports, setSolLamports] = useState<number | null>(null);
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [tab, setTab] = useState<"tokens" | "domains" | "apps">("tokens");
  const [solUsd, setSolUsd] = useState<number>(SOL_PRICE_FALLBACK);
  const [copied, setCopied] = useState(false);

  // Live SOL balance + token accounts
  useEffect(() => {
    if (!publicKey || !connected) return;
    let cancelled = false;
    (async () => {
      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        if (!cancelled) setSolLamports(lamports);
      } catch {
        if (!cancelled) setSolLamports(0);
      }

      try {
        const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: TOKEN_PROGRAM_ID,
        });
        const fromChain: TokenBalance[] = accounts.value
          .map((a) => {
            const info = a.account.data.parsed.info;
            const amt = Number(info.tokenAmount.uiAmount ?? 0);
            const mint: string = info.mint;
            const decimals: number = info.tokenAmount.decimals;
            const isBusd = mint === BUSD_MINT;
            return {
              mint,
              symbol: isBusd ? "bUSD" : `${mint.slice(0, 4)}…`,
              name: isBusd ? "Bundie USD" : "SPL Token",
              amount: amt,
              decimals,
              usdValue: isBusd ? amt : null,
              change24Pct: null,
            };
          })
          .filter((t) => t.amount > 0);
        if (!cancelled) setTokens(fromChain);
      } catch {
        if (!cancelled) setTokens([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, connected, connection]);

  // SOL price — best-effort, falls back to a static ref. Pyth is
  // server-side in this codebase; for the demo, a static is fine — the
  // wallet hero is approximate by definition.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          "https://price.jup.ag/v4/price?ids=SOL",
          { cache: "no-store" },
        );
        const j = await r.json();
        const p = j?.data?.SOL?.price;
        if (typeof p === "number" && p > 0 && !cancelled) setSolUsd(p);
      } catch {
        // keep fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sol = solLamports != null ? solLamports / LAMPORTS_PER_SOL : 0;
  const solUsdValue = sol * solUsd;
  const tokensUsd = tokens.reduce((s, t) => s + (t.usdValue ?? 0), 0);
  const totalUsd = solUsdValue + tokensUsd;
  const addr = publicKey?.toBase58() ?? "";
  const truncatedAddr = addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "";

  const onCopy = useCallback(async () => {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // noop
    }
  }, [addr]);

  if (!connected || !publicKey) {
    return (
      <main style={{ background: "var(--bg-0)", minHeight: "100vh", padding: "60px 20px" }}>
        <div style={{ maxWidth: 360, margin: "0 auto", textAlign: "center" }}>
          <div className="bd-eyebrow" style={{ marginBottom: 8 }}>Wallet</div>
          <h1 style={{
            fontFamily: "var(--font-display)", fontSize: 28, letterSpacing: -0.4,
            margin: "0 0 12px", color: "var(--fg-0)",
          }}>
            Connect to view your wallet
          </h1>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 24 }}>
            Bundie reads your SOL + bUSD balance directly from devnet — nothing leaves
            your device.
          </p>
          <WalletButton />
        </div>
      </main>
    );
  }

  return (
    <main style={{ background: "var(--bg-0)", minHeight: "100vh", paddingBottom: 80 }}>
      {/* Hero */}
      <div style={{ padding: "20px 16px 16px" }}>
        <div className="bd-eyebrow">Wallet balance</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
          <span
            className="mono"
            style={{
              fontSize: 30, fontWeight: 600, letterSpacing: -0.6,
              fontVariantNumeric: "tabular-nums", color: "var(--fg-0)",
            }}
          >
            {fmtUsd(totalUsd)}
          </span>
          <span style={{ fontSize: 13, color: "var(--fg-3)", fontVariantNumeric: "tabular-nums" }}>
            ◎{sol.toFixed(2)}
          </span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          style={{
            marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6,
            background: "transparent", border: "none", padding: 0, cursor: "pointer",
            color: "var(--fg-3)", fontSize: 12,
            fontFamily: "var(--font-mono)",
          }}
        >
          {truncatedAddr}
          <span style={{ fontSize: 11, color: copied ? "var(--pos)" : "var(--fg-4)" }}>
            {copied ? "✓ copied" : "⌘ copy"}
          </span>
        </button>
      </div>

      {/* Action row */}
      <div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        {[
          { id: "send",    label: "Send",    icon: "↗" },
          { id: "receive", label: "Receive", icon: "↙" },
          { id: "swap",    label: "Swap",    icon: "⇆" },
          { id: "buy",     label: "Buy",     icon: "$" },
        ].map((a) => (
          <button
            key={a.id}
            type="button"
            disabled
            title="Coming soon"
            style={{
              padding: "14px 8px", borderRadius: 12,
              background: "var(--bg-1)", border: "1px solid var(--line-1)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              cursor: "not-allowed", fontFamily: "inherit", color: "var(--fg-1)",
              opacity: 0.92,
            }}
          >
            <span
              style={{
                width: 32, height: 32, borderRadius: 10, display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 14,
                background: "var(--predict-tint)", color: "var(--predict)", fontWeight: 700,
              }}
            >
              {a.icon}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600 }}>{a.label}</span>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--line-1)", padding: "0 16px", gap: 20 }}>
        {(
          [
            { id: "tokens",  label: "Tokens" },
            { id: "domains", label: "Domains" },
            { id: "apps",    label: "Connected apps" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 0", border: "none", background: "transparent",
              color: tab === t.id ? "var(--fg-0)" : "var(--fg-4)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              borderBottom: tab === t.id ? "2px solid var(--predict)" : "2px solid transparent",
              marginBottom: -1, fontFamily: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "tokens" && (
        <div>
          <TokenRow symbol="SOL" name="Solana" amount={sol} usdValue={solUsdValue} change={null} bg="#000" fg="#fff" />
          {tokens.map((t) => (
            <TokenRow
              key={t.mint}
              symbol={t.symbol}
              name={t.name}
              amount={t.amount}
              usdValue={t.usdValue}
              change={t.change24Pct}
              bg="var(--predict-tint)"
              fg="var(--predict)"
            />
          ))}
          {tokens.length === 0 && solLamports != null && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-4)", fontSize: 12 }}>
              No SPL tokens detected. Open the bUSD faucet on the Discover tab to get started.
            </div>
          )}
        </div>
      )}

      {tab === "domains" && (
        <DomainsList ownerAddr={addr} />
      )}

      {tab === "apps" && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--fg-4)", fontSize: 12, lineHeight: 1.5 }}>
          Mobile Wallet Adapter sessions appear here once you authorize a Bundie
          interaction inside the TWA. Nothing connected yet.
        </div>
      )}

      {/* Disconnect — last action, not loud */}
      <div style={{ padding: "32px 16px 16px" }}>
        <button
          type="button"
          onClick={disconnect}
          style={{
            width: "100%", padding: "12px", borderRadius: 8,
            background: "transparent", border: "1px solid var(--line-1)",
            color: "var(--fg-3)", fontSize: 12, fontWeight: 500,
            letterSpacing: 0.2, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Disconnect wallet
        </button>
      </div>
    </main>
  );
}

function TokenRow({
  symbol, name, amount, usdValue, change, bg, fg,
}: {
  symbol: string; name: string; amount: number;
  usdValue: number | null; change: number | null;
  bg: string; fg: string;
}) {
  const pos = change != null ? change >= 0 : null;
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", borderBottom: "1px solid var(--line-1)",
      }}
    >
      <div
        style={{
          width: 36, height: 36, borderRadius: 999,
          background: bg, color: fg,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, letterSpacing: -0.3,
          flexShrink: 0,
        }}
      >
        {symbol.slice(0, 4)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg-0)" }}>{name}</div>
        <div
          className="mono"
          style={{
            fontSize: 11, color: "var(--fg-4)", marginTop: 2,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          {symbol}
          {change != null && pos != null && (
            <span style={{ color: pos ? "var(--pos)" : "var(--neg)", marginLeft: 6 }}>
              {pos ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div
          className="mono"
          style={{
            fontSize: 13, fontWeight: 600, color: "var(--fg-0)",
            fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
          }}
        >
          {amount.toFixed(amount >= 100 ? 2 : 4)}{" "}
          <span style={{ color: "var(--fg-4)", fontWeight: 500 }}>{symbol}</span>
        </div>
        <div
          className="mono"
          style={{
            fontSize: 11, color: "var(--fg-4)",
            fontVariantNumeric: "tabular-nums", marginTop: 2, whiteSpace: "nowrap",
          }}
        >
          {usdValue != null ? fmtUsd(usdValue) : "—"}
        </div>
      </div>
    </div>
  );
}

function DomainsList({ ownerAddr }: { ownerAddr: string }) {
  // No client-side SNS resolver wired today — keep this honest. The
  // backend `/api/agents` already filters by owner_wallet, but it's
  // strategy-scoped, not personal SNS. Surface a Telegram-style empty
  // state and a deep link to /strategists where the user actually claims
  // a name.
  if (!ownerAddr) return null;
  return (
    <div style={{ padding: 24, textAlign: "center", color: "var(--fg-4)", fontSize: 12, lineHeight: 1.5 }}>
      .bundie names you own appear here. The launch wizard claims a
      name on first run —{" "}
      <Link href="/strategists" style={{ color: "var(--predict)", textDecoration: "underline" }}>
        launch a strategy →
      </Link>
    </div>
  );
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}
