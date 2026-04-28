"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (m) => m.WalletMultiButton,
    ),
  { ssr: false },
);

const LINKS: { href: string; label: string; activePrefix?: string }[] = [
  { href: "/",          label: "Feed" },
  { href: "/markets",   label: "Markets" },
  { href: "/agents",    label: "Agents", activePrefix: "/agent" },
  { href: "/portfolio", label: "Portfolio" },
];

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Top navigation, desktop only (hidden on mobile where BottomNav is used).
 * Active-link styling uses the gold accent + bottom border, mirroring Aqua0's
 * pattern but adapted to the Bundie paper theme.
 */
export function TopNav() {
  const pathname = usePathname();
  const { publicKey, connected } = useWallet();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px 10px",
        background: "rgba(244,241,234,0.92)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--line-1)",
        position: "sticky",
        top: 0,
        zIndex: 30,
      }}
    >
      {/* Brand + live dot */}
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/favicon-32.png" alt="Bundie" style={{ width: 24, height: 24 }} />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            color: "var(--fg-0)",
            letterSpacing: "-0.03em",
          }}
        >
          Bund<span style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>ie</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="pulse-dot" />
          <span
            className="mono-tiny"
            style={{ color: "var(--green-2)", letterSpacing: "0.16em", fontSize: 10 }}
          >
            LIVE
          </span>
        </span>
      </Link>

      {/* Nav links */}
      <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {LINKS.map((l) => {
          const matchPrefix = l.activePrefix ?? l.href;
          const active =
            pathname === l.href ||
            (l.href !== "/" && pathname?.startsWith(matchPrefix));
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                height: 36,
                padding: "0 14px",
                borderRadius: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                textDecoration: "none",
                color: active ? "var(--gold)" : "var(--fg-3)",
                background: active ? "var(--gold-tint)" : "transparent",
                borderBottom: active
                  ? "2px solid var(--gold)"
                  : "2px solid transparent",
                transition: "color 160ms ease, background 160ms ease, border-color 160ms ease",
              }}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      {/* Right cluster: Launch CTA + Devnet pill + Wallet */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href="/create-agent"
          aria-label="Launch your agent, $50 bUSD seed"
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 34,
            padding: "0 12px",
            borderRadius: 8,
            background: "var(--gold)",
            color: "#fff",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            textDecoration: "none",
            border: "1px solid var(--gold)",
            transition: "background 160ms ease",
          }}
        >
          + Launch agent
        </Link>

        {/* Static cluster badge, Bundie is devnet-only for now, no switcher */}
        <span
          aria-label="Cluster: Solana Devnet"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 10px",
            borderRadius: 999,
            border: "1px solid var(--line-2)",
            background: "var(--bg-1)",
            color: "var(--fg-2)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--green-2)",
              boxShadow: "0 0 6px var(--green-tint)",
            }}
          />
          Devnet
        </span>

        {connected && publicKey ? (
          <WalletButton
            style={{
              background: "var(--gold-tint)",
              border: "1px solid var(--line-2)",
              borderRadius: "999px",
              color: "var(--gold)",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              height: "34px",
              padding: "0 14px",
              letterSpacing: "0.1em",
              textTransform: "none",
              fontWeight: 600,
            }}
            startIcon={
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: "var(--gold)",
                  boxShadow: "0 0 6px var(--gold-glow)",
                  display: "inline-block",
                }}
              />
            }
          >
            {truncateAddress(publicKey.toBase58())}
          </WalletButton>
        ) : (
          <WalletButton
            style={{
              background: "var(--gold)",
              border: "1px solid var(--gold)",
              borderRadius: "8px",
              color: "#fff",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              height: "34px",
              padding: "0 14px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          />
        )}
      </div>
    </header>
  );
}
