import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
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
      { url: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/icon-192.svg", sizes: "192x192" }],
  },
};

export const viewport = {
  themeColor: "#0a0a0f",
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
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} dark`}>
      <body className="bg-background text-neutral-800 antialiased min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
