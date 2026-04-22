/**
 * get-snapshot — read the PositionSnapshots PDA for a strategy.
 *
 * Prints the most recent snapshot: when it was taken, portfolio value,
 * NAV per share, total shares, protocol, and reserve at snapshot time.
 *
 * Predictor agents use this to form informed views on strategy composition
 * without the real-time advantage creators would otherwise retain.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { positionSnapshotsPDA } from '../pda.js';

/** Must match strategy-token/src/state/position_snapshots.rs */
const DISCRIMINATOR = Buffer.from([
  0x7d, 0xa9, 0x1f, 0x4c, 0x62, 0x30, 0x8b, 0xe1,
]);

// Field offsets, mirrors state/position_snapshots.rs
const OFF = {
  strategy:         8,
  snapshotAt:      40,
  snapshotSlot:    48,
  protocol:        56,
  reserve:         88,
  portfolioValue: 120,
  totalShares:    128,
  navPerShare:    136,
  highWaterMark:  144,
  snapshotCount:  152,
  bump:           160,
} as const;

export interface SnapshotData {
  address: PublicKey;
  strategy: PublicKey;
  snapshotAt: Date;
  snapshotSlot: bigint;
  protocol: PublicKey;
  reserve: PublicKey;
  portfolioValue: bigint;
  totalShares: bigint;
  navPerShare: bigint;
  highWaterMark: bigint;
  snapshotCount: bigint;
}

export async function fetchSnapshot(
  conn: Connection,
  strategy: PublicKey,
): Promise<SnapshotData | null> {
  const [snapshots] = positionSnapshotsPDA(strategy);
  const info = await conn.getAccountInfo(snapshots);
  if (!info) return null;

  const d = Buffer.from(info.data);
  if (d.length < OFF.bump + 1 || !d.subarray(0, 8).equals(DISCRIMINATOR)) {
    throw new Error(`Account at ${snapshots.toBase58()} is not a PositionSnapshots`);
  }

  return {
    address: snapshots,
    strategy: new PublicKey(d.subarray(OFF.strategy, OFF.strategy + 32)),
    snapshotAt: new Date(Number(d.readBigInt64LE(OFF.snapshotAt)) * 1000),
    snapshotSlot: d.readBigUInt64LE(OFF.snapshotSlot),
    protocol: new PublicKey(d.subarray(OFF.protocol, OFF.protocol + 32)),
    reserve: new PublicKey(d.subarray(OFF.reserve, OFF.reserve + 32)),
    portfolioValue: d.readBigUInt64LE(OFF.portfolioValue),
    totalShares: d.readBigUInt64LE(OFF.totalShares),
    navPerShare: d.readBigUInt64LE(OFF.navPerShare),
    highWaterMark: d.readBigUInt64LE(OFF.highWaterMark),
    snapshotCount: d.readBigUInt64LE(OFF.snapshotCount),
  };
}

export async function printSnapshot(conn: Connection, strategy: PublicKey): Promise<void> {
  const snap = await fetchSnapshot(conn, strategy);
  if (!snap) {
    console.log(`\n  No snapshot found for strategy ${strategy.toBase58()}.`);
    console.log(`  Run: bundie-sol snapshot-positions --strategy ${strategy.toBase58()}`);
    return;
  }
  const portfolioUsdc = (Number(snap.portfolioValue) / 1_000_000).toFixed(6);
  const navPerShare = (Number(snap.navPerShare) / 1_000_000_000).toFixed(9);
  const shares = (Number(snap.totalShares) / 1_000_000).toFixed(6);

  console.log(`\n  Strategy:         ${snap.strategy.toBase58()}`);
  console.log(`  Snapshot PDA:     ${snap.address.toBase58()}`);
  console.log(`  Taken at:         ${snap.snapshotAt.toISOString()} (slot ${snap.snapshotSlot})`);
  console.log(`  Snapshot #:       ${snap.snapshotCount}`);
  console.log(`  Portfolio value:  ${portfolioUsdc} USDC`);
  console.log(`  Total shares:     ${shares}`);
  console.log(`  NAV per share:    ${navPerShare} USDC`);
  console.log(`  Protocol:         ${snap.protocol.toBase58()}`);
  console.log(`  Reserve:          ${snap.reserve.toBase58()}`);
}
