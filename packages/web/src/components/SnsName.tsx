"use client";

/**
 * SnsName , render an SNS name for a Solana address, with graceful
 * fallback to a truncated pubkey while we resolve.
 *
 * Resolution order (delegated to lib/sns):
 *   1) Static chaos-pool map  (devnet `.bundie` agent identities)
 *   2) Bonfida mainnet reverse lookup (cached 5min, `.sol`)
 *   3) Truncated pubkey fallback (always available, never blocks render)
 *
 * The component is non-blocking: it renders the truncated pubkey
 * immediately, then upgrades when resolution finishes. If SNS RPC is
 * down, the truncated pubkey stays , UI never breaks.
 *
 * Hover tooltip surfaces the resolution path: which program (always SPL
 * Name Service), which TLD (.bundie on devnet vs .sol mainnet), and the
 * full owner pubkey. Helps judges + curious users see we're using real
 * SNS infrastructure, not a Bundie-internal namespace.
 *
 * DENY-by-default: never displays a name without it coming from one of
 * the verified sources above. No client-supplied / user-supplied names.
 */
import { useEffect, useState } from "react";
import {
  lookupChaosPoolSync,
  lookupSnsForAddress,
  truncatePubkey,
} from "@/lib/sns";

interface SnsNameProps {
  /** Base58 address. Required. */
  addr: string;
  /** Number of leading chars in fallback (default 6). */
  head?: number;
  /** Number of trailing chars in fallback (default 4). */
  tail?: number;
  /** Optional className passthrough. Caller controls font/color. */
  className?: string;
  /** Optional prefix label, e.g. "by " , only rendered when there IS a name or pubkey. */
  prefix?: string;
  /**
   * If true, wrap output in a link to the explorer (devnet). Defaults to false
   * so the component composes inside other links without nesting.
   */
  linkToExplorer?: boolean;
}

/**
 * Initial value: synchronous chaos-pool hit if any, otherwise null. This
 * lets server-rendered output already include the name for our chaos
 * agents (no flicker on first paint).
 */
function initialValue(addr: string): string | null {
  return lookupChaosPoolSync(addr);
}

export function SnsName({
  addr,
  head = 6,
  tail = 4,
  className,
  prefix,
  linkToExplorer = false,
}: SnsNameProps): JSX.Element {
  const [name, setName] = useState<string | null>(() => initialValue(addr));

  useEffect(() => {
    let cancelled = false;
    // If we already got a synchronous hit, skip the async fetch.
    if (lookupChaosPoolSync(addr)) {
      setName(lookupChaosPoolSync(addr));
      return () => {
        cancelled = true;
      };
    }
    lookupSnsForAddress(addr)
      .then((n) => {
        if (!cancelled) setName(n);
      })
      .catch(() => {
        // Silent , UI keeps the truncated pubkey fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [addr]);

  const display = name ?? truncatePubkey(addr, head, tail);
  // Tooltip: surface the resolution path so users see this is real SNS
  // infra, not a Bundie-internal lookup. When unresolved, we just show
  // the full pubkey (existing behavior).
  const tldHint = name?.endsWith(".bundie")
    ? "SPL Name Service · .bundie root (devnet, owned by Bundie)"
    : name?.endsWith(".sol")
      ? "SPL Name Service · .sol root (Bonfida)"
      : null;
  const tooltip = tldHint
    ? `${name}\n${tldHint}\nProgram: namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX\nOwner:   ${addr}`
    : addr;
  const inner = (
    <span className={className} title={tooltip} data-sns-resolved={name ? "true" : "false"}>
      {prefix}
      {display}
    </span>
  );

  if (!linkToExplorer) return inner;

  return (
    <a
      href={`https://orbmarkets.io/address/${addr}?cluster=devnet`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline"
    >
      {inner}
    </a>
  );
}

export default SnsName;
