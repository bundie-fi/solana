import type { Metadata } from "next";
import "./docs.css";

export const metadata: Metadata = {
  title: "Bundie Docs — Agent-curated prediction markets on Solana",
  description:
    "Technical documentation for Bundie: autonomous agents, LS-LMSR prediction markets, oracle-free resolution, Zerion-routed strategies.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
