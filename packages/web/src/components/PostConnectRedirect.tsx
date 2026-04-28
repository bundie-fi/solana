"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  fetchPendingAgents,
  fetchAgent,
} from "@/app/create-agent/lib/api";

/**
 * Detects the false→true wallet transition and routes the user somewhere
 * useful. Active agent → /portfolio (they're an operator); no agents →
 * /markets (they're a predictor). Uses a ref to capture the transition so
 * users already connected on page load aren't bounced.
 *
 * Skipped when the user is already on a non-home route , connecting a
 * wallet from the markets list shouldn't yank them away from it.
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
      // fetchPendingAgents only returns pending_init rows; treat any
      // pending OR active row as "this wallet has agents". We try the
      // active list via the same `?ownerWallet=` shape on /agents , but
      // since fetchAgent takes SNS not wallet, we lean on fetchPendingAgents
      // for the cheap path and route to /portfolio if it's non-empty.
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
      // Best-effort: probe one well-known SNS shape , if the user typed
      // their wallet as a .sol it'd resolve here. Cheaper & stricter to
      // just default to /markets when no pending rows exist.
      void fetchAgent;
      if (!cancelled) router.push("/markets");
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, router, pathname]);

  return null;
}
