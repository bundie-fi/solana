/**
 * x402 micropayment middleware for the v1 oracle API.
 *
 * x402 is the Coinbase-backed HTTP 402-flavoured spec: clients send a
 * signed payment header per request; servers verify the payment satisfies
 * the endpoint's required amount before serving the response. Spec:
 * https://x402.org
 *
 * v1 implementation:
 *   - Free tier in development (BUNDIE_X402_ENFORCE != "true"). The
 *     middleware logs that it would have charged but lets the request
 *     through with X-X402-Tier: free.
 *   - When enforcement is on, verifies the X-PAYMENT header carries a
 *     valid Solana transaction signature paying at least the endpoint's
 *     priced amount to the treasury wallet.
 *   - Treasury wallet is BUNDIE_X402_TREASURY env (base58 pubkey).
 *
 * Actual signature + on-chain settlement verification lands when the
 * x402 reference SDK ships a Solana adapter (currently EVM-only). For
 * v1 devnet we use the free tier; production hardens this before mainnet.
 */

import type { Context, MiddlewareHandler } from "hono";

/** Map endpoint path → required payment amount in USDC base units (6dp). */
export const ENDPOINT_PRICES: Record<string, number> = {
  "/v1/event-price": 1_000, // $0.001
  "/v1/event-history": 5_000, // $0.005
  "/v1/event-detail": 2_000, // $0.002
  "/v1/hedge-quote": 10_000, // $0.01
};

const ENFORCE = process.env.BUNDIE_X402_ENFORCE === "true";
const TREASURY = process.env.BUNDIE_X402_TREASURY ?? "";

/**
 * Middleware factory for x402 micropayments. Mount on individual routes
 * via `.use(...)` after pricing each endpoint in ENDPOINT_PRICES.
 */
export function x402(): MiddlewareHandler {
  return async (c: Context, next) => {
    const path = c.req.path;
    const price = ENDPOINT_PRICES[path];

    if (price === undefined) {
      // Unpriced endpoint — pass through (e.g. /v1/events list is free).
      return next();
    }

    const paymentHeader = c.req.header("X-PAYMENT") ?? c.req.header("x-payment");

    if (!ENFORCE) {
      c.header("X-X402-Tier", "free");
      c.header("X-X402-Would-Charge-Base-Units", String(price));
      if (paymentHeader) {
        c.header("X-X402-Note", "payment-header-ignored-in-dev");
      }
      return next();
    }

    // Enforced path — verify the payment.
    if (!paymentHeader) {
      c.status(402);
      return c.json({
        error: "Payment required",
        endpoint: path,
        price_usdc_base_units: price,
        accepted_methods: ["x402"],
        treasury: TREASURY,
      });
    }

    // TODO(v1.5): verify Solana tx signature + treasury credit + amount
    // matches `price`. For now ENFORCE=true is effectively a no-op past
    // the header presence check until the Solana x402 SDK ships. Logged
    // so we can audit when the verifier is wired.
    c.header("X-X402-Tier", "paid-unverified");
    c.header("X-X402-Verify-Pending", "v1.5");
    console.log(
      `[x402] paid request (unverified): path=${path} price=${price} header_present=true`,
    );
    return next();
  };
}

/** Convenience: mount x402 on a Hono app. */
export function applyX402(app: { use: (path: string, mw: MiddlewareHandler) => void }): void {
  app.use("/v1/*", x402());
}
