import { Connection, PublicKey } from '@solana/web3.js';
import { BorshReader } from './borsh.js';

// ─── Strategy account (pinocchio raw layout) ────────────────────────────────
// Field offsets from packages/programs/programs/strategy-token/src/state/strategy.rs
const S = {
  authority:           8,
  mint:               40,
  wallet:             72,
  depositMint:       104,
  protocol:          136,
  reserve:           168,
  name:              200,
  strategyType:      232,
  status:            233,
  feeBps:            234,
  totalDeposits:     236,
  currentNav:        244,
  totalShares:       252,
  totalInvestors:    260,
  highWaterMark:     264,
  minDeposit:        272,
  lastNavSlot:       280,
  navTwapAccumulator:288,
  twapLastSlot:      304,
  createdAt:         312,
  bump:              320,
  walletBump:        321,
} as const;

export interface StrategyAccount {
  address: PublicKey;
  authority: PublicKey;
  mint: PublicKey;
  wallet: PublicKey;
  depositMint: PublicKey;
  protocol: PublicKey;
  name: string;
  strategyType: number;
  status: number;
  feeBps: number;
  totalDeposits: bigint;
  currentNav: bigint;
  totalShares: bigint;
  totalInvestors: number;
  highWaterMark: bigint;
  minDeposit: bigint;
  createdAt: bigint;
  bump: number;
  walletBump: number;
}

export async function fetchStrategy(
  conn: Connection,
  address: PublicKey,
): Promise<StrategyAccount> {
  const info = await conn.getAccountInfo(address);
  if (!info) throw new Error(`Strategy account not found: ${address.toBase58()}`);
  const d = Buffer.from(info.data);

  const rawName = d.subarray(S.name, S.name + 32);
  const nullIdx = rawName.indexOf(0);
  const name = rawName.subarray(0, nullIdx === -1 ? 32 : nullIdx).toString('utf8');

  return {
    address,
    authority:    new PublicKey(d.subarray(S.authority,    S.authority    + 32)),
    mint:         new PublicKey(d.subarray(S.mint,         S.mint         + 32)),
    wallet:       new PublicKey(d.subarray(S.wallet,       S.wallet       + 32)),
    depositMint:  new PublicKey(d.subarray(S.depositMint,  S.depositMint  + 32)),
    protocol:     new PublicKey(d.subarray(S.protocol,     S.protocol     + 32)),
    name,
    strategyType: d.readUInt8(S.strategyType),
    status:       d.readUInt8(S.status),
    feeBps:       d.readUInt16LE(S.feeBps),
    totalDeposits:d.readBigUInt64LE(S.totalDeposits),
    currentNav:   d.readBigUInt64LE(S.currentNav),
    totalShares:  d.readBigUInt64LE(S.totalShares),
    totalInvestors: d.readUInt32LE(S.totalInvestors),
    highWaterMark:d.readBigUInt64LE(S.highWaterMark),
    minDeposit:   d.readBigUInt64LE(S.minDeposit),
    createdAt:    d.readBigInt64LE(S.createdAt),
    bump:         d.readUInt8(S.bump),
    walletBump:   d.readUInt8(S.walletBump),
  };
}

// ─── Market account (Anchor Borsh layout) ───────────────────────────────────

export interface MarketAccount {
  strategy: PublicKey;
  strategyB: PublicKey | null;
  authority: PublicKey;
  subsidyProvider: PublicKey;
  question: string;
  marketType: number;
  marketId: bigint;
  thresholdBps: bigint;
  resolutionSlot: bigint;
  yesShares: bigint;
  noShares: bigint;
  totalYesCost: bigint;
  totalNoCost: bigint;
  liquidityParam: bigint;
  totalVolume: bigint;
  feeBps: number;
  vault: PublicKey;
  collateralMint: PublicKey;
  outcome: number | null;
  status: number;
  createdAt: bigint;
  resolvedAt: bigint | null;
  bump: number;
  initialNavPerShare: bigint;
  yesMintBump: number;
  noMintBump: number;
  vaultBump: number;
}

export async function fetchMarket(
  conn: Connection,
  address: PublicKey,
): Promise<MarketAccount> {
  const info = await conn.getAccountInfo(address);
  if (!info) throw new Error(`Market account not found: ${address.toBase58()}`);

  const r = new BorshReader(Buffer.from(info.data), 8); // skip 8-byte discriminator

  return {
    strategy:           r.pubkey(),
    strategyB:          r.option(() => r.pubkey()),
    authority:          r.pubkey(),
    subsidyProvider:    r.pubkey(),
    question:           r.string(),
    marketType:         r.u8(),
    marketId:           r.u64(),
    thresholdBps:       r.u64(),
    resolutionSlot:     r.u64(),
    yesShares:          r.u64(),
    noShares:           r.u64(),
    totalYesCost:       r.u64(),
    totalNoCost:        r.u64(),
    liquidityParam:     r.u64(),
    totalVolume:        r.u64(),
    feeBps:             r.u16(),
    vault:              r.pubkey(),
    collateralMint:     r.pubkey(),
    outcome:            r.option(() => r.u8()),
    status:             r.u8(),
    createdAt:          r.i64(),
    resolvedAt:         r.option(() => r.i64()),
    bump:               r.u8(),
    initialNavPerShare: r.u64(),
    yesMintBump:        r.u8(),
    noMintBump:         r.u8(),
    vaultBump:          r.u8(),
  };
}
