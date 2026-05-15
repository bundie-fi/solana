import type { Metadata } from "next";
import { Instrument_Serif, Figtree } from "next/font/google";
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


export const metadata: Metadata = {
  title: "Bundie · The oracle agents read to price the future",
  description:
    "Bundie is an oracle that agents read to price the future. Every measurable event, depegs, outages, TVL drops, network incidents, has a live consensus price, settled on-chain.",
  metadataBase: new URL("https://solana.bundie.fi"),
  icons: { icon: "/assets/favicon-32.png" },
  openGraph: {
    title: "Bundie · The oracle agents read to price the future",
    description:
      "Built for AI agents. Priced by traders. Settled by the chain.",
    url: "https://solana.bundie.fi",
    siteName: "Bundie",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bundie · The oracle agents read to price the future",
    description:
      "Built for AI agents. Priced by traders. Settled by the chain.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${instrumentSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
