"use client";

import Link from "next/link";

const PRODUCT_LINKS: Array<{ label: string; href: string; external?: boolean }> = [
  { label: "Markets", href: "/markets" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Wallet", href: "/wallet" },
  { label: "For agents ↗", href: "https://solana.bundie.fi/#for-agents", external: true },
];

const RESOURCE_LINKS = [
  { label: "Telegram", href: "https://t.me/+uN6dMuzQB_g2OGU1", external: true },
  { label: "X", href: "https://x.com/BundieDefi", external: true },
  { label: "Email", href: "mailto:info@bundie.fi", external: true },
];

/**
 * Desktop-only footer. Mobile uses BottomNav for the same surface.
 */
export function Footer() {
  return (
    <footer
      className="hidden lg:block"
      style={{
        marginTop: 64,
        padding: "32px 24px 40px",
        borderTop: "1px solid var(--de-line)",
        background: "var(--de-bg-raised)",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr",
            gap: 48,
            paddingBottom: 28,
            borderBottom: "1px solid var(--de-line)",
          }}
        >
          {/* Brand + tagline */}
          <div>
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                textDecoration: "none",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/favicon-32.png"
                alt="Bundie"
                style={{ width: 24, height: 24 }}
              />
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 22,
                  color: "var(--de-ink)",
                  letterSpacing: "-0.03em",
                }}
              >
                Bund
                <span
                  style={{
                    fontStyle: "italic",
                    fontWeight: 300,
                    color: "var(--de-lavender)",
                  }}
                >
                  ie
                </span>
              </span>
            </Link>
            <p
              style={{
                marginTop: 12,
                maxWidth: 420,
                fontFamily: "var(--font-display)",
                fontSize: 18,
                lineHeight: 1.35,
                letterSpacing: "-0.015em",
                color: "var(--de-ink)",
              }}
            >
              Built for AI agents.{" "}
              <span
                style={{
                  fontStyle: "italic",
                  color: "var(--de-lavender)",
                }}
              >
                Priced by traders.
              </span>{" "}
              Settled by the chain.
            </p>
          </div>

          {/* Product */}
          <div>
            <h3
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--de-ink-4)",
              }}
            >
              Product
            </h3>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "14px 0 0",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {PRODUCT_LINKS.map((l) =>
                l.external ? (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--de-ink-2)",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      {l.label}
                    </a>
                  </li>
                ) : (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      style={{
                        color: "var(--de-ink-2)",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      {l.label}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--de-ink-4)",
              }}
            >
              Resources
            </h3>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "14px 0 0",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {RESOURCE_LINKS.map((l) =>
                l.external ? (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--de-ink-2)",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      {l.label}
                    </a>
                  </li>
                ) : (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      style={{
                        color: "var(--de-ink-2)",
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      {l.label}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>

        <div
          style={{
            paddingTop: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "var(--de-ink-4)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
          }}
        >
          <span>© 2026 solana.bundie.fi</span>
          <span>Solana · Devnet</span>
        </div>
      </div>
    </footer>
  );
}
