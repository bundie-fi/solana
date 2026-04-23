#!/usr/bin/env -S node --enable-source-maps
/**
 * probe-marinade-state.ts - NAV-reader offset regression probe for Marinade.
 *
 * Why: `packages/beethoven/crates/deposit/marinade/src/lib.rs::read_msol_value`
 * (re-exported through `nav_readers/marinade.rs`) reads `State.msol_price`
 * at hard-coded byte offset 512. The field is a Q32.32 fixed-point u64
 * representing lamports of SOL per mSOL, scaled by 2^32. If Marinade
 * upstream re-lays out the State struct, the offset shifts and our NAV
 * reader silently corrupts mSOL valuation.
 *
 * This probe fetches the live Marinade State PDA and asserts:
 *   - account is owned by the Marinade program
 *   - the u64 at offset 512..520 decodes to a Q32.32 in the [1.0, 2.0]
 *     range (mSOL has always traded slightly above 1 SOL since launch;
 *     2.0 is a hard ceiling that nothing approaching pegged-staked-SOL
 *     should ever cross - if we read it, it is layout drift).
 *
 * Reference fixture: Marinade State `8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC`
 * on devnet - the same one referenced by the marinade beethoven crate
 * header and our existing marinade-probe-devnet.mjs script.
 *
 * Read-only. Usage:
 *   pnpm --filter @bundie/programs probe:marinade
 *   RPC_URL=https://... pnpm --filter @bundie/programs probe:marinade
 */
import { Connection, PublicKey } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

// --- Fixture --------------------------------------------------------------
const MARINADE_PROGRAM_ID = new PublicKey(
  "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
);
const STATE_PDA = new PublicKey(
  "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC",
);

// MUST match the offset in
// packages/beethoven/crates/deposit/marinade/src/lib.rs.
const STATE_OFFSET_MSOL_PRICE = 512;
const STATE_MIN_LEN = STATE_OFFSET_MSOL_PRICE + 8;

const MSOL_PRICE_SCALE_BITS = 32n;
// 1.0 SOL/mSOL is the floor (Marinade seeds at 1.0). 2.0 is a hard ceiling
// that the staked-SOL appreciation curve has never approached - mSOL has
// historically been ~1.0-1.3 SOL. Any value outside this window is almost
// certainly the wrong field.
const MSOL_PRICE_MIN_Q32 = 1n << MSOL_PRICE_SCALE_BITS;        // 1.0x
const MSOL_PRICE_MAX_Q32 = 2n << MSOL_PRICE_SCALE_BITS;        // 2.0x

function fail(msg: string): never {
  console.error(`x MARINADE PROBE FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  console.log(`probe-marinade-state - RPC ${RPC_URL}`);
  console.log(`  fixture: ${STATE_PDA.toBase58()}`);

  const conn = new Connection(RPC_URL, "confirmed");
  const info = await conn.getAccountInfo(STATE_PDA, "confirmed");
  if (!info) fail(`account not found at ${STATE_PDA.toBase58()}`);

  if (!info.owner.equals(MARINADE_PROGRAM_ID)) {
    fail(
      `wrong owner - expected ${MARINADE_PROGRAM_ID.toBase58()}, got ${info.owner.toBase58()}`,
    );
  }
  if (info.data.length < STATE_MIN_LEN) {
    fail(
      `account too small - expected >= ${STATE_MIN_LEN} bytes, got ${info.data.length}`,
    );
  }

  const msolPriceRaw = info.data.readBigUInt64LE(STATE_OFFSET_MSOL_PRICE);
  const ratio = Number(msolPriceRaw) / Number(1n << MSOL_PRICE_SCALE_BITS);

  console.log(`  account length:        ${info.data.length}`);
  console.log(
    `  msol_price @${STATE_OFFSET_MSOL_PRICE}:    ${msolPriceRaw.toString()}  (Q32.32 -> ${ratio.toFixed(6)} SOL/mSOL)`,
  );

  // --- Assertions --------------------------------------------------------
  if (msolPriceRaw < MSOL_PRICE_MIN_Q32) {
    fail(
      `msol_price below 1.0 SOL/mSOL - got ${ratio.toFixed(6)} (expected >= 1.0; Marinade seeds at exactly 1.0 and only goes up)`,
    );
  }
  if (msolPriceRaw > MSOL_PRICE_MAX_Q32) {
    fail(
      `msol_price above 2.0 SOL/mSOL - got ${ratio.toFixed(6)} (expected < 2.0; struct layout drift?)`,
    );
  }

  console.log(`ok MARINADE PROBE PASS - offsets stable`);
}

main().catch((e) => {
  console.error(`x MARINADE PROBE ERROR: ${e?.stack || e}`);
  process.exit(2);
});
