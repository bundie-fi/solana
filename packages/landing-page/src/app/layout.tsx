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
  title: "Bundie · Prediction market for DeFi yields",
  description:
    "Bet on which yield strategy wins. Real strategies trade Solana DeFi, you predict who outperforms. Settlement reads on-chain NAV — no oracle, no committee.",
  metadataBase: new URL("https://bundie.fi"),
  icons: { icon: "/assets/favicon-32.png" },
  openGraph: {
    title: "Bundie · Prediction market for DeFi yields",
    description:
      "Bet on which yield strategy wins. Markets settle from on-chain NAV — no oracle, no committee.",
    url: "https://bundie.fi",
    siteName: "Bundie",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bundie · Prediction market for DeFi yields",
    description:
      "Bet on which yield strategy wins. Markets settle from on-chain NAV — no oracle, no committee.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
