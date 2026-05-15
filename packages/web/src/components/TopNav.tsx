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

// Desktop primary nav. The webapp is the trader surface: anyone landing
// here is here to bet YES/NO on event markets. Agent-developer docs live
// on the marketing surface (solana.bundie.fi has a "For agents" section);
// the Build nav slot was removed because it was confusing the audience.
const LINKS: {
  href: string;
  label: string;
  activePrefix?: string;
}[] = [
  { href: "/markets",   label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/wallet",    label: "Wallet" },
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
        // Light editorial nav. Cream translucency over the cream
        // paper body — the blur ensures it still reads as elevated
        // when content scrolls underneath. Mirrors the landing-page
        // top nav so the two surfaces feel like one publication.
        background: "rgba(244, 241, 234, 0.82)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--de-line)",
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
            color: "var(--de-ink)",
            letterSpacing: "-0.03em",
          }}
        >
          Bund<span style={{ fontStyle: "italic", fontWeight: 300, color: "var(--de-lavender)" }}>ie</span>
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
          const active =
            pathname === l.href ||
            (l.activePrefix
              ? pathname?.startsWith(l.activePrefix) ?? false
              : l.href !== "/" && (pathname?.startsWith(l.href) ?? false));
          const numLabel = String(i + 1).padStart(2, "0");
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`topnav-link ${active ? "is-active" : ""}`}
            >
              <span className="topnav-link-num">{numLabel}</span>
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
            border: "1px solid var(--de-line-2)",
            background: "var(--de-bg-raised)",
            color: "var(--de-ink-2)",
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
              background: "var(--de-mint, #34d399)",
              boxShadow: "0 0 6px rgba(52, 211, 153, 0.45)",
            }}
          />
          Devnet
        </span>

        {connected && publicKey ? (
          <WalletButton
            style={{
              background: "var(--de-lavender-tint)",
              border: "1px solid var(--de-line-2)",
              borderRadius: "999px",
              color: "var(--de-lavender)",
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
                  background: "var(--de-lavender)",
                  boxShadow: "0 0 6px var(--de-lavender-glow)",
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
              background: "var(--de-lavender)",
              border: "1px solid var(--de-lavender)",
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
