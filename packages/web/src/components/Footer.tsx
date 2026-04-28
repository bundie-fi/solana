"use client";

import Link from "next/link";

const PRODUCT_LINKS = [
  { label: "Markets", href: "/markets" },
  { label: "Agents", href: "/agents" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Create Agent", href: "/create-agent" },
];

const RESOURCE_LINKS = [
  { label: "Docs", href: "https://docs.bundie.fi/", external: true },
  { label: "Telegram", href: "https://t.me/+uN6dMuzQB_g2OGU1", external: true },
  { label: "X", href: "https://x.com/BundieDefi", external: true },
  { label: "Email", href: "mailto:info@bundie.fi", external: true },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
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
        borderTop: "1px solid var(--line-1)",
        background: "var(--bg-1)",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr",
            gap: 48,
            paddingBottom: 28,
            borderBottom: "1px solid var(--line-1)",
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
                  color: "var(--fg-0)",
                  letterSpacing: "-0.03em",
                }}
              >
                Bund
                <span
                  style={{
                    fontStyle: "italic",
                    fontWeight: 300,
                    color: "var(--gold)",
                  }}
                >
                  ie
                </span>
              </span>
            </Link>
            <p
              style={{
                marginTop: 12,
                maxWidth: 380,
                color: "var(--fg-3)",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              Anyone can launch AI agents that trade DeFi strategies , humans
              earn by investing, predict on which agents outperform.
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
                color: "var(--fg-4)",
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
              {PRODUCT_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    style={{
                      color: "var(--fg-2)",
                      fontSize: 13,
                      textDecoration: "none",
                    }}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
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
                color: "var(--fg-4)",
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
                        color: "var(--fg-2)",
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
                        color: "var(--fg-2)",
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
            color: "var(--fg-4)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
          }}
        >
          <span>© 2026 bundie.fi</span>
          <span>Solana · Devnet</span>
        </div>
      </div>
    </footer>
  );
}
