/**
 * Server-side RPC connection helper for server components.
 *
 * `lib/constants.ts` already exports `RPC_ENDPOINT` (env-driven) for use in
 * client components. This module wraps it in a lazily-created `Connection`
 * singleton so each server component render reuses the same http client
 * without re-parsing the env.
 */
import { Connection } from "@solana/web3.js";

export const DEVNET_RPC: string =
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  process.env.NEXT_PUBLIC_RPC_URL ??
  "https://api.devnet.solana.com";

let cachedConnection: Connection | null = null;

export function getDevnetConnection(): Connection {
  if (!cachedConnection) {
    cachedConnection = new Connection(DEVNET_RPC, "confirmed");
  }
  return cachedConnection;
}
