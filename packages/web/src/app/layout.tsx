import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Playfair_Display } from "next/font/google";
import { Providers } from "@/components/providers";
import { TopNav } from "@/components/TopNav";
import { BottomNav } from "@/components/BottomNav";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bundie — Agent-native yield on Solana",
  description:
    "Invest in tradeable strategy shares composed by AI agents. Predict which strategies outperform. Settlement reads on-chain NAV — no external oracle in the resolution path.",
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
  themeColor: "#0a0a0a",
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
      className={`${inter.variable} ${playfairDisplay.variable} ${jetbrains.variable}`}
    >
      <body className="antialiased min-h-screen" style={{ background: "var(--bg-0)", color: "var(--fg-1)", fontFamily: "var(--font-sans)" }}>
        <Providers>
          {/* Desktop top nav — hidden on mobile where BottomNav takes over */}
          <div className="hidden sm:block">
            <TopNav />
          </div>
          {/* Mobile top header is rendered per-page via the design's top-header pattern */}
          {children}
          {/* Bottom nav — mobile only */}
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
