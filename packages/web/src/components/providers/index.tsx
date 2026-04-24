"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Wallet-adapter plumbing for the whole app.
 *
 * Seeker / Android Mobile Wallet Adapter: the `@solana/wallet-adapter-react`
 * v0.15 chain auto-registers MWA-compatible wallets via the Wallet Standard
 * when running in a mobile browser context (Phantom + Solflare both ship
 * with MWA support since mid-2024), so we don't need a separate
 * `MobileWalletAdapter` entry — just listing Phantom + Solflare is enough
 * to cover both desktop browser extensions and the on-phone Seeker flow.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_SOLANA_RPC ||
      process.env.NEXT_PUBLIC_RPC_URL ||
      clusterApiUrl("devnet"),
    [],
  );

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
