"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  fetchPendingAgents,
  fetchAgent,
} from "@/app/strategists/lib/api";

/**
 * Detects the false→true wallet transition and routes operators to
 * /portfolio if they have an agent. Anyone else stays on the home feed
 * — that's the live activity surface and the right default.
 *
 * Skipped when the user is already on a non-home route — connecting a
 * wallet from a sub-page shouldn't yank them away from it.
 */
export function PostConnectRedirect() {
  const { connected, publicKey } = useWallet();
  const router = useRouter();
  const pathname = usePathname();
  const wasConnected = useRef(connected);

  useEffect(() => {
    const prev = wasConnected.current;
    wasConnected.current = connected;

    if (prev || !connected || !publicKey) return;
    if (pathname && pathname !== "/") return;

    let cancelled = false;
    (async () => {
      const owner = publicKey.toBase58();
      try {
        const pending = await fetchPendingAgents(owner);
        if (cancelled) return;
        if (pending.length > 0) {
          router.push("/portfolio");
          return;
        }
      } catch {
        /* fall through */
      }
      // No agents yet → stay on the home feed (the live activity stream
      // is the right default; users who want to predict can tap into a
      // market from the feed).
      void fetchAgent;
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, router, pathname]);

  return null;
}
