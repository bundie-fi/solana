// Last redeploy trigger: 2026-05-07T19:18:37Z

import type { Metadata } from "next";
import { Figtree, Instrument_Serif } from "next/font/google";
import { ClientProviders } from "@/components/ClientProviders";
import { TopNav } from "@/components/TopNav";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { PostConnectRedirect } from "@/components/PostConnectRedirect";
import {
  DeferredOnboardingTour,
  DeferredToaster,
} from "@/components/DeferredClientMounts";
import "./globals.css";

// Network priming. preconnect opens TCP + TLS to backend / RPC before the
// page makes its first request, dns-prefetch resolves the hostnames in
// parallel for browsers without preconnect. Both are no-ops if the URL is
// already same-origin, so it's safe to set even when backend is local.
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://backend.solana.bundie.fi";
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  process.env.NEXT_PUBLIC_RPC_URL ??
  "https://api.devnet.solana.com";

// Two-font system, matching the marketing site exactly. Figtree handles
// every structural surface (body, labels, numbers, CTAs) and Instrument
// Serif is reserved for display-size headlines and a single italic accent
// per section. JetBrains Mono was removed in the 2026-05 redesign — see
// packages/web/DESIGN.md for the rationale.
const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bundie — The index of DeFi performance you can trade on",
  description:
    "Bundie is the index of DeFi performance you can trade on. AI agents run real strategies on Solana; markets settle from on-chain NAV with no oracle, no committee.",
  manifest: "/manifest.json",
  applicationName: "Bundie",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Bundie",
  },
  icons: {
    icon: [
      { url: "/assets/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/assets/bundie-mark-white.png", sizes: "192x192", type: "image/png" },
      { url: "/assets/bundie-mark-white.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/assets/bundie-mark-white.png", sizes: "192x192" }],
  },
};

export const viewport = {
  // Cream paper, matches --de-bg. Drives the iOS Safari address bar
  // tint and the Android system bar so the chrome blends with the
  // light editorial body.
  themeColor: "#F4F1EA",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${instrumentSerif.variable}`}
    >
      <head>
        {/* Open TCP + TLS to backend and RPC before the first request so
            the data-fetch fan-out lands ~100–300ms sooner on cold loads. */}
        <link rel="preconnect" href={BACKEND_URL} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={BACKEND_URL} />
        <link rel="preconnect" href={RPC_URL} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={RPC_URL} />
      </head>
      <body className="antialiased min-h-screen" style={{ background: "var(--de-bg)", color: "var(--de-ink)", fontFamily: "var(--font-sans)" }}>
        <ClientProviders>
          {/* Desktop top nav, hidden on mobile where BottomNav takes over.
              The responsive hide lives inside the component so the sticky
              header's containing block is <body> (full document height) —
              wrapping it in a div that's only as tall as the header would
              prevent position: sticky from sticking past the first scroll. */}
          <TopNav />
          {/* Mobile top header is rendered per-page via the design's top-header pattern */}
          {children}
          {/* Desktop-only footer */}
          <Footer />
          {/* Bottom nav, mobile only */}
          <BottomNav />
          {/* First-run UX surfaces, must sit inside ClientProviders so
              they can read wallet state via useWallet(). */}
          <PostConnectRedirect />
          <DeferredOnboardingTour />
        </ClientProviders>
        <DeferredToaster />
      </body>
    </html>
  );
}
