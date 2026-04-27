"use client";

/**
 * IdentityBanner — one-shot prompt above the TopNav nudging connected
 * wallets without an SNS to claim their `<name>.sol`. Dismissible, with
 * the dismissal persisted to localStorage.
 *
 * Visibility rules (all must hold):
 *   - Wallet is connected
 *   - SNS lookup for the wallet returns null (no chaos-pool, no devnet
 *     primary, no mainnet primary)
 *   - User has not dismissed the banner this session (localStorage flag)
 *   - User isn't already on /identity (don't nag people mid-flow)
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { lookupSnsForAddress, lookupChaosPoolSync } from "@/lib/sns";

const DISMISS_KEY = "bundie:identity-banner-dismissed";

export function IdentityBanner() {
  const pathname = usePathname();
  const { publicKey, connected } = useWallet();
  const [hasName, setHasName] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);

  // Hydrate dismiss flag from localStorage (client-only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  // SNS lookup for the connected wallet.
  useEffect(() => {
    if (!publicKey) {
      setHasName(null);
      return;
    }
    const addr = publicKey.toBase58();
    // Synchronous chaos-pool hit short-circuits the async fetch.
    if (lookupChaosPoolSync(addr)) {
      setHasName(true);
      return;
    }
    let cancelled = false;
    lookupSnsForAddress(addr)
      .then((n) => {
        if (!cancelled) setHasName(n !== null);
      })
      .catch(() => {
        if (!cancelled) setHasName(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  function handleDismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
    setDismissed(true);
  }

  // Compose visibility — fail closed: any unknown state → don't render.
  const onIdentityRoute = pathname?.startsWith("/identity");
  const shouldShow =
    connected &&
    publicKey &&
    hasName === false &&
    !dismissed &&
    !onIdentityRoute;

  if (!shouldShow) return null;

  return (
    <div
      role="status"
      className="w-full border-b border-amber-600/30 bg-amber-600/10 text-neutral-0"
    >
      <div className="mx-auto flex w-full max-w-content items-center justify-between gap-3 px-4 py-2 md:px-8">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-600">
            Devnet
          </span>
          <span className="hidden text-[color:var(--fg-3)] sm:inline" aria-hidden="true">
            ·
          </span>
          <span className="truncate text-neutral-0">
            Claim your <em className="font-serif text-amber-600">.sol</em> identity so your name follows you across strategies and markets.
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/identity"
            className="inline-flex h-9 min-h-[44px] items-center rounded-md bg-amber-600 px-3 text-xs font-semibold text-neutral-0 hover:bg-amber-500 focus-amber md:min-h-0"
          >
            Claim →
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="inline-flex h-9 min-h-[44px] w-9 items-center justify-center rounded-md text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-neutral-0 focus-amber md:min-h-0"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default IdentityBanner;
