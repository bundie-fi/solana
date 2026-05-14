/**
 * v1 — resolver source registry loader.
 *
 * Reads `packages/programs/scripts/resolvers/sources.json` at boot and
 * exposes a typed view of the registered events. The same JSON file is
 * the on-chain source of truth (its blake3 hash is pinned in each
 * market's ResolverAuthority.config_hash), so any change to it requires
 * a redeploy of the affected markets.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  RegistryEvent,
  RegistryNetwork,
  ResolverRegistry,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve from this file (packages/backend/src/v1/registry.ts) up to the
 * monorepo root, then into packages/programs/scripts/resolvers/sources.json.
 * Mirrors the import strategy used elsewhere in this backend (workspace
 * package paths). Override with BUNDIE_RESOLVER_SOURCES env var if running
 * outside the monorepo.
 */
const DEFAULT_REGISTRY_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "programs",
  "scripts",
  "resolvers",
  "sources.json",
);

let cached: ResolverRegistry | null = null;

export function loadRegistry(): ResolverRegistry {
  if (cached) return cached;
  const path = process.env.BUNDIE_RESOLVER_SOURCES ?? DEFAULT_REGISTRY_PATH;
  const raw = readFileSync(path, "utf-8");
  cached = JSON.parse(raw) as ResolverRegistry;
  return cached;
}

export function getEvent(eventId: string): RegistryEvent | undefined {
  return loadRegistry().events.find((e) => e.event_id === eventId);
}

export function getNetwork(
  network: "devnet" | "mainnet" = (process.env.BUNDIE_NETWORK as "devnet" | "mainnet") ?? "devnet",
): RegistryNetwork {
  return loadRegistry().networks[network];
}

/**
 * Resolve a `feed_network_key` like "pyth_feeds.USDC_USD" into the actual
 * Pyth feed pubkey for the current network. Returns null if the key path
 * doesn't exist (callers should treat that as a config error, not a
 * transient failure).
 */
export function resolveFeedKey(feedNetworkKey: string): string | null {
  const network = getNetwork();
  const segments = feedNetworkKey.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursor: any = network;
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== "object" || !(seg in cursor)) {
      return null;
    }
    cursor = cursor[seg];
  }
  return typeof cursor === "string" ? cursor : null;
}

/** All demo-eligible events. Used by the Day-1 deploy script. */
export function listDemoEvents(): RegistryEvent[] {
  return loadRegistry().events.filter((e) => e.demo_eligible);
}
