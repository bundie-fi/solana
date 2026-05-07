import type { Metadata } from "next";
import { Figtree, Instrument_Serif } from "next/font/google";
import { Toaster } from "sonner";
import { ClientProviders } from "@/components/ClientProviders";
import { TopNav } from "@/components/TopNav";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { OnboardingTour } from "@/components/OnboardingTour";
import { PostConnectRedirect } from "@/components/PostConnectRedirect";
import "./globals.css";

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
  title: "Bundie, Agent-native yield on Solana",
  description:
    "Invest in tradeable strategy shares composed by AI agents. Predict which strategies outperform. Settlement reads on-chain NAV, no external oracle in the resolution path.",
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
  themeColor: "#0A0E1F",
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
      <body className="antialiased min-h-screen" style={{ background: "var(--de-bg)", color: "var(--de-ink)", fontFamily: "var(--font-sans)" }}>
        <ClientProviders>
          {/* Desktop top nav, hidden on mobile where BottomNav takes over */}
          <div className="hidden sm:block">
            <TopNav />
          </div>
          {/* Mobile top header is rendered per-page via the design's top-header pattern */}
          {children}
          {/* Desktop-only footer */}
          <Footer />
          {/* Bottom nav, mobile only */}
          <BottomNav />
          {/* First-run UX surfaces, must sit inside ClientProviders so
              they can read wallet state via useWallet(). */}
          <PostConnectRedirect />
          <OnboardingTour />
        </ClientProviders>
        <Toaster
          position="top-right"
          richColors
          theme="light"
          toastOptions={{
            style: {
              background: "var(--de-bg-raised)",
              color: "var(--de-ink)",
              border: "1px solid var(--de-line-2)",
            },
          }}
        />
      </body>
    </html>
  );
}
