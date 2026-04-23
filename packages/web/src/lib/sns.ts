/**
 * lib/sns.ts — Solana Name Service helpers for the Bundie web app.
 *
 * Two paths:
 *  (a) Mainnet reverse lookup via Bonfida — for real users displaying their
 *      `<x>.sol` identity.
 *  (b) Devnet chaos-pool fallback — the chaos-sim agents have local
 *      deterministic names (alpha-hunter, delta-trader…) baked into a
 *      static map below. We mirror the on-disk `agent-names.json` so the
 *      web app never needs to read program-package files at build time.
 *
 * Lookups are CACHED for 5 minutes to keep the UI snappy without spamming
 * RPC. Cache lives in-memory per browser tab — server-rendered pages
 * recompute on each request (acceptable, ISR handles the bulk).
 *
 * DENY-by-default: we ONLY surface a `.sol` name when (i) the on-chain
 * reverse-lookup answers, OR (ii) the wallet is in our local chaos-pool
 * map. We never display a third-party SNS name without on-chain proof.
 */
import { Connection, PublicKey } from "@solana/web3.js";

// Bonfida primary-domain helper. Imported lazily inside the function so
// SSR bundles don't pay the parse cost on every page render.
type GetMultiplePrimaryDomains = (
  conn: Connection,
  wallets: PublicKey[],
) => Promise<(string | undefined)[]>;

const MAINNET_RPC =
  process.env.NEXT_PUBLIC_MAINNET_RPC || "https://api.mainnet-beta.solana.com";

// Devnet RPC — used to reverse-lookup names registered through the
// in-app /identity flow (Bonfida devnet registrar). We try devnet BEFORE
// mainnet so newly-registered devnet identities show up immediately
// across the app.
const DEVNET_RPC =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

// ───────────────────────────────────────────────────────────────────────────
// Static chaos-pool map — mirrored from
// packages/programs/scripts/chaos-sim/keys/agent-names.json. Update both
// files together. Source of truth for devnet/local chaos identities.
// ───────────────────────────────────────────────────────────────────────────
const CHAOS_POOL: Record<string, string> = {
  // creators
  "9sDZ2Q7r57Zzb8QonDKMrMxgGKXtLcEckKjuUpVv8EgJ": "alpha-hunter.sol",
  "9pkxLmvZNJKv22rJ4o39JJWdJbcRMbkwrZ1y8mjHcC92": "delta-trader.sol",
  "FYF71jeyXotjLvgasWwzK3k8GS5pjrafsimoXoSTEZd5": "gamma-scout.sol",
  "6UaXsfg6JeakhTEtuT3aDQAY9sKMHSfDT22HtLzWPYH2": "theta-quant.sol",
  "3cxwxubZq1hmKnr6EuTbAypgUK29rsEzF7V65ysDKdse": "vega-oracle.sol",
  // traders
  "31qdnmthhoWkhb1DBrdU3T9NkMoNGXqEY6W3J6AnVHbL": "sigma-wolf.sol",
  "58VmQjKkD1vqovann8kmeDNdFWyMwLs3Jv9miw5pa2pS": "kappa-falcon.sol",
  "6WbNANWYGJrzABNmkaiehE6hMFws8Ahv8AMLzEpZHu6R": "lambda-signal.sol",
  "8rszHge5qTvfAu2xBT2mPuSjmGcznQHLW3p2xDnKGsaj": "omega-sage.sol",
  "4PJUR8AUcurd7WWh9n4esEQDm2MF7wPTpEJX78zSn5Du": "alpha-quant.sol",
};

// ───────────────────────────────────────────────────────────────────────────
// Cache — 5 min TTL. Stores resolved name OR null (negative cache so we
// don't keep retrying RPC misses).
// ───────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(addr: string): string | null | undefined {
  const e = cache.get(addr);
  if (!e) return undefined;
  if (e.expiresAt < Date.now()) {
    cache.delete(addr);
    return undefined;
  }
  return e.value;
}

function cacheSet(addr: string, value: string | null): void {
  cache.set(addr, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve an address to a `<name>.sol` if available.
 *
 * Order of resolution:
 *   1) In-memory cache (5 min TTL).
 *   2) Local chaos-pool static map (devnet identities).
 *   3) Bonfida mainnet primary-domain reverse lookup.
 *
 * Returns `null` if no name resolves. Never throws — RPC failures degrade
 * to null silently so the UI can fall back to the truncated pubkey.
 */
export async function lookupSnsForAddress(
  addr: string,
): Promise<string | null> {
  if (!addr) return null;

  const cached = cacheGet(addr);
  if (cached !== undefined) return cached;

  // (2) chaos-pool — instant, deterministic, authoritative for our agents.
  const local = CHAOS_POOL[addr];
  if (local) {
    cacheSet(addr, local);
    return local;
  }

  // Validate pubkey once — invalid input → negative cache, no RPC.
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(addr);
  } catch {
    cacheSet(addr, null);
    return null;
  }

  // (3a) DEVNET primary-domain via Bonfida devnet utils. This is the path
  // the Bundie /identity flow targets, so it must run first — newly
  // registered names need to surface immediately across the app.
  try {
    const sns = await import("@bonfida/spl-name-service");
    const devnetUtils = (sns as unknown as {
      devnet?: { utils?: { getPrimaryDomain?: (c: Connection, owner: PublicKey) => Promise<{ reverse: string; stale: boolean }> } };
    }).devnet?.utils;
    if (devnetUtils?.getPrimaryDomain) {
      const conn = new Connection(DEVNET_RPC, "confirmed");
      const result = await devnetUtils.getPrimaryDomain(conn, pubkey);
      if (result?.reverse && !result.stale) {
        const full = `${result.reverse}.sol`;
        cacheSet(addr, full);
        return full;
      }
    }
  } catch {
    // devnet primary lookup failed (no primary set, RPC throttle, etc.)
    // — fall through to mainnet.
  }

  // (3b) MAINNET primary-domain via Bonfida. Same try/catch budget as (3a).
  try {
    const { getMultipleFavoriteDomains } = (await import(
      "@bonfida/spl-name-service"
    )) as { getMultipleFavoriteDomains: GetMultiplePrimaryDomains };

    const conn = new Connection(MAINNET_RPC, "confirmed");
    const [name] = await getMultipleFavoriteDomains(conn, [pubkey]);
    if (name) {
      const full = `${name}.sol`;
      cacheSet(addr, full);
      return full;
    }
  } catch {
    // swallow — fall through to negative cache
  }

  cacheSet(addr, null);
  return null;
}

/** Synchronous chaos-pool only lookup — useful for SSR where async resolve
 *  would block the render. Returns null if not in the local map. */
export function lookupChaosPoolSync(addr: string): string | null {
  return CHAOS_POOL[addr] ?? null;
}

/** Convenience: truncated `0xab12…cdef` style pubkey for fallback display. */
export function truncatePubkey(addr: string, head = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Test/debug helper — flush the in-memory cache. */
export function _resetSnsCache(): void {
  cache.clear();
}

/**
 * Invalidate a single address (after a successful devnet registration so
 * the next render re-fetches and sees the new `<name>.sol`). Safe to call
 * even when the address isn't cached.
 */
export function invalidateSnsLookup(addr: string): void {
  cache.delete(addr);
}

/**
 * Manual override — write a known name into the cache. Used right after a
 * successful registration on /identity so the wallet immediately reflects
 * its new `.sol` across the app without waiting for Bonfida indexers.
 */
export function setSnsCacheEntry(addr: string, name: string): void {
  cacheSet(addr, name);
}
