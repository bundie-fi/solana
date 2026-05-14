/**
 * Tiny in-memory token-bucket rate limiter for the /v1 surface.
 *
 * v1 ships with one bucket per IP per endpoint group. Sufficient for
 * the devnet-beta phase; production behind a CDN/edge will want
 * something distributed (Redis or upstash) so multiple backend instances
 * share the same view.
 *
 * Defaults:
 *   - 10 req/sec burst per IP for the free /v1/events endpoint
 *   - 100 req/min burst per IP for x402-priced endpoints (paid traffic
 *     gets more headroom; abuse is caught by the payment requirement)
 *   - 60 req/hour per IP for the unsigned `BUNDIE_X402_ENFORCE=false`
 *     dev-tier endpoints — generous enough for development, hostile
 *     enough that bot traffic doesn't drown the API
 */

import type { Context, MiddlewareHandler } from "hono";

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

interface RateLimitConfig {
  capacity: number;
  refillPerSecond: number;
  /** Optional label for logging when a request is rejected. */
  label?: string;
}

const buckets = new Map<string, Bucket>();

function key(c: Context, scope: string): string {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  return `${scope}:${ip}`;
}

export function rateLimit(scope: string, cfg: RateLimitConfig): MiddlewareHandler {
  return async (c, next) => {
    const k = key(c, scope);
    const now = Date.now();
    let bucket = buckets.get(k);
    if (!bucket) {
      bucket = { tokens: cfg.capacity, lastRefillMs: now };
      buckets.set(k, bucket);
    }
    // Refill since last access.
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(
      cfg.capacity,
      bucket.tokens + elapsedSec * cfg.refillPerSecond,
    );
    bucket.lastRefillMs = now;

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / cfg.refillPerSecond);
      c.header("Retry-After", String(retryAfter));
      c.status(429);
      return c.json({
        error: "Rate limit exceeded",
        scope: cfg.label ?? scope,
        retry_after_seconds: retryAfter,
      });
    }
    bucket.tokens -= 1;
    return next();
  };
}

/**
 * Periodic GC for stale buckets so an attacker can't blow up memory by
 * rotating IPs. Called once at process start; runs every 5 minutes.
 */
export function startRateLimitGc(intervalMs = 5 * 60 * 1000): void {
  setInterval(() => {
    const now = Date.now();
    const cutoff = now - 10 * 60 * 1000; // 10 min stale
    for (const [k, b] of buckets) {
      if (b.lastRefillMs < cutoff) buckets.delete(k);
    }
  }, intervalMs).unref?.();
}
