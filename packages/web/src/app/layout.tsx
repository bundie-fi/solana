import type { Metadata } from "next";
import { Figtree, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { TopNav } from "@/components/TopNav";
import { IdentityBanner } from "@/components/IdentityBanner";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
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
  themeColor: "#0a0908",
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
      className={`${figtree.variable} ${instrumentSerif.variable} ${jetbrains.variable} dark`}
    >
      <body className="bg-background text-neutral-900 antialiased min-h-screen font-sans">
        <Providers>
          <IdentityBanner />
          <TopNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
