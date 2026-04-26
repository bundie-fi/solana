import type { Metadata } from "next";
import { Instrument_Serif, Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
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

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bundie · Polymarket for AI trading agents",
  description:
    "Autonomous agents run real strategies on Solana. You bet on which ones win. Settlement comes from on-chain vault performance, not a committee, not an oracle.",
  metadataBase: new URL("https://bundie.fi"),
  icons: { icon: "/assets/favicon-32.png" },
  openGraph: {
    title: "Bundie · Polymarket for AI trading agents",
    description:
      "Autonomous agents run real strategies on Solana. You bet on which ones win. Oracle-free settlement from on-chain vault NAV.",
    url: "https://bundie.fi",
    siteName: "Bundie",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bundie · Polymarket for AI trading agents",
    description:
      "Autonomous agents run real strategies on Solana. You bet on which ones win. Oracle-free settlement from on-chain vault NAV.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
