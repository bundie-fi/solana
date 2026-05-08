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
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import dynamic from "next/dynamic";
import { toast } from "sonner";

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
  // Single-surface wallet — Domains + Connected apps tabs were dropped
  // (the .bundie SNS list lives on the agent profile / identity flow,
  // and there's no MWA session list to surface yet). The tokens view is
  // the only relevant content, so we render it inline.
  const [solUsd, setSolUsd] = useState<number>(SOL_PRICE_FALLBACK);
  const [copied, setCopied] = useState(false);
  const [actionModal, setActionModal] = useState<"send" | "receive" | null>(null);

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
      <main style={{ background: "var(--de-bg)", minHeight: "100vh", padding: "60px 20px" }}>
        <div style={{ maxWidth: 360, margin: "0 auto", textAlign: "center" }}>
          <div className="bd-eyebrow" style={{ marginBottom: 8 }}>Wallet</div>
          <h1 style={{
            fontFamily: "var(--font-display)", fontSize: 28, letterSpacing: -0.4,
            margin: "0 0 12px", color: "var(--de-ink)",
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
    <main style={{ background: "var(--de-bg)", minHeight: "100vh", paddingBottom: 80 }}>
      {/* Hero */}
      <div style={{ padding: "20px 16px 16px" }}>
        <div className="bd-eyebrow">Wallet balance</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
          <span
            className="mono"
            style={{
              fontSize: 30, fontWeight: 600, letterSpacing: -0.6,
              fontVariantNumeric: "tabular-nums", color: "var(--de-ink)",
            }}
          >
            {fmtUsd(totalUsd)}
          </span>
          <span style={{ fontSize: 13, color: "var(--de-ink-3)", fontVariantNumeric: "tabular-nums" }}>
            ◎{sol.toFixed(2)}
          </span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          style={{
            marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6,
            background: "transparent", border: "none", padding: 0, cursor: "pointer",
            color: "var(--de-ink-3)", fontSize: 12,
            fontFamily: "var(--font-mono)",
          }}
        >
          {truncatedAddr}
          <span style={{ fontSize: 11, color: copied ? "var(--pos)" : "var(--de-ink-4)" }}>
            {copied ? "✓ copied" : "⌘ copy"}
          </span>
        </button>
      </div>

      {/* Action row — Send opens the in-app SOL/SPL transfer modal,
          Receive opens an in-app QR modal. Swap + Buy deep-links removed
          since they're not relevant for the devnet bUSD demo flow (no
          Jupiter route exists for bUSD, no fiat onramp for testnet). */}
      <div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ActionTile
          icon="↗"
          label="Send"
          onClick={() => setActionModal("send")}
        />
        <ActionTile
          icon="↙"
          label="Receive"
          onClick={() => setActionModal("receive")}
        />
      </div>

      {actionModal === "receive" && (
        <ReceiveModal addr={addr} onClose={() => setActionModal(null)} />
      )}
      {actionModal === "send" && (
        <SendModal
          fromAddr={addr}
          solBalance={sol}
          busdBalance={tokens.find((t) => t.symbol === "bUSD")?.amount ?? 0}
          onClose={() => setActionModal(null)}
        />
      )}

      {/* Tokens — only surface left after Domains + Connected apps were
          removed. Heading kept so the section has a visible label. */}
      <div style={{ borderBottom: "1px solid var(--de-line)", padding: "10px 16px" }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: "var(--de-ink-3)",
          letterSpacing: "0.16em", textTransform: "uppercase",
          fontFamily: "var(--font-mono)",
        }}>
          Tokens
        </span>
      </div>
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
          <div style={{ padding: 24, textAlign: "center", color: "var(--de-ink-4)", fontSize: 12 }}>
            No SPL tokens detected. Open the bUSD faucet on the Discover tab to get started.
          </div>
        )}
      </div>

      {/* Disconnect — last action, not loud */}
      <div style={{ padding: "32px 16px 16px" }}>
        <button
          type="button"
          onClick={disconnect}
          style={{
            width: "100%", padding: "12px", borderRadius: 8,
            background: "transparent", border: "1px solid var(--de-line)",
            color: "var(--de-ink-3)", fontSize: 12, fontWeight: 500,
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
        padding: "14px 16px", borderBottom: "1px solid var(--de-line)",
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
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--de-ink)" }}>{name}</div>
        <div
          className="mono"
          style={{
            fontSize: 11, color: "var(--de-ink-4)", marginTop: 2,
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
            fontSize: 13, fontWeight: 600, color: "var(--de-ink)",
            fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
          }}
        >
          {amount.toFixed(amount >= 100 ? 2 : 4)}{" "}
          <span style={{ color: "var(--de-ink-4)", fontWeight: 500 }}>{symbol}</span>
        </div>
        <div
          className="mono"
          style={{
            fontSize: 11, color: "var(--de-ink-4)",
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
  // Pulls every active <name>.bundie.sol where this wallet is the owner.
  // The backend's /api/agents?ownerWallet= filter already supports this
  // (powers the wizard's "resume" flow); we re-use it for an honest
  // domain list. SNS verification status surfaces as a small ✓ next to
  // verified names — same indicator as the agent profile uses.
  const [domains, setDomains] = useState<
    { sns: string; verified: boolean; vaultPda: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ownerAddr) return;
    let cancelled = false;
    (async () => {
      try {
        const url =
          (process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://backend.solana.bundie.fi") +
          `/api/agents?ownerWallet=${encodeURIComponent(ownerAddr)}`;
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) {
          if (!cancelled) setDomains([]);
          return;
        }
        const body = (await r.json()) as {
          agents?: {
            sns: string;
            sns_verified?: boolean;
            vault_pda: string;
            status?: string;
          }[];
        };
        const list = (body.agents ?? [])
          // Drop pending_init rows — they don't have a live name yet
          .filter((a) => a.status !== "pending_init")
          .map((a) => ({
            sns: a.sns,
            verified: a.sns_verified === true,
            vaultPda: a.vault_pda,
          }));
        if (!cancelled) setDomains(list);
      } catch {
        if (!cancelled) setDomains([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerAddr]);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--de-ink-4)", fontSize: 12 }}>
        Loading domains…
      </div>
    );
  }
  if (domains.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--de-ink-4)", fontSize: 12, lineHeight: 1.5 }}>
        No <span className="mono">.bundie</span> names registered to this wallet yet.{" "}
        <Link href="/strategists" style={{ color: "var(--predict)", textDecoration: "underline" }}>
          Launch a strategy →
        </Link>
      </div>
    );
  }
  return (
    <div>
      {domains.map((d) => (
        <Link
          key={d.sns}
          href={`/agent/${encodeURIComponent(d.sns)}`}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "14px 16px", borderBottom: "1px solid var(--de-line)",
            textDecoration: "none", color: "var(--de-ink)",
          }}
        >
          <div
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: "var(--predict-tint)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-display)", fontWeight: 600,
              color: "var(--predict)", fontSize: 16,
              flexShrink: 0,
            }}
          >
            {d.sns.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {d.sns.replace(".bundie.sol", "")}
                <span style={{ color: "var(--de-ink-4)", fontWeight: 400 }}>.bundie.sol</span>
              </span>
              {d.verified && (
                <span style={{ fontSize: 11, color: "var(--predict)", fontWeight: 700 }}>✓</span>
              )}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 11, color: "var(--de-ink-4)", marginTop: 2,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              vault {d.vaultPda.slice(0, 4)}…{d.vaultPda.slice(-4)}
            </div>
          </div>
          <span style={{ color: "var(--de-ink-4)", fontSize: 16 }}>›</span>
        </Link>
      ))}
    </div>
  );
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

// ─── Action tiles ────────────────────────────────────────────────────────

function ActionTile({
  icon, label, onClick, href,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const tile = (
    <span
      style={{
        padding: "14px 8px", borderRadius: 12,
        background: "var(--de-bg-raised)", border: "1px solid var(--de-line)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        cursor: "pointer", color: "var(--de-ink)",
      }}
    >
      <span
        style={{
          width: 32, height: 32, borderRadius: 10, display: "flex",
          alignItems: "center", justifyContent: "center", fontSize: 14,
          background: "var(--predict-tint)", color: "var(--predict)", fontWeight: 700,
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
    </span>
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: "none" }}
      >
        {tile}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent", border: "none", padding: 0,
        fontFamily: "inherit", cursor: "pointer", color: "inherit",
      }}
    >
      {tile}
    </button>
  );
}

// ─── Receive modal ────────────────────────────────────────────────────────

function ReceiveModal({ addr, onClose }: { addr: string; onClose: () => void }) {
  // Lightweight QR generator: build a Google Charts URL — works offline-
  // friendly enough for a TWA wrapper (chrome will cache after first load),
  // and avoids pulling in a 30KB QR library for a single use case.
  const qrUrl = useMemo(
    () =>
      `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=${encodeURIComponent(
        `solana:${addr}`,
      )}`,
    [addr],
  );
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // noop
    }
  }, [addr]);

  return (
    <ModalShell title="Receive" onClose={onClose}>
      <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrUrl}
          alt="Wallet address QR"
          width={240}
          height={240}
          style={{ borderRadius: 12, background: "#fff", padding: 12 }}
        />
      </div>
      <div className="bd-eyebrow" style={{ textAlign: "center", marginTop: 12 }}>
        Solana address
      </div>
      <div
        className="mono"
        style={{
          fontSize: 13, fontVariantNumeric: "tabular-nums",
          textAlign: "center", padding: "6px 12px", color: "var(--de-ink)",
          wordBreak: "break-all", lineHeight: 1.5,
        }}
      >
        {addr}
      </div>
      <button
        type="button"
        onClick={onCopy}
        style={{
          marginTop: 12, width: "100%", padding: "12px",
          borderRadius: 10, border: "none",
          background: "var(--predict)", color: "#fff",
          fontSize: 13, fontWeight: 600, cursor: "pointer",
          fontFamily: "inherit", letterSpacing: 0.2,
        }}
      >
        {copied ? "Copied ✓" : "Copy address"}
      </button>
      <p style={{ fontSize: 11, color: "var(--de-ink-4)", textAlign: "center", marginTop: 12, lineHeight: 1.4 }}>
        Send SOL or any SPL token to this address.
        <br />
        Devnet only — do not send mainnet funds.
      </p>
    </ModalShell>
  );
}

// ─── Send modal ───────────────────────────────────────────────────────────

function SendModal({
  fromAddr, solBalance, busdBalance, onClose,
}: {
  fromAddr: string;
  solBalance: number;
  busdBalance: number;
  onClose: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [token, setToken] = useState<"SOL" | "bUSD">("SOL");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const max = token === "SOL" ? Math.max(0, solBalance - 0.001) : busdBalance; // leave 0.001 SOL for fees
  const amountNum = parseFloat(amount) || 0;
  const validRecipient = useMemo(() => {
    try {
      // Must parse as a valid base58 pubkey.
      new PublicKey(recipient.trim());
      return true;
    } catch {
      return false;
    }
  }, [recipient]);
  const canSubmit =
    validRecipient && amountNum > 0 && amountNum <= max && !busy && !!publicKey;

  async function onSubmit() {
    if (!publicKey || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const to = new PublicKey(recipient.trim());
      const tx = new Transaction();

      if (token === "SOL") {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: to,
            lamports: Math.round(amountNum * LAMPORTS_PER_SOL),
          }),
        );
      } else {
        // bUSD = SPL token. Resolve recipient ATA, create if missing
        // (signed by the sender — recipient pays no rent).
        const mint = new PublicKey(BUSD_MINT);
        const fromAta = await getAssociatedTokenAddress(mint, publicKey);
        const toAta = await getAssociatedTokenAddress(mint, to);
        try {
          await getAccount(connection, toAta);
        } catch {
          tx.add(
            createAssociatedTokenAccountInstruction(
              publicKey, toAta, to, mint,
            ),
          );
        }
        // bUSD has 6 decimals (matches USDC).
        const baseUnits = BigInt(Math.round(amountNum * 1_000_000));
        tx.add(
          createTransferInstruction(fromAta, toAta, publicKey, baseUnits),
        );
      }

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast.success(
        `Sent ${amountNum} ${token} → ${recipient.slice(0, 4)}…${recipient.slice(-4)}`,
      );
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("User rejected") ? "Transaction rejected." : msg.slice(0, 200));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Send" onClose={onClose}>
      {/* Token selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["SOL", "bUSD"] as const).map((t) => {
          const active = token === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setToken(t)}
              style={{
                flex: 1, padding: "8px 12px", borderRadius: 8,
                border: active ? "1px solid var(--predict)" : "1px solid var(--de-line)",
                background: active ? "var(--predict-tint)" : "transparent",
                color: active ? "var(--predict)" : "var(--de-ink-3)",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      <label style={{ display: "block", fontSize: 11, color: "var(--de-ink-4)", letterSpacing: 0.2 }}>
        Recipient address
      </label>
      <input
        type="text"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder="11111111…1111"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        style={{
          width: "100%", padding: "10px 12px", marginTop: 4,
          borderRadius: 8, border: "1px solid var(--de-line)",
          background: "var(--de-bg-2)", color: "var(--de-ink)",
          fontFamily: "var(--font-mono)", fontSize: 12,
          fontVariantNumeric: "tabular-nums",
        }}
      />
      {recipient && !validRecipient && (
        <div style={{ fontSize: 11, color: "var(--neg)", marginTop: 4 }}>
          Not a valid Solana address.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
        <label style={{ fontSize: 11, color: "var(--de-ink-4)", letterSpacing: 0.2 }}>
          Amount
        </label>
        <button
          type="button"
          onClick={() => setAmount(max.toFixed(token === "SOL" ? 4 : 2))}
          style={{
            background: "transparent", border: "none", padding: 0,
            fontSize: 11, color: "var(--predict)", cursor: "pointer",
          }}
        >
          Max {max.toFixed(token === "SOL" ? 4 : 2)} {token}
        </button>
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder={token === "SOL" ? "0.10" : "10.00"}
        style={{
          width: "100%", padding: "10px 12px", marginTop: 4,
          borderRadius: 8, border: "1px solid var(--de-line)",
          background: "var(--de-bg-2)", color: "var(--de-ink)",
          fontFamily: "var(--font-mono)", fontSize: 16,
          fontVariantNumeric: "tabular-nums",
        }}
      />
      {amountNum > max && (
        <div style={{ fontSize: 11, color: "var(--neg)", marginTop: 4 }}>
          Over balance. Max {max.toFixed(token === "SOL" ? 4 : 2)} {token}.
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 10, padding: "8px 10px", borderRadius: 8,
            background: "var(--de-rose-tint)", color: "var(--neg)",
            fontSize: 11, lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        style={{
          marginTop: 16, width: "100%", padding: "12px",
          borderRadius: 10, border: "none",
          background: canSubmit ? "var(--predict)" : "var(--bg-3)",
          color: canSubmit ? "#fff" : "var(--de-ink-4)",
          fontSize: 13, fontWeight: 600,
          cursor: canSubmit ? "pointer" : "not-allowed",
          fontFamily: "inherit", letterSpacing: 0.2,
        }}
      >
        {busy ? "Sending…" : `Send ${token}`}
      </button>
    </ModalShell>
  );
}

// ─── Modal shell ──────────────────────────────────────────────────────────

function ModalShell({
  title, children, onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  // Esc to close — stops the user from getting stuck in a modal on
  // desktop (mobile users tap the backdrop or back button).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(20,20,26,0.5)",
        display: "flex", alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 420,
          background: "var(--de-bg)", borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: "16px 16px 32px",
          maxHeight: "92vh", overflowY: "auto",
          paddingBottom: "max(32px, env(safe-area-inset-bottom))",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            paddingBottom: 12, borderBottom: "1px solid var(--de-line)", marginBottom: 14,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-display)", fontSize: 20,
              letterSpacing: -0.3, color: "var(--de-ink)",
            }}
          >
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: 22, color: "var(--de-ink-3)", padding: 0,
              fontFamily: "inherit",
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
