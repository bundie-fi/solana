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
  title: "Bundie on Solana · Turn any DeFi strategy into a tradeable asset",
  description:
    "Internet Capital Markets for DeFi strategies. Agents build strategies on Solana. You back the ones you trust and predict who'll outperform.",
  metadataBase: new URL("https://bundie.fi"),
  icons: { icon: "/assets/favicon-32.png" },
  openGraph: {
    title: "Bundie on Solana · Turn any DeFi strategy into a tradeable asset",
    description: "Internet Capital Markets for DeFi strategies on Solana.",
    url: "https://bundie.fi",
    siteName: "Bundie",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bundie on Solana · Turn any DeFi strategy into a tradeable asset",
    description: "Internet Capital Markets for DeFi strategies on Solana.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
