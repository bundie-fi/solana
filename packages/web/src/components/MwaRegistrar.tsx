"use client";

import { useEffect } from "react";
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
  registerMwa,
} from "@solana-mobile/wallet-standard-mobile";

/**
 * Mounts the Mobile Wallet Adapter (MWA) as a Wallet Standard wallet so the
 * existing `@solana/wallet-adapter-react` provider auto-discovers it. When
 * Bundie's Next.js PWA is wrapped as a Solana Mobile TWA, the wallet-connect
 * button hands off to the on-device wallet via Android intents instead of the
 * browser-extension flow.
 *
 * MUST be a client component — `registerMwa` reads `window` at call time and
 * crashes under SSR (per the @solana-mobile/wallet-standard-mobile docs).
 *
 * Module-level guard prevents double-registration across React 18
 * StrictMode dev re-mounts and Fast Refresh.
 */
let registered = false;

export function MwaRegistrar() {
  useEffect(() => {
    if (registered) return;
    registered = true;
    try {
      registerMwa({
        appIdentity: {
          name: "Bundie",
          uri: "https://app.solana.bundie.fi",
          icon: "/icons/icon-192.png",
        },
        chains: ["solana:devnet", "solana:mainnet"],
        authorizationCache: createDefaultAuthorizationCache(),
        chainSelector: createDefaultChainSelector(),
        onWalletNotFound: createDefaultWalletNotFoundHandler(),
      });
      console.log("[mwa] registered (TWA wallet adapter active)");
    } catch (err) {
      console.warn("[mwa] registration failed:", err);
    }
  }, []);
  return null;
}
