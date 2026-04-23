#!/usr/bin/env -S node --enable-source-maps
/**
 * probe-kamino-reserve.ts - NAV-reader offset regression probe for Kamino.
 *
 * Why: `packages/programs/programs/strategy-token/src/nav_readers/kamino.rs`
 * reads a klend `Reserve` account by hard-coded byte offsets:
 *   - liquidity.available_amount       u64  @ 224
 *   - liquidity.borrowed_amount_sf     u128 @ 232  (>>60 to detoken)
 *   - collateral.mint_total_supply     u64  @ 1376
 * (mirrored from packages/beethoven/crates/deposit/kamino). klend has been
 * stable through v1.x but we want a regression net for the same reason
 * we have one for Drift / marginfi - a future Reserve struct migration
 * would silently corrupt cToken -> underlying valuation.
 *
 * This probe fetches a known live Reserve PDA and asserts:
 *   - account is owned by the klend program
 *   - liquidity.mint at offset 128 is non-zero (anchor sanity check)
 *   - the three offsets we read decode without OOB and produce values
 *     that are at least internally consistent (available + borrowed are
 *     non-negative; collateral_supply is non-negative). Devnet reserves
 *     are often near-empty (cToken supply == 0 right after init), so we
 *     do NOT assert ratios - layout-drift detection comes from the
 *     account-length + owner + non-zero-mint checks plus the discipline
 *     of having explicit byte offsets in one verifiable place.
 *
 * Reference fixture: Kamino devnet Reserve `9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy`
 * (the same one driven by kamino-test-deposit.mjs). Note Kamino's devnet
 * program ID (`KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`) differs from
 * mainnet (`KLend2g3cP87ber8p32LuJLuLPzCvXN4KcKr2S8MQek`) - we accept
 * either so the probe works against both clusters.
 *
 * Read-only. Usage:
 *   pnpm --filter @bundie/programs probe:kamino
 *   RPC_URL=https://... pnpm --filter @bundie/programs probe:kamino
 */
import { Connection, PublicKey } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

// --- Fixture --------------------------------------------------------------
// Devnet & mainnet program IDs differ for Kamino. Accept whichever the
// fixture actually lives under so this probe works in both environments
// (we point at devnet by default).
const KAMINO_DEVNET_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
);
const KAMINO_MAINNET_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87ber8p32LuJLuLPzCvXN4KcKr2S8MQek",
);
const RESERVE_PDA = new PublicKey(
  "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy",
);

// Offsets MUST match those in
// packages/programs/programs/strategy-token/src/nav_readers/kamino.rs
// (and the mirrored set in packages/beethoven/crates/deposit/kamino).
const RESERVE_OFFSET_LIQUIDITY_MINT = 128;
const RESERVE_OFFSET_LIQUIDITY_AVAILABLE = 224;
const RESERVE_OFFSET_LIQUIDITY_BORROWED_SF = 232;
const RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY = 1376;
const RESERVE_MIN_LEN = RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY + 8;
const SF_SCALE_BITS = 60n;

function fail(msg: string): never {
  console.error(`x KAMINO PROBE FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  console.log(`probe-kamino-reserve - RPC ${RPC_URL}`);
  console.log(`  fixture: ${RESERVE_PDA.toBase58()}`);

  const conn = new Connection(RPC_URL, "confirmed");
  const info = await conn.getAccountInfo(RESERVE_PDA, "confirmed");
  if (!info) fail(`account not found at ${RESERVE_PDA.toBase58()}`);

  const ownerOk =
    info.owner.equals(KAMINO_DEVNET_PROGRAM_ID) ||
    info.owner.equals(KAMINO_MAINNET_PROGRAM_ID);
  if (!ownerOk) {
    fail(
      `wrong owner - expected one of {${KAMINO_DEVNET_PROGRAM_ID.toBase58()}, ${KAMINO_MAINNET_PROGRAM_ID.toBase58()}}, got ${info.owner.toBase58()}`,
    );
  }
  if (info.data.length < RESERVE_MIN_LEN) {
    fail(
      `account too small - expected >= ${RESERVE_MIN_LEN} bytes, got ${info.data.length}`,
    );
  }

  // liquidity.mint @ 128..160
  const mintBytes = info.data.subarray(
    RESERVE_OFFSET_LIQUIDITY_MINT,
    RESERVE_OFFSET_LIQUIDITY_MINT + 32,
  );
  const liquidityMint = new PublicKey(mintBytes);
  if (liquidityMint.equals(PublicKey.default)) {
    fail(
      `liquidity.mint at offset ${RESERVE_OFFSET_LIQUIDITY_MINT} is the zero pubkey`,
    );
  }

  // available_amount @ 224..232
  const available = info.data.readBigUInt64LE(
    RESERVE_OFFSET_LIQUIDITY_AVAILABLE,
  );

  // borrowed_amount_sf @ 232..248 (u128 LE, scaled by 2^60)
  const bLo = info.data.readBigUInt64LE(RESERVE_OFFSET_LIQUIDITY_BORROWED_SF);
  const bHi = info.data.readBigUInt64LE(
    RESERVE_OFFSET_LIQUIDITY_BORROWED_SF + 8,
  );
  const borrowedSf = (bHi << 64n) | bLo;
  const borrowed = borrowedSf >> SF_SCALE_BITS;

  // collateral.mint_total_supply @ 1376..1384
  const cTokenSupply = info.data.readBigUInt64LE(
    RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY,
  );

  console.log(`  account length:                       ${info.data.length}`);
  console.log(`  owner:                                ${info.owner.toBase58()}`);
  console.log(
    `  liquidity.mint @${RESERVE_OFFSET_LIQUIDITY_MINT}:                 ${liquidityMint.toBase58()}`,
  );
  console.log(
    `  liquidity.available_amount @${RESERVE_OFFSET_LIQUIDITY_AVAILABLE}:        ${available.toString()}`,
  );
  console.log(
    `  liquidity.borrowed_amount_sf @${RESERVE_OFFSET_LIQUIDITY_BORROWED_SF}:     ${borrowedSf.toString()}  (>>60 = ${borrowed.toString()})`,
  );
  console.log(
    `  collateral.mint_total_supply @${RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY}:  ${cTokenSupply.toString()}`,
  );

  // --- Assertions --------------------------------------------------------
  // u64 / u128 readers can never go negative, so the implicit BigInt parse
  // is the assertion - if any of these throw / return undefined the script
  // already crashed. We additionally guard against the impossible case
  // where the >>60 detokenisation of borrowed_sf overflows u64 (would
  // only happen if we read an arbitrary 128-bit junk value at this offset).
  const U64_MAX = (1n << 64n) - 1n;
  if (borrowed > U64_MAX) {
    fail(
      `borrowed (>>60 of borrowed_sf) overflows u64 - got ${borrowed.toString()} (struct layout drift? offset ${RESERVE_OFFSET_LIQUIDITY_BORROWED_SF} is reading garbage)`,
    );
  }

  // available + borrowed should be representable - again, sanity / overflow.
  if (available + borrowed > U64_MAX) {
    fail(
      `available + borrowed overflows u64 - struct layout drift?`,
    );
  }

  console.log(`ok KAMINO PROBE PASS - offsets stable`);
}

main().catch((e) => {
  console.error(`x KAMINO PROBE ERROR: ${e?.stack || e}`);
  process.exit(2);
});
