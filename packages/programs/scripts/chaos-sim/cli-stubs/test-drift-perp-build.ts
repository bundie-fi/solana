/**
 * Smoke test for the Beethoven Drift perps adapter wire format.
 *
 * Builds the 11-byte ix payload + the expected 6-account list, then
 * decodes them byte-by-byte and asserts. NO RPC, NO signing, NO devnet
 * transactions.
 *
 * Run:   pnpm --filter @bundie/programs exec tsx scripts/chaos-sim/cli-stubs/test-drift-perp-build.ts
 *
 * Reference impl:  drift-perp.ts (sibling file).
 * Adapter impl:    packages/beethoven/crates/perps/drift/src/lib.rs
 */

import {
  buildDriftPerpOpenIxData,
  resolveDriftPerpAccounts,
  DRIFT_PROGRAM_ID_BASE58,
  MARKET_INDEX_SOL_PERP,
  DIRECTION_LONG,
  ST_DISPATCH_PERP_OPEN,
} from './drift-perp.js';

// ─── Minimal PublicKey shim ───────────────────────────────────────────────
// We don't import @solana/web3.js — the smoke test runs in isolation
// against the strategy-token worktree, which only depends on Cargo crates
// for its own builds. The shim mimics the surface area `drift-perp.ts`
// uses (`new PublicKey(s)`, `pk.toBuffer()`, `findProgramAddressSync`).

class FakePublicKey {
  private readonly bytes: Buffer;
  constructor(input: string | Buffer) {
    if (typeof input === 'string') {
      // Cheap base58-ish stand-in: hash the string into 32 bytes.
      // Safe because we only need stable, distinct buffers — we never
      // verify them against a real chain.
      const h = require('crypto').createHash('sha256').update(input).digest();
      this.bytes = h.subarray(0, 32);
    } else {
      this.bytes = input.length === 32 ? input : Buffer.alloc(32, input);
    }
  }
  toBuffer(): Buffer { return this.bytes; }
  toBase58(): string { return this.bytes.toString('hex'); }
  static findProgramAddressSync(seeds: Buffer[], _programId: any): [FakePublicKey, number] {
    // Stub: hash all seeds together → deterministic 32 bytes.
    const cat = Buffer.concat(seeds);
    const h = require('crypto').createHash('sha256').update(cat).digest();
    return [new FakePublicKey(h), 255];
  }
  equals(other: FakePublicKey): boolean {
    return this.bytes.equals(other.bytes);
  }
}

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('  FAIL:', msg);
    failures += 1;
  } else {
    console.log('  ok  :', msg);
  }
}

console.log('drift-perp smoke test\n');

// ─── 1. Wire-format encoding for a small SOL-PERP long ────────────────────
console.log('1. ix data encoding (SOL-PERP long, 0.1 SOL = 100_000_000 base)');
const baseAmount = 100_000_000n;
const data = buildDriftPerpOpenIxData(MARKET_INDEX_SOL_PERP, baseAmount, DIRECTION_LONG);

assert(data.length === 12, `data length = 12 bytes (got ${data.length})`);
assert(data[0] === ST_DISPATCH_PERP_OPEN, `dispatch byte = 0x08 (got 0x${data[0].toString(16)})`);
assert(
  data.readUInt16LE(1) === MARKET_INDEX_SOL_PERP,
  `market_index = 0 (got ${data.readUInt16LE(1)})`,
);
assert(
  data.readBigUInt64LE(3) === baseAmount,
  `base_asset_amount LE = ${baseAmount} (got ${data.readBigUInt64LE(3)})`,
);
assert(data[11] === DIRECTION_LONG, `direction = Long (0) (got ${data[11]})`);

// Byte-level dump for visual confirmation.
console.log(`  raw bytes: ${data.toString('hex')}`);
//   08              dispatch
//   00 00           market_index = 0
//   00 e1 f5 05 00 00 00 00   base_amount = 100_000_000 LE
//   00              direction = Long

// ─── 2. Account list shape ────────────────────────────────────────────────
console.log('\n2. account list resolver');
const wallet = new FakePublicKey('strategy-wallet-pda');
const oracle = new FakePublicKey('sol-perp-oracle');

const accs = resolveDriftPerpAccounts({
  PublicKey: FakePublicKey,
  wallet,
  marketIndex: MARKET_INDEX_SOL_PERP,
  oracle,
});

assert(accs.length === 6, `account list length = 6 (got ${accs.length})`);

// [0] drift_program — readonly, NOT signer
assert(
  accs[0].pubkey.toBase58() === new FakePublicKey(DRIFT_PROGRAM_ID_BASE58).toBase58(),
  '[0] = drift_program',
);
assert(!accs[0].isSigner && !accs[0].isWritable, '[0] = readonly, not signer');

// [1] state — readonly
assert(!accs[1].isSigner && !accs[1].isWritable, '[1] state = readonly');

// [2] user — writable, NOT signer (PDA)
assert(!accs[2].isSigner && accs[2].isWritable, '[2] user = writable, not signer');

// [3] authority = wallet PDA — readonly here (strategy-token signs via PDA seeds)
assert(
  accs[3].pubkey.equals(wallet),
  '[3] authority = wallet PDA',
);
assert(
  !accs[3].isSigner && !accs[3].isWritable,
  '[3] authority = readonly, not signer (PDA-signed via CPI)',
);

// [4] perp_market — writable
assert(!accs[4].isSigner && accs[4].isWritable, '[4] perp_market = writable, not signer');

// [5] oracle — readonly
assert(
  accs[5].pubkey.equals(oracle),
  '[5] oracle = caller-supplied',
);
assert(!accs[5].isSigner && !accs[5].isWritable, '[5] oracle = readonly, not signer');

// ─── 3. Symmetry check: short order encodes direction=1 ──────────────────
console.log('\n3. short-side encoding');
const shortData = buildDriftPerpOpenIxData(MARKET_INDEX_SOL_PERP, baseAmount, /* Short */ 1);
assert(shortData[11] === 1, `direction = Short (1) (got ${shortData[11]})`);

// ─── 4. Direction parity: only LE byte differs ───────────────────────────
console.log('\n4. long vs short — only the direction byte differs');
let diffCount = 0;
for (let i = 0; i < data.length; i++) {
  if (data[i] !== shortData[i]) diffCount += 1;
}
assert(diffCount === 1, `exactly 1 byte differs between long and short (got ${diffCount})`);

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
