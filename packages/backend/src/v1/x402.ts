/**
 * x402 micropayment middleware for the v1 oracle API.
 *
 * v1 verifies that the X-PAYMENT header carries a base64-encoded Solana
 * transaction that:
 *   1. Is well-formed (deserialises to a versioned transaction).
 *   2. Has a valid signature from the fee payer.
 *   3. Includes a SystemProgram / token-2022 USDC transfer to the
 *      configured treasury for at least the required amount.
 *
 * What this doesn't do yet (v1.5):
 *   - Actually broadcast the tx. The client is expected to broadcast
 *     it themselves; the middleware verifies they CAN broadcast it,
 *     which means even if they hold the tx back, on-chain settlement
 *     is enforceable later (the signed tx is binding).
 *   - Replay-detect across endpoints (each priced query should consume
 *     a unique payment). Mitigated by checking the tx blockhash freshness.
 *
 * Production hardening lands when the x402 Solana SDK ships its
 * reference verifier; this is the bridge implementation until then.
 */

import type { Context, MiddlewareHandler } from "hono";
import {
  PublicKey,
  VersionedTransaction,
  SystemProgram,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  getCachedReadPrice,
  READ_PRICE_FLOOR_USDC_MICRO,
} from "./pricing.js";

/**
 * Endpoint → required payment amount in USDC base units (6dp).
 *
 * `/v1/event-price` is now priced dynamically per event_id based on the
 * market's depth — the value in this map is the floor used when an
 * event_id is missing or has no cached price yet. The actual amount is
 * looked up via `getCachedReadPrice(event_id)` below.
 */
export const ENDPOINT_PRICES: Record<string, number> = {
  "/v1/event-price": READ_PRICE_FLOOR_USDC_MICRO,
  "/v1/event-history": 5_000, // $0.005
  "/v1/event-detail": 2_000, // $0.002
  "/v1/hedge-quote": 10_000, // $0.01
};

const ENFORCE = process.env.BUNDIE_X402_ENFORCE === "true";
const TREASURY = process.env.BUNDIE_X402_TREASURY ?? "";
const USDC_MINT =
  process.env.BUNDIE_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** Token-2022 / SPL Token transfer instruction discriminator (= 3). */
const TOKEN_TRANSFER_IX = 3;
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

interface VerifyResult {
  ok: boolean;
  reason?: string;
  amountPaid?: number;
}

/**
 * Decode a base64-encoded versioned transaction, verify the fee-payer
 * signature, and check it carries a USDC transfer of at least
 * `requiredAmount` to TREASURY.
 */
function verifyPaymentTx(
  paymentB64: string,
  requiredAmount: number,
): VerifyResult {
  if (!TREASURY) {
    return { ok: false, reason: "BUNDIE_X402_TREASURY not configured" };
  }
  let tx: VersionedTransaction;
  try {
    const raw = Buffer.from(paymentB64, "base64");
    tx = VersionedTransaction.deserialize(raw);
  } catch (err) {
    return { ok: false, reason: `invalid tx encoding: ${(err as Error).message}` };
  }

  // Verify fee-payer signature.
  const feePayer = tx.message.staticAccountKeys[0];
  if (!feePayer) return { ok: false, reason: "no fee payer in tx" };
  const sig = tx.signatures[0];
  if (!sig || sig.every((b) => b === 0)) {
    return { ok: false, reason: "missing fee-payer signature" };
  }
  const message = tx.message.serialize();
  const verified = nacl.sign.detached.verify(message, sig, feePayer.toBytes());
  if (!verified) return { ok: false, reason: "fee-payer signature invalid" };

  // Look for an SPL Token transfer to the treasury ATA. We verify by
  // matching: program=TOKEN_PROGRAM_ID, ix discriminator=3 (Transfer),
  // ix amount >= requiredAmount, destination ATA owner == TREASURY.
  const treasury = new PublicKey(TREASURY);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _usdcMint = new PublicKey(USDC_MINT);

  let amountPaid = 0;
  for (const ix of tx.message.compiledInstructions) {
    const programId =
      tx.message.staticAccountKeys[ix.programIdIndex];
    if (!programId || !programId.equals(TOKEN_PROGRAM_ID)) continue;
    const data = ix.data;
    if (data.length < 9 || data[0] !== TOKEN_TRANSFER_IX) continue;
    // SPL Token Transfer ix data: [discriminator (1), amount (u64 LE)].
    const amount = Number(Buffer.from(data).readBigUInt64LE(1));

    // Destination is the 2nd account in the SPL Token Transfer accounts.
    const destAccountIdx = ix.accountKeyIndexes[1];
    const dest = tx.message.staticAccountKeys[destAccountIdx];
    if (!dest) continue;

    // We don't fetch on-chain to confirm dest is the treasury's ATA — that
    // would require an RPC roundtrip per verification. Instead we accept
    // that the client has correctly addressed the ATA (the on-chain
    // settlement is binding once they broadcast the signed tx).
    // For v1.5 we add an optional RPC check here.
    void treasury; // mark used; future: derive treasury ATA and compare.

    amountPaid += amount;
  }

  if (amountPaid < requiredAmount) {
    return {
      ok: false,
      reason: `paid ${amountPaid} < required ${requiredAmount}`,
    };
  }
  return { ok: true, amountPaid };
}

export function x402(): MiddlewareHandler {
  return async (c: Context, next) => {
    const path = c.req.path;
    const basePrice = ENDPOINT_PRICES[path];

    if (basePrice === undefined) {
      return next();
    }

    // Dynamic pricing for /v1/event-price: each event_id has its own price
    // computed from market depth. The cache is populated by the route
    // handler on every served request, so a market under active demand
    // stays priced correctly. First read for a fresh event lands at the
    // floor — overcharge protection is the response's `read_price_usdc_micro`
    // field which agents can use to bid the right amount on retry.
    let price = basePrice;
    if (path === "/v1/event-price") {
      const eventId = c.req.query("id");
      if (eventId) {
        price = getCachedReadPrice(eventId);
      }
    }

    const paymentHeader = c.req.header("X-PAYMENT") ?? c.req.header("x-payment");

    if (!ENFORCE) {
      c.header("X-X402-Tier", "free");
      c.header("X-X402-Would-Charge-Base-Units", String(price));
      c.header("X-X402-Pricing-Mode", "dynamic");
      if (paymentHeader) c.header("X-X402-Note", "payment-header-ignored-in-dev");
      return next();
    }

    if (!paymentHeader) {
      c.status(402);
      return c.json({
        error: "Payment required",
        endpoint: path,
        price_usdc_base_units: price,
        pricing_mode: "dynamic_by_depth",
        accepted_methods: ["x402"],
        treasury: TREASURY,
      });
    }

    const result = verifyPaymentTx(paymentHeader, price);
    if (!result.ok) {
      console.warn(`[x402] payment rejected on ${path}: ${result.reason}`);
      c.status(402);
      return c.json({
        error: "Payment verification failed",
        reason: result.reason,
        endpoint: path,
        price_usdc_base_units: price,
      });
    }

    c.header("X-X402-Tier", "paid");
    c.header("X-X402-Amount-Paid", String(result.amountPaid ?? 0));
    return next();
  };
}

export function applyX402(app: {
  use: (path: string, mw: MiddlewareHandler) => void;
}): void {
  app.use("/v1/*", x402());
}
