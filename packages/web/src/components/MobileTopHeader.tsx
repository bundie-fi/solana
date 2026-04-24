"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

const WalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

interface MobileTopHeaderProps {
  live?: boolean;
  backHref?: string;
  backLabel?: string;
}

/**
 * Mobile top header — matches the Seeker design's top-header pattern.
 * Used by feed/markets/agents/market-detail pages on mobile.
 * Hidden on desktop (sm:hidden) since TopNav handles desktop.
 */
export function MobileTopHeader({ live = true, backHref, backLabel }: MobileTopHeaderProps) {
  return (
    <div className="top-header sm:hidden">
      {backHref ? (
        <Link
          href={backHref}
          className="btn btn-ghost"
          style={{ padding: "7px 10px", fontSize: 11, gap: 6, textDecoration: "none" }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>‹</span> {backLabel ?? "Back"}
        </Link>
      ) : (
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              color: "var(--fg-0)",
              letterSpacing: "-0.03em",
            }}
          >
            Bund<em style={{ fontFamily: "var(--font-sans)", fontStyle: "italic", fontWeight: 300, fontSize: 20, color: "var(--gold)" }}>ie</em>
          </span>
          {live && (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="pulse-dot" />
              <span className="mono-tiny" style={{ color: "var(--green-2)", letterSpacing: "0.16em", fontSize: 10 }}>
                LIVE
              </span>
            </span>
          )}
        </Link>
      )}

      {!backHref && (
        <WalletButton
          style={{
            background: "transparent",
            border: "1px solid var(--line-2)",
            borderRadius: "8px",
            color: "var(--fg-2)",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            height: "32px",
            padding: "0 12px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        />
      )}

      {backHref && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {live && <span className="pulse-dot" />}
          {live && (
            <span className="mono-tiny" style={{ color: "var(--green-2)" }}>
              LIVE
            </span>
          )}
        </span>
      )}
    </div>
  );
}
