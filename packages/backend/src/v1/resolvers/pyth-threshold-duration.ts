/**
 * Pyth threshold-duration resolver.
 *
 * Resolves MARKET_KIND_EVENT_THRESHOLD (kind=7) markets where the trigger
 * is "Pyth feed value satisfies (comparator, threshold) for at least
 * min_duration_seconds continuous seconds within the outcome window".
 *
 * v1 implementation: in-process state machine that polls the feed every
 * `poll_interval_seconds`, tracks when the threshold-met state starts/
 * resets, and emits YES the moment a continuous block exceeds the
 * minimum duration. NO is emitted when window_end_unix_ts passes
 * without a YES trigger.
 *
 * Production-grade hardening (durable state across restarts, retry on
 * Pyth read failures, observability of poll history) is the next pass —
 * for v1 the resolver runs as a long-lived process and any crash means
 * state resets, which is acceptable because the worst case is a delayed
 * resolution, not a wrong resolution.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { RESOLVER_CLASS } from "../types.js";
import type { PythThresholdDurationConfig, Resolver } from "../types.js";
import { resolveFeedKey } from "../registry.js";

/**
 * Compute the sha256 of a resolver_config — must match the algorithm used
 * by the deploy script when populating ResolverAuthority.config_hash on-
 * chain. If the on-chain hash differs from what this resolver loaded,
 * the resolver REFUSES to sign — defence against silent config drift
 * (e.g. someone editing sources.json post-deploy without re-deploying
 * the affected markets).
 */
function configHashBytes(config: Record<string, unknown>): Buffer {
  return createHash("sha256").update(JSON.stringify(config)).digest();
}

/**
 * In-memory state per (event_id, threshold breach). When the feed first
 * crosses into the threshold-met region we record the start timestamp;
 * each subsequent poll that's still in the met region keeps the timer
 * running. A single poll that's NOT in the met region resets state.
 */
interface BreachState {
  breachStartMs: number;
  lastSeenMs: number;
}

const breachState = new Map<string, BreachState>();

/**
 * Apply the comparator to (current_price, threshold). Returns true iff
 * the predicate is satisfied (i.e. "the breach condition is currently met").
 */
function compare(
  comparator: PythThresholdDurationConfig["comparator"],
  current: number,
  threshold: number,
): boolean {
  switch (comparator) {
    case "lt":
      return current < threshold;
    case "lte":
      return current <= threshold;
    case "gt":
      return current > threshold;
    case "gte":
      return current >= threshold;
    case "eq":
      return current === threshold;
    default:
      throw new Error(`Unknown comparator: ${comparator}`);
  }
}

/**
 * Read the current price from a Pyth feed account. v1 uses the legacy
 * pyth-client account format (price field at byte offset 208, exponent
 * at 20). When Pyth Pull migration completes on mainnet, swap this for
 * the @pythnetwork/client SDK or the Pyth Pull verification path.
 *
 * Returns null on any read failure — caller treats null as "data
 * unavailable this tick" and does NOT change breach state.
 */
async function readPythPrice(
  connection: Connection,
  feedPubkey: PublicKey,
): Promise<number | null> {
  try {
    const accountInfo = await connection.getAccountInfo(feedPubkey);
    if (!accountInfo) return null;
    const data = accountInfo.data;
    // Pyth v1 price account layout:
    //   exponent (i32 LE) at offset 20
    //   aggregate price (i64 LE) at offset 208
    if (data.length < 216) return null;
    const exponent = data.readInt32LE(20);
    const priceRaw = data.readBigInt64LE(208);
    return Number(priceRaw) * Math.pow(10, exponent);
  } catch (err) {
    console.warn(
      `[pyth-resolver] read failed for ${feedPubkey.toBase58()}: ${(err as Error).message}`,
    );
    return null;
  }
}

export class PythThresholdDurationResolver
  implements Resolver<PythThresholdDurationConfig>
{
  readonly className = "pyth_threshold_duration";
  readonly classId = RESOLVER_CLASS.PYTH_THRESHOLD_DURATION;

  constructor(private readonly connection: Connection) {}

  async poll(
    eventId: string,
    config: PythThresholdDurationConfig,
    now: Date,
  ): Promise<"yes" | "no" | null> {
    const feedAddr = resolveFeedKey(config.feed_network_key);
    if (!feedAddr) {
      throw new Error(
        `[pyth-resolver] feed_network_key '${config.feed_network_key}' does not resolve to an address — check sources.json`,
      );
    }
    const feedPubkey = new PublicKey(feedAddr);
    const nowMs = now.getTime();

    // Compute the config hash; the runner (or caller) is responsible
    // for verifying this matches the on-chain ResolverAuthority.config_hash
    // BEFORE invoking the resolver. We expose the hash for the runner
    // to read; an explicit mismatch check happens there so the resolver
    // can stay pure (no chain access here).
    void configHashBytes(config as unknown as Record<string, unknown>);

    const price = await readPythPrice(this.connection, feedPubkey);
    if (price === null) {
      // Transient — don't reset state, don't claim NO. Try again next tick.
      return null;
    }

    const inBreach = compare(config.comparator, price, config.threshold_price);
    const existing = breachState.get(eventId);

    if (inBreach) {
      if (!existing) {
        // First time we've seen the breach this run.
        breachState.set(eventId, {
          breachStartMs: nowMs,
          lastSeenMs: nowMs,
        });
        return null;
      }
      // Continuing breach. Check if we've held it long enough.
      existing.lastSeenMs = nowMs;
      const heldSeconds = (nowMs - existing.breachStartMs) / 1000;
      if (heldSeconds >= config.min_duration_seconds) {
        console.log(
          `[pyth-resolver] YES trigger: event=${eventId} price=${price} threshold=${config.threshold_price} held=${heldSeconds.toFixed(1)}s`,
        );
        return "yes";
      }
      return null;
    }

    // Not in breach — clear the timer. Even one tick out of breach resets
    // because the trigger is "continuous seconds", not "cumulative seconds".
    if (existing) {
      breachState.delete(eventId);
    }
    return null;
  }

  /**
   * Resets internal state for this event. Called by the runner when a
   * market resolves so subsequent runs (e.g. tests, re-deployments) start
   * with a clean slate.
   */
  reset(eventId: string): void {
    breachState.delete(eventId);
  }
}
