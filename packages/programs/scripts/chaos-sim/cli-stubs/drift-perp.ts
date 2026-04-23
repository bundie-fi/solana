/**
 * rebalance/drift-perp.ts — REFERENCE STUB (DO NOT IMPORT FROM HERE).
 *
 * Authoritative copy will live at:
 *   /mnt/storage/bundie-fi/cli/solana/src/commands/rebalance/drift-perp.ts
 * (the sibling `@bundie/sol-cli` repo). This file exists in the
 * strategy-token worktree purely so the CLI maintainer has a byte-exact
 * resolver to copy that matches Beethoven's `perp/drift` adapter
 * (`packages/beethoven/crates/perps/drift/src/lib.rs`) slot-for-slot.
 *
 * Account list returned (matches `DriftPlacePerpOrderAccounts`):
 *   [0]  drift_program       (program id, detector — readonly)
 *   [1]  state               (read; PDA = ["drift_state"])
 *   [2]  user                (writable; PDA = ["user", auth, sub_le_u16])
 *   [3]  authority = wallet  (signer in the on-chain Drift PlaceOrder
 *                             struct, but here it's the strategy wallet
 *                             PDA — strategy-token signs the CPI on its
 *                             behalf via the wallet PDA seeds)
 *   [4]  perp_market         (writable; PDA = ["perp_market", market_le_u16])
 *   [5]  oracle              (read; pulled from PerpMarket.amm.oracle)
 *
 * Wire-format dispatch byte 8:
 *   [0x08 | market_index:u16 LE | base_amount:u64 LE | direction:u8]
 *
 * NAV-impact note: today's strategy-token NAV reader walks
 * `User.spot_positions[]` (offset 104..424) only. Open perp positions
 * live at offset 424+ and are NOT included in NAV — see
 * `packages/programs/programs/strategy-token/src/nav_readers/drift.rs`.
 * The chaos sim will detect this as an anomaly when an open perp leg
 * causes net account value to diverge from NAV. Deferred by design.
 */

// NOTE: imports are stubbed against @solana/web3.js + @solana/spl-token
// (the same shape the existing `rebalance/drift.ts` uses in the CLI repo).
// This file uses `any` types so it can be type-checked in isolation
// inside the strategy-token worktree without dragging the CLI's deps in.

type AccountMeta = {
  pubkey: any;
  isSigner: boolean;
  isWritable: boolean;
};

// Drift v2 program ID (mainnet + devnet share the same address).
export const DRIFT_PROGRAM_ID_BASE58 =
  'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH';

/** Mainnet SOL-PERP market index. Devnet may differ — verify with the keeper. */
export const MARKET_INDEX_SOL_PERP = 0;

/** Direction enum (matches `DIRECTION_*` in the Beethoven adapter). */
export const DIRECTION_LONG = 0;
export const DIRECTION_SHORT = 1;

/** Strategy-token dispatch byte for `perp_open`. */
export const ST_DISPATCH_PERP_OPEN = 8;

function u16LE(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n, 0);
  return buf;
}

// ─── PDA helpers (port of `rebalance/drift.ts` from the CLI repo) ─────────

/** Drift `User` PDA: ["user", authority, sub_account_id_le_u16]. */
export function driftUserPda(
  PublicKey: any,
  authority: any,
  subAccountId = 0,
): any {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user'), authority.toBuffer(), u16LE(subAccountId)],
    new PublicKey(DRIFT_PROGRAM_ID_BASE58),
  )[0];
}

/** Drift `State` PDA: ["drift_state"]. Singleton. */
export function driftStatePda(PublicKey: any): any {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('drift_state')],
    new PublicKey(DRIFT_PROGRAM_ID_BASE58),
  )[0];
}

/** PerpMarket PDA: ["perp_market", market_index_le_u16]. */
export function perpMarketPda(PublicKey: any, marketIndex: number): any {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('perp_market'), u16LE(marketIndex)],
    new PublicKey(DRIFT_PROGRAM_ID_BASE58),
  )[0];
}

/**
 * Decode the PerpMarket account's `amm.oracle` field.
 *
 * PerpMarket layout (partial — source: drift-labs/protocol-v2
 * programs/drift/src/state/perp_market.rs):
 *   8       pubkey: Pubkey                 (32)
 *   40      amm: AMM (~ much later: amm.oracle is at a known offset)
 *
 * For the stub we only document the wire shape — the CLI repo's resolver
 * will fetch + decode for real. Returning a placeholder here lets the
 * smoke test run without RPC.
 */
export function decodePerpMarketOracleStub(_data: Buffer): {
  oracle: any;
} {
  return { oracle: null };
}

export interface DriftPerpResolverOpts {
  PublicKey: any;
  /** Strategy wallet PDA — Drift authority + position owner. */
  wallet: any;
  /** Perp market index to open against (0 = SOL-PERP on mainnet). */
  marketIndex: number;
  /** Drift sub-account id (default 0). */
  subAccountId?: number;
  /** Resolved oracle pubkey for the market (caller fetches from perp_market). */
  oracle: any;
}

/**
 * Build the 6-account remaining-list that Beethoven's Drift perps adapter
 * expects. The CLI's full resolver will additionally fetch the perp_market
 * account to extract its `amm.oracle` address (decode helper stub above).
 */
export function resolveDriftPerpAccounts(opts: DriftPerpResolverOpts): AccountMeta[] {
  const { PublicKey } = opts;
  const sub = opts.subAccountId ?? 0;
  const driftProgram = new PublicKey(DRIFT_PROGRAM_ID_BASE58);
  const state = driftStatePda(PublicKey);
  const user = driftUserPda(PublicKey, opts.wallet, sub);
  const perpMarket = perpMarketPda(PublicKey, opts.marketIndex);

  return [
    { pubkey: driftProgram,  isSigner: false, isWritable: false }, // [0]
    { pubkey: state,         isSigner: false, isWritable: false }, // [1]
    { pubkey: user,          isSigner: false, isWritable: true  }, // [2]
    { pubkey: opts.wallet,   isSigner: false, isWritable: false }, // [3] authority = wallet PDA
    { pubkey: perpMarket,    isSigner: false, isWritable: true  }, // [4]
    { pubkey: opts.oracle,   isSigner: false, isWritable: false }, // [5]
  ];
}

/**
 * Build the 11-byte instruction payload (after the 0x08 dispatch byte).
 * Total wire bytes = 1 (dispatch) + 11 (payload) = 12.
 */
export function buildDriftPerpOpenIxData(
  marketIndex: number,
  baseAmount: bigint,
  direction: number,
): Buffer {
  const data = Buffer.allocUnsafe(1 /* dispatch */ + 11 /* payload */);
  let off = 0;
  data.writeUInt8(ST_DISPATCH_PERP_OPEN, off); off += 1;
  data.writeUInt16LE(marketIndex, off); off += 2;
  data.writeBigUInt64LE(baseAmount, off); off += 8;
  data.writeUInt8(direction, off); off += 1;
  return data;
}

// ─── Patch instructions for the CLI maintainer ────────────────────────────
//
// In `bundie-fi/cli/solana/src/commands/rebalance/index.ts`:
//
//   1. Add to imports (after the existing `import { resolveDriftDepositAccounts }`):
//        import { resolveDriftPerpAccounts } from './drift-perp.js';
//
//   2. Extend the `RebalanceProtocol` union to include `'drift-perp'`.
//
//   3. Add a new `case 'drift-perp':` in the switch — see the one-line
//      patch in the worktree report.
//
//   4. The dispatch path for `'drift-perp'` does NOT use the
//      [num_steps | action | amount] rebalance encoding — it builds the
//      0x08 ix directly via `buildDriftPerpOpenIxData()`. Wire as a
//      separate `prepareDriftPerpOpen()` exported function rather than
//      shoehorning into `prepareRebalance()`.
