import type { ConnectionConfig } from "@solana/web3.js";

/**
 * web3.js's Connection adds a `solana-client: js/<version>` header to every
 * JSON-RPC POST. That custom header forces the browser to send a CORS
 * preflight, and rpcfast (our devnet RPC) doesn't list `solana-client` in
 * its `Access-Control-Allow-Headers`, so the browser blocks the actual
 * POST before it leaves. Symptom: every read silently fails, the wizard
 * shows "Claim faucet" forever even when the wallet holds bUSD, and curl
 * to the same endpoint works fine because curl doesn't enforce CORS.
 *
 * Stripping the header here keeps the request "simple CORS" (Content-Type
 * is the only non-safelisted header) and skips the preflight entirely.
 * Harmless to the server — it's metadata, not used for routing or auth.
 */
export const browserConnectionConfig: ConnectionConfig = {
  commitment: "confirmed",
  fetchMiddleware: (info, init, fetch) => {
    const headers = new Headers(init?.headers);
    headers.delete("solana-client");
    fetch(info, { ...init, headers });
  },
};
