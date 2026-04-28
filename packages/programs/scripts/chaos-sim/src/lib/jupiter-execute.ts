/**
 * jupiter-execute.ts — Jupiter v6 spot swap executor against the surfpool
 * mainnet fork. First concrete implementation under the venue-agnostic
 * `swap` brain action; sibling venues (raydium-cpmm, orca-whirlpool, …)
 * will land here as separate exporters using the same surface shape.
 *
 * Flow:
 *   1. GET /v6/quote with inputMint / outputMint / amount (base units) /
 *      slippageBps. asLegacyTransaction=true so the response we hand to
 *      web3.js v1 below stays a legacy Transaction (v0 messages reject
 *      under some surfpool configs — pin to legacy until that's resolved).
 *   2. POST /v6/swap with quoteResponse + userPublicKey. Jupiter bakes a
 *      priority fee in via dynamicComputeUnitLimit; we DO NOT add a
 *      second one.
 *   3. Deserialize swapTransaction (base64), partial-sign with the agent
 *      keypair, broadcast against the surfpool connection, confirm.
 */

import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";

// Jupiter migrated off `quote-api.jup.ag/v6/...` (DNS no longer resolves).
// The free / unauthenticated tier now lives at `lite-api.jup.ag/swap/v1/...`.
// If we ever need the higher-throughput paid endpoint, swap to
// `api.jup.ag/swap/v1/...` with an `x-api-key` header.
const JUP_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

interface JupQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  routePlan?: Array<{
    swapInfo?: {
      label?: string;
      inputMint?: string;
      outputMint?: string;
    };
  }>;
}

interface JupSwapResponse {
  swapTransaction: string;
}

export interface JupiterSwapResult {
  protocol: "jupiter";
  action: "swap";
  txSig: string;
  inputAmount: bigint;
  /** Out amount from the quote (pre-slippage; actual on-chain may differ). */
  outputAmount: bigint;
  /** Human description, e.g. "USDC → SOL via Whirlpool". */
  routePlan: string;
}

function describeRoute(quote: JupQuoteResponse): string {
  const legs = quote.routePlan ?? [];
  if (legs.length === 0) {
    return `${shortMint(quote.inputMint)} → ${shortMint(quote.outputMint)}`;
  }
  const labels = legs
    .map((l) => l.swapInfo?.label ?? "?")
    .filter((s) => s.length > 0);
  return `${shortMint(quote.inputMint)} → ${shortMint(quote.outputMint)} via ${labels.join(" → ")}`;
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export async function swapJupiter(
  surfpool: Connection,
  agentKp: Keypair,
  args: {
    inputMint: string;
    outputMint: string;
    /** Base units (NOT UI). Caller resolves decimals at the dispatcher boundary. */
    amountInBase: bigint;
    slippageBps: number;
  },
): Promise<JupiterSwapResult> {
  if (args.amountInBase <= 0n) {
    throw new Error(
      `swapJupiter: amountInBase must be > 0 (got ${args.amountInBase})`,
    );
  }
  if (args.slippageBps < 0 || args.slippageBps > 10_000) {
    throw new Error(
      `swapJupiter: slippageBps out of range (got ${args.slippageBps})`,
    );
  }

  // ─── 1. Quote ───────────────────────────────────────────────────────────
  const quoteUrl = new URL(JUP_QUOTE_URL);
  quoteUrl.searchParams.set("inputMint", args.inputMint);
  quoteUrl.searchParams.set("outputMint", args.outputMint);
  quoteUrl.searchParams.set("amount", args.amountInBase.toString());
  quoteUrl.searchParams.set("slippageBps", args.slippageBps.toString());
  // web3.js v1 surfpool mode rejects v0 in some configs — pin to legacy for now.
  quoteUrl.searchParams.set("asLegacyTransaction", "true");

  const quoteResp = await fetch(quoteUrl);
  if (!quoteResp.ok) {
    const body = await quoteResp.text().catch(() => "<no body>");
    throw new Error(
      `Jupiter /quote ${quoteResp.status} ${quoteResp.statusText}: ${body.slice(0, 300)}`,
    );
  }
  const quote = (await quoteResp.json()) as JupQuoteResponse;

  // ─── 2. Swap (build tx) ────────────────────────────────────────────────
  const swapResp = await fetch(JUP_SWAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: agentKp.publicKey.toBase58(),
      // web3.js v1 surfpool mode rejects v0 in some configs — pin to legacy for now.
      asLegacyTransaction: true,
      // Let Jupiter bake in a priority fee; do NOT add another downstream.
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!swapResp.ok) {
    const body = await swapResp.text().catch(() => "<no body>");
    throw new Error(
      `Jupiter /swap ${swapResp.status} ${swapResp.statusText}: ${body.slice(0, 300)}`,
    );
  }
  const swap = (await swapResp.json()) as JupSwapResponse;

  // ─── 3. Sign + send ────────────────────────────────────────────────────
  const txBytes = Buffer.from(swap.swapTransaction, "base64");
  const tx = Transaction.from(txBytes);
  // Refresh blockhash on surfpool: Jupiter's quote pulled mainnet's, which
  // the fork may not recognize. Same wide-window pattern as marinade/kamino.
  const { blockhash, lastValidBlockHeight } =
    await surfpool.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight + 300;
  tx.feePayer = agentKp.publicKey;
  tx.partialSign(agentKp);

  const txSig = await sendAndConfirmRawTransaction(
    surfpool,
    tx.serialize(),
    { commitment: "confirmed", skipPreflight: true },
  );

  return {
    protocol: "jupiter",
    action: "swap",
    txSig,
    inputAmount: BigInt(quote.inAmount),
    outputAmount: BigInt(quote.outAmount),
    routePlan: describeRoute(quote),
  };
}
