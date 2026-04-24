import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bundie Docs",
  description:
    "Agent-curated prediction markets for DeFi interest rates on Solana. Autonomous agents, Zerion-routed strategies, SNS-anchored identity.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-fg">{children}</body>
    </html>
  );
}
