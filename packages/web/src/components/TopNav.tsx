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

// Desktop primary nav mirrors the mobile BottomNav (Discover · Portfolio
// · Wallet) so labels + routes match across breakpoints. Discover is the
// bettor surface at /; Wallet is the new wallet hub at /wallet. The Create
// entry (launch wizard at /strategists) was removed when the product
// pivoted to bettor-first — the wizard URL still works, just no nav link.
const LINKS: { href: string; label: string; activePrefix?: string }[] = [
  { href: "/",            label: "Discover",   activePrefix: "/markets" },
  { href: "/portfolio",   label: "Portfolio" },
  { href: "/wallet",      label: "Wallet" },
];

function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Top navigation, desktop only (hidden on mobile where BottomNav is used).
 * Active-link styling is editorial: a leading counter ("01") in lavender,
 * the label in full cream ink, and a hairline lavender rule that
 * animates in beneath the label. No pill backgrounds, no rounded chrome.
 * See packages/web/DESIGN.md § Iconography / Voice for the rationale.
 */
export function TopNav() {
  const pathname = usePathname();
  const { publicKey, connected } = useWallet();

  return (
    <header
      className="topnav-root"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
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
      <Link href="/" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
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
      </Link>

      {/* Nav links — editorial pattern. No pills, no rounded backgrounds.
          Contrast comes from typography (active = full cream, inactive =
          dim cream) and a single lavender hairline beneath the active
          label, sized to the text width, not to the padding. The leading
          counter ("01 / 02 / 03") gives the row a magazine table-of-
          contents feel and makes the active item visually anchored
          without chrome. */}
      <nav className="topnav-links" aria-label="Primary">
        {LINKS.map((l, i) => {
          // The Markets tab points at `/` but should also light up on
          // `/markets`, so treat an explicit `activePrefix` as "also
          // match this path family" , independent of href === "/".
          const active =
            pathname === l.href ||
            (l.activePrefix
              ? pathname?.startsWith(l.activePrefix) ?? false
              : l.href !== "/" && (pathname?.startsWith(l.href) ?? false));
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`topnav-link ${active ? "is-active" : ""}`}
            >
              <span className="topnav-link-num">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="topnav-link-label">
                {l.label}
                <span className="topnav-link-rule" aria-hidden="true" />
              </span>
            </Link>
          );
        })}
      </nav>

      <style>{`
        @media (max-width: 639px) {
          .topnav-root { display: none !important; }
        }
        .topnav-links {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          align-items: center;
          gap: 28px;
          pointer-events: auto;
        }
        .topnav-link {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          height: 36px;
          padding: 0 2px;
          font-family: var(--font-sans);
          font-size: 11.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          text-decoration: none;
          color: var(--de-ink-4);
          transition: color 160ms ease;
        }
        .topnav-link:hover { color: var(--de-ink-2); }

        .topnav-link-num {
          font-family: var(--font-sans);
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.10em;
          color: var(--de-ink-5);
          font-variant-numeric: tabular-nums;
          transition: color 160ms ease;
        }
        .topnav-link:hover .topnav-link-num { color: var(--de-ink-3); }

        .topnav-link-label {
          position: relative;
          display: inline-block;
          padding: 18px 0;
        }
        .topnav-link-rule {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 14px;
          height: 1.5px;
          background: var(--de-lavender);
          transform: scaleX(0);
          transform-origin: left center;
          transition: transform 200ms cubic-bezier(0.25, 0.4, 0.25, 1);
        }

        .topnav-link.is-active { color: var(--de-ink); }
        .topnav-link.is-active .topnav-link-num { color: var(--de-lavender); }
        .topnav-link.is-active .topnav-link-rule { transform: scaleX(1); }
      `}</style>

      {/* Right cluster: Devnet pill + Wallet. The "+ Launch agent" gold
          CTA used to sit here; it was removed when we repositioned the
          app as bettor-first. The launch wizard at /strategists is no
          longer linked from primary nav either, but the URL still works. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
