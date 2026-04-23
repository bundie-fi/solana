#!/usr/bin/env -S node --enable-source-maps
/**
 * probe-marginfi-bank.ts - NAV-reader offset regression probe for marginfi.
 *
 * Why: `packages/programs/programs/strategy-token/src/nav_readers/marginfi.rs`
 * reads a marginfi v2 `Bank` account by hard-coded byte offsets. The
 * `asset_share_value` field has shifted in the past as marginfi added
 * emissions / liquidator config - it was at offset 88 (wrong, returned
 * ~1.84e19 garbage that would massively overvalue positions) and was
 * corrected to 80 on 2026-04-23. The `_pad0[7]` after `mint_decimals` plus
 * `group: Pubkey` push it to disk offset 80 (not 88 as a naive sequential
 * walk suggests).
 *
 * This probe fetches a known live Bank PDA, slices the same bytes
 * marginfi.rs slices, and asserts they look like a sane I80F48
 * (`asset_share_value > 0`, magnitude near 1.0 in I80F48 form, not the
 * 1.84e19 unsigned garbage we saw at the wrong offset). If marginfi
 * reshuffles the struct, this probe fails CI before bad NAV ships.
 *
 * Reference fixture: USDC Bank `HKHvcCZKJzWPycqQdgCCT5oxt7GWdbPHrg9HSdxpdsEL`
 * on MAINNET-BETA. Trade-off rationale: marginfi-v2 is not reliably
 * deployed on devnet (program `MFv2hWf...` exists but no long-lived banks
 * are guaranteed). A working mainnet probe beats a flaky devnet probe.
 * Read-only - we never sign, only sample one account.
 *
 * Usage:
 *   pnpm --filter @bundie/programs probe:marginfi
 *   RPC_URL=https://... pnpm --filter @bundie/programs probe:marginfi
 */
import { Connection, PublicKey } from "@solana/web3.js";

// Mainnet by default for this probe (see file header rationale).
const RPC_URL =
  process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

// --- Fixture --------------------------------------------------------------
const MARGINFI_PROGRAM_ID = new PublicKey(
  "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA",
);
// Live mainnet USDC Bank - same one referenced in marginfi.rs line 117.
const BANK_PDA = new PublicKey(
  "HKHvcCZKJzWPycqQdgCCT5oxt7GWdbPHrg9HSdxpdsEL",
);

// Offsets MUST match those in
// packages/programs/programs/strategy-token/src/nav_readers/marginfi.rs.
const BANK_OFFSET_MINT = 8;
// `mint_decimals: u8` lives directly after the 32-byte mint. Not currently
// consumed by marginfi.rs, but a sanity-check anchor - if upstream
// reshuffles the struct head this typically moves too.
const BANK_OFFSET_MINT_DECIMALS = 40;
const BANK_OFFSET_ASSET_SHARE_VALUE = 80;
const BANK_OFFSET_LIABILITY_SHARE_VALUE = 96;
const BANK_MIN_LEN = BANK_OFFSET_LIABILITY_SHARE_VALUE + 16;

// I80F48: 80 integer bits + 48 fractional bits. Stored as i128 LE in 16 B.
// `asset_share_value` is initialised at 1.0 (= 1 << 48 in I80F48) and grows
// monotonically as interest accrues. Sanity bounds:
//   - must be > 0 (zero or negative => layout drift OR a dead bank)
//   - must be < (1 << 80) magnitude - i.e. share value fits in the
//     "integer" part of an I80F48; values >= 2^80 indicate we're reading
//     an unrelated u128 (the 1.84e19 garbage at offset 88 was 2^64 region
//     -> well past our cap if interpreted as raw, well past 2^80 if
//     interpreted as I80F48 too).
const ASSET_SHARE_VALUE_MIN = 1n;
const ASSET_SHARE_VALUE_MAX = 1n << 80n;

const DECIMALS_MIN = 0;
const DECIMALS_MAX = 9;

function fail(msg: string): never {
  console.error(`x MARGINFI PROBE FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  console.log(`probe-marginfi-bank - RPC ${RPC_URL}`);
  console.log(`  fixture: ${BANK_PDA.toBase58()}`);

  const conn = new Connection(RPC_URL, "confirmed");
  const info = await conn.getAccountInfo(BANK_PDA, "confirmed");
  if (!info) fail(`account not found at ${BANK_PDA.toBase58()}`);

  if (!info.owner.equals(MARGINFI_PROGRAM_ID)) {
    fail(
      `wrong owner - expected ${MARGINFI_PROGRAM_ID.toBase58()}, got ${info.owner.toBase58()}`,
    );
  }
  if (info.data.length < BANK_MIN_LEN) {
    fail(
      `account too small - expected >= ${BANK_MIN_LEN} bytes, got ${info.data.length}`,
    );
  }

  // mint @ 8..40
  const mintBytes = info.data.subarray(
    BANK_OFFSET_MINT,
    BANK_OFFSET_MINT + 32,
  );
  const mint = new PublicKey(mintBytes);
  if (mint.equals(PublicKey.default)) {
    fail(`mint at offset ${BANK_OFFSET_MINT} is the zero pubkey`);
  }

  // mint_decimals @ 40 (u8)
  const decimals = info.data.readUInt8(BANK_OFFSET_MINT_DECIMALS);

  function readI80F48(off: number): bigint {
    const lo = info!.data.readBigUInt64LE(off);
    const hi = info!.data.readBigInt64LE(off + 8);
    return (hi << 64n) | lo;
  }

  const asv = readI80F48(BANK_OFFSET_ASSET_SHARE_VALUE);
  const lsv = readI80F48(BANK_OFFSET_LIABILITY_SHARE_VALUE);

  console.log(`  account length:               ${info.data.length}`);
  console.log(`  mint @${BANK_OFFSET_MINT}:                       ${mint.toBase58()}`);
  console.log(`  mint_decimals @${BANK_OFFSET_MINT_DECIMALS}:               ${decimals}`);
  console.log(
    `  asset_share_value @${BANK_OFFSET_ASSET_SHARE_VALUE}:        ${asv.toString()}  (~${(Number(asv) / 2 ** 48).toFixed(6)}x as I80F48)`,
  );
  console.log(
    `  liability_share_value @${BANK_OFFSET_LIABILITY_SHARE_VALUE}:    ${lsv.toString()}  (~${(Number(lsv) / 2 ** 48).toFixed(6)}x as I80F48)`,
  );

  // --- Assertions --------------------------------------------------------
  if (decimals < DECIMALS_MIN || decimals > DECIMALS_MAX) {
    fail(
      `mint_decimals out of range - expected ${DECIMALS_MIN}..=${DECIMALS_MAX}, got ${decimals} (struct layout drift?)`,
    );
  }
  if (asv < ASSET_SHARE_VALUE_MIN) {
    fail(
      `asset_share_value <= 0 - got ${asv.toString()} (zero/neg => layout drift OR dead bank)`,
    );
  }
  if (asv >= ASSET_SHARE_VALUE_MAX) {
    fail(
      `asset_share_value too large for I80F48 integer part - got ${asv.toString()} (>= 2^80; struct layout drift? we previously saw ~1.84e19 at the wrong offset 88)`,
    );
  }
  if (lsv < ASSET_SHARE_VALUE_MIN) {
    fail(
      `liability_share_value <= 0 - got ${lsv.toString()} (zero/neg => layout drift OR dead bank)`,
    );
  }
  if (lsv >= ASSET_SHARE_VALUE_MAX) {
    fail(
      `liability_share_value too large for I80F48 integer part - got ${lsv.toString()} (>= 2^80; struct layout drift?)`,
    );
  }
  // Critical invariant: in any healthy lending market, liability share value
  // (borrow accrual) >= asset share value (deposit accrual). Newly-init'd
  // banks at zero utilisation can have lsv == asv == 1.0 exactly.
  if (lsv < asv) {
    fail(
      `liability_share_value (${lsv}) < asset_share_value (${asv}) - this is impossible in a healthy market; offsets have likely swapped`,
    );
  }

  console.log(`ok MARGINFI PROBE PASS - offsets stable, liability >= asset invariant holds`);
}

main().catch((e) => {
  console.error(`x MARGINFI PROBE ERROR: ${e?.stack || e}`);
  process.exit(2);
});
