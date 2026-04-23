#!/usr/bin/env -S node --enable-source-maps
/**
 * probe-drift-spotmarket.ts - NAV-reader offset regression probe for Drift.
 *
 * Why: `packages/programs/programs/strategy-token/src/nav_readers/drift.rs`
 * reads a Drift `SpotMarket` account by hard-coded byte offsets. Drift has
 * re-laid out this struct between minor protocol-v2 versions in the past -
 * notably `cumulative_deposit_interest` was at 432 (wrong, returned junk
 * `total_spot_fee` bytes) and was corrected to 480 on 2026-04-23.
 *
 * This probe fetches a known live SpotMarket PDA from devnet, slices the
 * exact bytes the NAV reader slices, and asserts they are still in plausible
 * ranges. If Drift ships an SDK upgrade that shuffles the struct, this
 * probe fails CI before the bad layout silently corrupts NAV -> corrupts
 * prediction-market settlement.
 *
 * Reference fixture: SpotMarket `6gMq3mRCKf8aP3ttTyYhuijVZ2LGi14oDsBbkgubfLB3`
 * on devnet. This is a stable, long-lived market on Drift's devnet
 * deployment (program `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`).
 *
 * Read-only. Usage:
 *   pnpm --filter @bundie/programs probe:drift
 *   RPC_URL=https://... pnpm --filter @bundie/programs probe:drift
 */
import { Connection, PublicKey } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

// --- Fixture --------------------------------------------------------------
const DRIFT_PROGRAM_ID = new PublicKey(
  "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
);
// Live devnet SpotMarket - same one referenced in drift.rs line 116.
const SPOT_MARKET_PDA = new PublicKey(
  "6gMq3mRCKf8aP3ttTyYhuijVZ2LGi14oDsBbkgubfLB3",
);

// Offsets MUST match those in
// packages/programs/programs/strategy-token/src/nav_readers/drift.rs.
const SPOT_MARKET_OFFSET_MINT = 72;
const SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST = 480;
// `decimals: u32` lives near the tail of SpotMarket. Not currently consumed
// by drift.rs, but a sanity-check anchor - if upstream reshuffles the
// struct head this typically moves too.
const SPOT_MARKET_OFFSET_DECIMALS = 680;
const SPOT_MARKET_MIN_LEN = SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST + 16;

// `cumulative_deposit_interest` is Q1e10 - i.e. 1.0x = 10_000_000_000.
// Plausible range right after market init through several years of accrual:
// 1e10 (= 1.0) up to ~1e12 (= 100x, would be extreme).
const CDI_MIN = 10_000_000_000n;       // 1e10
const CDI_MAX = 1_000_000_000_000n;    // 1e12

const DECIMALS_MIN = 0;
const DECIMALS_MAX = 9;

function fail(msg: string): never {
  console.error(`x DRIFT PROBE FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  console.log(`probe-drift-spotmarket - RPC ${RPC_URL}`);
  console.log(`  fixture: ${SPOT_MARKET_PDA.toBase58()}`);

  const conn = new Connection(RPC_URL, "confirmed");
  const info = await conn.getAccountInfo(SPOT_MARKET_PDA, "confirmed");
  if (!info) fail(`account not found at ${SPOT_MARKET_PDA.toBase58()}`);

  if (!info.owner.equals(DRIFT_PROGRAM_ID)) {
    fail(
      `wrong owner - expected ${DRIFT_PROGRAM_ID.toBase58()}, got ${info.owner.toBase58()}`,
    );
  }
  if (info.data.length < SPOT_MARKET_MIN_LEN) {
    fail(
      `account too small - expected >= ${SPOT_MARKET_MIN_LEN} bytes, got ${info.data.length}`,
    );
  }

  // mint @ 72..104
  const mintBytes = info.data.subarray(
    SPOT_MARKET_OFFSET_MINT,
    SPOT_MARKET_OFFSET_MINT + 32,
  );
  const mint = new PublicKey(mintBytes);
  if (mint.equals(PublicKey.default)) {
    fail(`mint at offset ${SPOT_MARKET_OFFSET_MINT} is the zero pubkey`);
  }

  // cumulative_deposit_interest @ 480..496 (u128 LE)
  const lo = info.data.readBigUInt64LE(
    SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST,
  );
  const hi = info.data.readBigUInt64LE(
    SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST + 8,
  );
  const cdi = (hi << 64n) | lo;

  // decimals @ 680 (u32 LE - value should fit in a u8)
  const decimals = info.data.readUInt32LE(SPOT_MARKET_OFFSET_DECIMALS);

  console.log(`  account length:                ${info.data.length}`);
  console.log(`  mint @${SPOT_MARKET_OFFSET_MINT}:                       ${mint.toBase58()}`);
  console.log(
    `  cumulative_deposit_interest @${SPOT_MARKET_OFFSET_CUMULATIVE_DEPOSIT_INTEREST}: ${cdi.toString()}  (~${(Number(cdi) / 1e10).toFixed(6)}x in Q1e10)`,
  );
  console.log(`  decimals @${SPOT_MARKET_OFFSET_DECIMALS}:                   ${decimals}`);

  // --- Assertions --------------------------------------------------------
  if (decimals < DECIMALS_MIN || decimals > DECIMALS_MAX) {
    fail(
      `decimals out of range - expected ${DECIMALS_MIN}..=${DECIMALS_MAX}, got ${decimals} (struct layout drift?)`,
    );
  }
  if (cdi < CDI_MIN || cdi > CDI_MAX) {
    fail(
      `cumulative_deposit_interest out of plausible Q1e10 range - expected ${CDI_MIN.toString()}..=${CDI_MAX.toString()}, got ${cdi.toString()} (struct layout drift?)`,
    );
  }

  console.log(`ok DRIFT PROBE PASS - offsets stable`);
}

main().catch((e) => {
  console.error(`x DRIFT PROBE ERROR: ${e?.stack || e}`);
  process.exit(2);
});
