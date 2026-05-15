/**
 * Devnet bUSD faucet client.
 *
 * Extracted from the retired strategists/lib/api.ts during the
 * 2026-05-15 oracle-positioning overhaul. `claimFaucet` is the only piece
 * any current surface still needs — bettors need bUSD to trade on event
 * markets. Backend route lives at packages/backend/src/routes/faucet.ts.
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://backend.solana.bundie.fi";

export interface FaucetClaimResponse {
  txSig: string;
  amount: number;
  amountBase: number;
}

export async function claimFaucet(
  wallet: string,
): Promise<FaucetClaimResponse> {
  const r = await fetch(`${BACKEND_URL}/api/faucet/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`faucet claim failed: ${r.status} ${body}`);
  }
  return r.json();
}
