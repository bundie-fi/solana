/**
 * On-chain TVL rolling-window resolver.
 *
 * Resolves `MARKET_KIND_PROTOCOL_TVL_DROP` (kind=8) markets where the
 * trigger is "the protocol's reported TVL dropped by at least
 * drop_threshold_usd within any rolling_window_seconds-wide window over
 * the outcome_window_seconds horizon".
 *
 * v1 implementation: in-process ring buffer of {ts, tvl_usd} samples per
 * eventId. On each `poll()`, decode the protocol-specific TVL from the
 * configured account (raw byte offsets, no IDL), append the sample, trim
 * entries older than `rolling_window + outcome_window`, then scan the
 * buffer for any 24h-rolling window where max-min >= drop_threshold_usd.
 *
 * Dispatch is by `protocol` field. v1 ships the Kamino reader (klend
 * `Reserve`); MarginFi / Solend stubs throw. Add new protocols by writing
 * a `read{Protocol}Tvl()` helper and adding a case to `readProtocolTvl`.
 *
 * Price source caveat: v1 takes a `price_usd` stub from sources.json so
 * the resolver runs on devnet without a Pyth feed wired in. PRODUCTION
 * must swap this for a Pyth read (similar to pyth-threshold-duration.ts)
 * — letting an admin pin a static USD price in sources.json is fine for
 * USDC pools where the peg holds, but unacceptable for volatile assets.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { RESOLVER_CLASS } from "../types.js";
import type { Resolver } from "../types.js";

export interface OnchainTvlRollingWindowConfig {
  protocol: string;
  tvl_account: string;
  drop_threshold_usd: number;
  rolling_window_seconds: number;
  outcome_window_seconds: number;
  poll_interval_seconds: number;
  /**
   * Stub USD price for the underlying liquidity mint. Devnet-only — see
   * file docstring. Defaults to 1.0 if absent so USDC pools "just work".
   */
  price_usd?: number;
}

/** One TVL sample point. */
interface TvlSample {
  tsMs: number;
  tvlUsd: number;
}

/** Per-event ring buffer + launch timestamp. */
interface EventState {
  startMs: number;
  samples: TvlSample[];
}

const eventState = new Map<string, EventState>();

// ---------------------------------------------------------------------------
// Kamino klend Reserve byte offsets — verified live against devnet reserve
// 9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy. Mirrors the offsets in
// packages/programs/programs/strategy-token/src/nav_readers/kamino.rs and
// scripts/probes/probe-kamino-reserve.ts. If those drift, this resolver
// will silently start returning wrong TVL — keep the three call sites in
// sync.
// ---------------------------------------------------------------------------
const KAMINO_OFFSET_LIQUIDITY_MINT = 128;
const KAMINO_OFFSET_LIQUIDITY_AVAILABLE = 224;
const KAMINO_OFFSET_LIQUIDITY_BORROWED_SF = 232;
const KAMINO_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY = 1376;
const KAMINO_RESERVE_MIN_LEN = KAMINO_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY + 8;
const KAMINO_SF_SCALE_BITS = 60n;

/** SPL Mint layout: decimals @ offset 44 (u8). */
const SPL_MINT_DECIMALS_OFFSET = 44;
const SPL_MINT_MIN_LEN = 82;

/**
 * Validate that a string is a parseable base58 pubkey. Rejects the
 * `[VERIFY]` placeholder strings used in sources.json before the
 * resolver_config is fully populated.
 */
function parsePubkey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(
      `[onchain-tvl] ${label} is not a valid base58 pubkey: '${value}'`,
    );
  }
}

/**
 * Decode a klend Reserve account → native-units TVL (available + borrowed
 * detoken'd by >>60). Also returns the liquidity mint so the caller can
 * fetch decimals for USD conversion.
 */
async function readKaminoReserveTvl(
  connection: Connection,
  reservePubkey: PublicKey,
): Promise<{ nativeTvl: bigint; liquidityMint: PublicKey } | null> {
  const info = await connection.getAccountInfo(reservePubkey, "confirmed");
  if (!info) {
    console.warn(
      `[onchain-tvl] kamino reserve ${reservePubkey.toBase58()} not found`,
    );
    return null;
  }
  if (info.data.length < KAMINO_RESERVE_MIN_LEN) {
    console.warn(
      `[onchain-tvl] kamino reserve ${reservePubkey.toBase58()} too small: ${info.data.length} < ${KAMINO_RESERVE_MIN_LEN}`,
    );
    return null;
  }

  const liquidityMint = new PublicKey(
    info.data.subarray(
      KAMINO_OFFSET_LIQUIDITY_MINT,
      KAMINO_OFFSET_LIQUIDITY_MINT + 32,
    ),
  );
  const available = info.data.readBigUInt64LE(KAMINO_OFFSET_LIQUIDITY_AVAILABLE);
  const bLo = info.data.readBigUInt64LE(KAMINO_OFFSET_LIQUIDITY_BORROWED_SF);
  const bHi = info.data.readBigUInt64LE(
    KAMINO_OFFSET_LIQUIDITY_BORROWED_SF + 8,
  );
  const borrowedSf = (bHi << 64n) | bLo;
  const borrowed = borrowedSf >> KAMINO_SF_SCALE_BITS;
  const nativeTvl = available + borrowed;
  return { nativeTvl, liquidityMint };
}

/**
 * Read the decimals byte from an SPL Mint account. Returns null on any
 * read failure — caller treats null as "skip this tick".
 */
async function readMintDecimals(
  connection: Connection,
  mint: PublicKey,
): Promise<number | null> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) return null;
  if (info.data.length < SPL_MINT_MIN_LEN) return null;
  return info.data.readUInt8(SPL_MINT_DECIMALS_OFFSET);
}

/**
 * Dispatch on `protocol` field. Returns USD-denominated TVL, or null on
 * transient read failure (caller skips the tick — does NOT poison the
 * ring buffer with a zero sample).
 */
async function readProtocolTvl(
  connection: Connection,
  config: OnchainTvlRollingWindowConfig,
  tvlAccount: PublicKey,
): Promise<number | null> {
  switch (config.protocol) {
    case "kamino_main_lending": {
      const reserve = await readKaminoReserveTvl(connection, tvlAccount);
      if (!reserve) return null;
      const decimals = await readMintDecimals(connection, reserve.liquidityMint);
      if (decimals === null) return null;
      const priceUsd = config.price_usd ?? 1.0;
      // bigint → number via division by 10^decimals. For USDC (6 dp) and a
      // realistic Kamino TVL ceiling (~$1B = 1e15 native units) this stays
      // well below Number.MAX_SAFE_INTEGER (~9e15).
      const denom = 10 ** decimals;
      const nativeAsNumber = Number(reserve.nativeTvl);
      return (nativeAsNumber / denom) * priceUsd;
    }
    case "marginfi_main":
      throw new Error(
        `[onchain-tvl] protocol 'marginfi_main' not yet implemented`,
      );
    case "solend_main":
      throw new Error(
        `[onchain-tvl] protocol 'solend_main' not yet implemented`,
      );
    default:
      throw new Error(
        `[onchain-tvl] unknown protocol '${config.protocol}'`,
      );
  }
}

/**
 * Scan the ring buffer for any rolling `windowSeconds`-wide window where
 * max(tvl) - min(tvl) >= threshold. Linear scan — N stays small (90d /
 * 60s poll = 129,600 samples worst case, well within memory/CPU budget
 * for the runner's tick cadence).
 */
function detectDrop(
  samples: TvlSample[],
  windowSeconds: number,
  thresholdUsd: number,
): { maxTvl: number; minTvl: number; dropUsd: number } | null {
  const windowMs = windowSeconds * 1000;
  for (let i = 0; i < samples.length; i++) {
    const anchor = samples[i];
    let maxTvl = anchor.tvlUsd;
    let minTvl = anchor.tvlUsd;
    for (let j = i; j < samples.length; j++) {
      const s = samples[j];
      if (s.tsMs - anchor.tsMs > windowMs) break;
      if (s.tvlUsd > maxTvl) maxTvl = s.tvlUsd;
      if (s.tvlUsd < minTvl) minTvl = s.tvlUsd;
      if (maxTvl - minTvl >= thresholdUsd) {
        return { maxTvl, minTvl, dropUsd: maxTvl - minTvl };
      }
    }
  }
  return null;
}

export class OnchainTvlRollingWindowResolver
  implements Resolver<OnchainTvlRollingWindowConfig>
{
  readonly className = "onchain_tvl_rolling_window";
  readonly classId = RESOLVER_CLASS.ONCHAIN_TVL_ROLLING_WINDOW;

  constructor(private readonly connection: Connection) {}

  async poll(
    eventId: string,
    config: OnchainTvlRollingWindowConfig,
    now: Date,
  ): Promise<"yes" | "no" | null> {
    const tvlAccount = parsePubkey(config.tvl_account, "tvl_account");
    const nowMs = now.getTime();

    let state = eventState.get(eventId);
    if (!state) {
      state = { startMs: nowMs, samples: [] };
      eventState.set(eventId, state);
    }
    const windowEndMs = state.startMs + config.outcome_window_seconds * 1000;

    const tvlUsd = await readProtocolTvl(this.connection, config, tvlAccount);
    if (tvlUsd === null) {
      // Transient read failure — don't poison the buffer with a fake zero
      // (which would spuriously trigger YES). Try again next tick.
      return null;
    }
    state.samples.push({ tsMs: nowMs, tvlUsd });

    // Trim entries older than (rolling + outcome) — anything older can't
    // contribute to a still-relevant rolling window.
    const retentionMs =
      (config.rolling_window_seconds + config.outcome_window_seconds) * 1000;
    const cutoff = nowMs - retentionMs;
    while (state.samples.length > 0 && state.samples[0].tsMs < cutoff) {
      state.samples.shift();
    }

    const drop = detectDrop(
      state.samples,
      config.rolling_window_seconds,
      config.drop_threshold_usd,
    );
    if (drop) {
      console.log(
        `[onchain-tvl] YES trigger: event=${eventId} drop=$${drop.dropUsd.toFixed(0)} (max=$${drop.maxTvl.toFixed(0)} min=$${drop.minTvl.toFixed(0)}) threshold=$${config.drop_threshold_usd}`,
      );
      return "yes";
    }

    if (nowMs >= windowEndMs) {
      console.log(
        `[onchain-tvl] NO: event=${eventId} outcome window expired without breach`,
      );
      return "no";
    }
    return null;
  }
}
