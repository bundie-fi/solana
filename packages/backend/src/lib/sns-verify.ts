/**
 * SNS subdomain ownership resolver.
 *
 * Bundie issues identities under `<sub>.bundie.sol`. To prove that a wallet
 * registering an agent actually owns the claimed subdomain, we look up the
 * NameRegistry account on Solana mainnet (SNS only lives on mainnet) and
 * read the `owner` field. Caller compares it to the registering wallet.
 *
 * Bonfida's `@bonfida/spl-name-service` handles the heavy lifting:
 *   - `getDomainKeySync("foo.bundie.sol")` returns the on-chain account
 *     pubkey for that subdomain (deterministic — no RPC needed).
 *   - `NameRegistryState.retrieve(conn, pubkey)` reads + deserializes the
 *     account to expose `.owner`.
 *
 * Best-effort: any error (invalid name, account not found, RPC blip) is
 * swallowed and surfaced as `null`. The agents.ts caller turns null into
 * `sns_verified = false` and lets registration proceed — Bundie's policy
 * is "passport stamp", not "border control".
 */
import { Connection } from "@solana/web3.js";
// Pinned to @bonfida/spl-name-service 2.5.4 in package.json — v3.x ships a
// split-bundle ESM build whose generated files import { serialize } from
// borsh's ESM (which doesn't re-export it), crashing tsx/node at boot under
// `type: "module"`. 2.5.4 is a single-file ESM bundle that loads cleanly.
import {
  getDomainKeySync,
  NameRegistryState,
} from "@bonfida/spl-name-service";

/**
 * Resolves `<subdomain>.bundie.sol` via SNS on whichever cluster `conn`
 * points at (must be mainnet for real verification — devnet has no SNS
 * data) and returns the owner pubkey as a base58 string.
 *
 * @param conn       Solana connection (should be MAINNET for real lookups)
 * @param subdomain  Short form, e.g. "alice" — without the .bundie.sol
 *                   suffix. The function appends it.
 * @returns          base58 owner pubkey, or null if anything went wrong
 *                   (name doesn't exist, RPC error, malformed input).
 */
export async function resolveSnsOwner(
  conn: Connection,
  subdomain: string,
): Promise<string | null> {
  if (!subdomain || typeof subdomain !== "string") return null;
  // Defensive: if the caller already passed the full form, just use it;
  // otherwise build it. Either way `getDomainKeySync` expects the full
  // dotted name including ".sol".
  const trimmed = subdomain.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  const fullName = trimmed.endsWith(".bundie.sol")
    ? trimmed
    : `${trimmed}.bundie.sol`;

  try {
    const { pubkey } = getDomainKeySync(fullName);
    const { registry } = await NameRegistryState.retrieve(conn, pubkey);
    return registry.owner.toBase58();
  } catch {
    // Account-not-found, malformed name, RPC blip — soft path.
    return null;
  }
}
