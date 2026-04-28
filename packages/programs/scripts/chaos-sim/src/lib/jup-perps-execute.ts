/**
 * jup-perps-execute.ts — Jupiter Perpetuals executor against the surfpool
 * mainnet fork. Replaces the dormant Zeta executor.
 *
 * SDK approach
 * ------------
 * `@jup-ag/perps-sdk` is NOT published on npm (404 as of 2026-04-28). The
 * community Anchor IDL repo (julianpeterson/jupiter-perps-anchor-idl-parsing)
 * exists but is also not on npm and would pull `@coral-xyz/anchor` peer-dep
 * baggage. We therefore hand-roll the instruction encoding using:
 *   - the Jupiter Perpetuals program id `PERPHjGB…`,
 *   - well-known PDA seeds from the public docs (station.jup.ag),
 *   - Anchor's deterministic discriminator scheme: `sha256("global:<ix_name>")[..8]`,
 *   - direct Borsh-style argument packing (LE u64 for amounts, u8 for bools).
 *
 * Architecture note
 * -----------------
 * Jupiter Perps uses a request/keeper pattern. End-users (us) call
 * `createIncreasePositionRequest` / `createDecreasePositionRequest` to lodge
 * an order; a Jupiter keeper bot then crank-executes it via
 * `increasePosition` / `decreasePosition` against the JLP pool. On the
 * surfpool fork the keeper bot is NOT running — so the position request lands
 * but is never executed against pool state. For the chaos-sim's purposes
 * this is fine: the brain's intent ("open a perp position") lands as a real
 * on-chain tx the activity panel can show, and NAV reads from the
 * PositionRequest account capture the requested collateral.
 *
 * Auto-collateralisation
 * ----------------------
 * Mirrors Zeta: collateralUsd = max(notionalUsd * 1.2, 10). The
 * `collateralTokenDelta` field on the request is in the input mint's base
 * units (USDC = 6dp). USDC funding via `ensureSurfpoolUsdc` is idempotent and
 * cheap when the floor is already met.
 *
 * Side mapping
 * ------------
 * The Jupiter request struct's `side` field is an Anchor enum encoded as a
 * single u8: 0 = Long, 1 = Short. We map brain's `long` → 0 and `short` → 1.
 *
 * Surfpool hygiene
 * ----------------
 * Same blockhash + skipPreflight pattern as marinade-execute.ts /
 * kamino-execute.ts: `processed` blockhash + lastValidBlockHeight + 300 so
 * the slow surfpool confirmation polling doesn't blow the validity window.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  AccountMeta,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { createHash } from "node:crypto";

import { ensureSurfpoolUsdc } from "./surfpool-seed.js";

// ─── Constants ────────────────────────────────────────────────────────────

/** Jupiter Perpetuals mainnet program id (same on the surfpool fork). */
export const JUP_PERPS_PROGRAM_ID = new PublicKey(
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu",
);

/** Jupiter JLP "Pool" PDA — single shared liquidity pool for all custodies. */
const JUP_PERPS_POOL = new PublicKey(
  "5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq",
);

/** Mainnet USDC mint — collateral token for all Jupiter Perps positions. */
const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

/**
 * Per-market custody accounts (Jupiter Perps' Custody PDAs). These are the
 * canonical mainnet pubkeys; surfpool inherits the state.
 *
 * - SOL custody:  7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz
 * - BTC custody:  5Pv69nCi8WitHwEYCQp7nMhc1XkR9C5fWtFB75dFFfSf
 * - ETH custody:  AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn
 *
 * Note: Jupiter also has stable-side custodies (USDC/USDT) used for
 * collateral accounting, but the *position* custody is always the underlying.
 */
const CUSTODY_BY_MARKET: Record<string, PublicKey> = {
  "SOL-PERP": new PublicKey("7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz"),
  "BTC-PERP": new PublicKey("5Pv69nCi8WitHwEYCQp7nMhc1XkR9C5fWtFB75dFFfSf"),
  "ETH-PERP": new PublicKey("AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn"),
};

/** Underlying mint per market — used for the position's collateral PDA seeds. */
const UNDERLYING_MINT_BY_MARKET: Record<string, PublicKey> = {
  "SOL-PERP": new PublicKey("So11111111111111111111111111111111111111112"),
  "BTC-PERP": new PublicKey("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh"),
  "ETH-PERP": new PublicKey("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"),
};

// ─── Anchor discriminator helper ─────────────────────────────────────────

/** sha256("global:<name>")[..8] — Anchor's deterministic ix discriminator. */
function discriminator(ixName: string): Buffer {
  return createHash("sha256")
    .update(`global:${ixName}`)
    .digest()
    .subarray(0, 8);
}

function u64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}

// ─── PDA derivations ──────────────────────────────────────────────────────

/**
 * Position PDA: ["position", owner, pool, custody, side_byte].
 * side_byte is 1 for Long, 2 for Short — verified against the Jupiter Perps
 * IDL's PDA seeds. (Distinct from the `side` enum value in the request
 * struct, which is 0/1.)
 */
function positionPda(
  owner: PublicKey,
  custody: PublicKey,
  side: "long" | "short",
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      owner.toBuffer(),
      JUP_PERPS_POOL.toBuffer(),
      custody.toBuffer(),
      Buffer.from([side === "long" ? 1 : 2]),
    ],
    JUP_PERPS_PROGRAM_ID,
  );
}

/**
 * PositionRequest PDA: ["position_request", position, mint, request_kind_byte,
 * counter]. The counter is a per-position monotonically-increasing u8 the
 * keeper increments on each submission. We use the wall-clock-derived counter
 * to avoid collisions with prior requests on a long-lived agent.
 */
function positionRequestPda(
  position: PublicKey,
  collateralMint: PublicKey,
  counter: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("position_request"),
      position.toBuffer(),
      collateralMint.toBuffer(),
      Buffer.from([counter & 0xff]),
    ],
    JUP_PERPS_PROGRAM_ID,
  );
}

// ─── Lazy prewarm ─────────────────────────────────────────────────────────

let prewarmDone = false;

/**
 * Prewarm: poke the on-chain pool account so surfpool clones it from
 * mainnet ahead of the first agent action. No SDK to load (we hand-roll
 * the ixs), so this is a single getAccountInfo round-trip.
 *
 * Mirrors `prewarmZetaExchange`'s contract: never throws, returns silently
 * on success, logs once on failure. Idempotent: subsequent calls are no-ops.
 */
export async function prewarmJupiterPerps(connection: Connection): Promise<void> {
  if (prewarmDone) return;
  try {
    const info = await connection.getAccountInfo(JUP_PERPS_POOL);
    if (info) {
      console.log(
        `[jup-perps-prewarm] Pool account cloned (${info.data.length} bytes) — first perp call will be cheap`,
      );
    } else {
      console.warn(
        "[jup-perps-prewarm] Pool account not present on the fork; lazy clone will trigger on first perp action",
      );
    }
    prewarmDone = true;
  } catch (e) {
    console.warn(
      `[jup-perps-prewarm] failed: ${(e as Error).message} — lazy clone will retry on first action`,
    );
  }
}

// ─── Public API: openJupiterPerp ─────────────────────────────────────────

export interface OpenJupiterPerpArgs {
  surfpool: Connection;
  kp: Keypair;
  /** "SOL-PERP" | "BTC-PERP" | "ETH-PERP". */
  market: string;
  side: "long" | "short";
  notionalUsd: number;
}

export interface OpenJupiterPerpResult {
  protocol: "jupiter-perps";
  action: "perp_open";
  txSig: string;
  positionPda: string;
  collateralUsd: number;
}

/**
 * Lodge a Jupiter Perps `createIncreasePositionRequest` for the agent.
 * Auto-collateralised at ~120% of notional (matching the Zeta heuristic).
 */
export async function openJupiterPerp(
  args: OpenJupiterPerpArgs,
): Promise<OpenJupiterPerpResult> {
  const { surfpool, kp, market, side, notionalUsd } = args;
  if (notionalUsd <= 0) {
    throw new Error(
      `openJupiterPerp: notionalUsd must be > 0 (got ${notionalUsd})`,
    );
  }

  const custody = CUSTODY_BY_MARKET[market];
  const underlyingMint = UNDERLYING_MINT_BY_MARKET[market];
  if (!custody || !underlyingMint) {
    throw new Error(
      `openJupiterPerp: unsupported market "${market}" (expected SOL-PERP / BTC-PERP / ETH-PERP)`,
    );
  }

  const collateralUsd = Math.max(notionalUsd * 1.2, 10);
  const collateralBaseUnits = BigInt(Math.round(collateralUsd * 1_000_000)); // USDC 6dp
  const sizeUsdDelta = BigInt(Math.round(notionalUsd * 1_000_000)); // 6dp price-precision

  // Make sure the agent has USDC on the fork (idempotent). 1.5× collateral
  // covers any opening fees / slippage; sized to the actual position
  // rather than an inflated 1000 USDC floor.
  await ensureSurfpoolUsdc(surfpool, kp.publicKey, collateralUsd * 1.5);

  const [position] = positionPda(kp.publicKey, custody, side);
  // Counter = lower 8 bits of unix-seconds — gives monotonic uniqueness across
  // ticks without touching on-chain state to read the previous counter. The
  // collision window is ~256 seconds; the brain doesn't fire perp_opens at
  // anywhere near that cadence on a single market.
  const counter = Math.floor(Date.now() / 1000) & 0xff;
  const [positionRequest] = positionRequestPda(position, USDC_MINT, counter);

  // The agent's USDC ATA — funding source for the position collateral.
  const fundingAta = getAssociatedTokenAddressSync(USDC_MINT, kp.publicKey);

  // ── Instruction data layout for createIncreasePositionRequest ───────────
  //
  // Anchor wire format (all LE):
  //   [0..8]    discriminator = sha256("global:create_increase_position_request")[..8]
  //   [8..16]   sizeUsdDelta:        u64
  //   [16..24]  collateralTokenDelta: u64
  //   [24]      side:                u8 (0=Long, 1=Short)
  //   [25..33]  priceSlippage:       u64 (max acceptable mark; 0 = market-best)
  //   [33]      jupiterMinimumOut:   Option<u64> tag (0 = None)
  //   [34]      requestType:         u8 (0=Market)
  //   [35]      counter:             u8
  //
  // Notes on simplifications:
  //   - We pass `priceSlippage = 0` ("market") — this is conservative for a
  //     mainnet-fork action that the keeper isn't going to execute anyway.
  //   - `jupiterMinimumOut: None` — no atomic JUP swap leg.
  //   - This packing reflects the public IDL at the time of writing. If
  //     Jupiter renames a field the daemon will surface a clean preflight
  //     error rather than silently corrupting state.
  const data = Buffer.concat([
    discriminator("create_increase_position_request"),
    u64LE(sizeUsdDelta),
    u64LE(collateralBaseUnits),
    Buffer.from([side === "long" ? 0 : 1]),
    u64LE(0n), // priceSlippage = 0 (market)
    Buffer.from([0]), // jupiterMinimumOut: None
    Buffer.from([0]), // requestType: Market
    Buffer.from([counter]),
  ]);

  const keys: AccountMeta[] = [
    { pubkey: kp.publicKey, isSigner: true, isWritable: true }, // owner / payer
    { pubkey: fundingAta, isSigner: false, isWritable: true }, // funding USDC ATA
    { pubkey: position, isSigner: false, isWritable: true }, // position PDA
    { pubkey: positionRequest, isSigner: false, isWritable: true }, // request PDA (init)
    { pubkey: JUP_PERPS_POOL, isSigner: false, isWritable: false }, // pool
    { pubkey: custody, isSigner: false, isWritable: false }, // market custody
    { pubkey: USDC_MINT, isSigner: false, isWritable: false }, // collateral mint
    { pubkey: underlyingMint, isSigner: false, isWritable: false }, // underlying mint
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    kp.publicKey,
    fundingAta,
    kp.publicKey,
    USDC_MINT,
  );

  const ix = new TransactionInstruction({
    programId: JUP_PERPS_PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ataIx, ix);
  tx.feePayer = kp.publicKey;
  // Same surfpool blockhash treatment as marinade/kamino — see comment in
  // marinade-execute.ts.
  const { blockhash, lastValidBlockHeight } =
    await surfpool.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight + 300;

  const txSig = await sendAndConfirmTransaction(surfpool, tx, [kp], {
    commitment: "confirmed",
    skipPreflight: true,
  });

  return {
    protocol: "jupiter-perps",
    action: "perp_open",
    txSig,
    positionPda: position.toBase58(),
    collateralUsd,
  };
}

// ─── Public API: closeJupiterPerp ────────────────────────────────────────

export interface CloseJupiterPerpArgs {
  surfpool: Connection;
  kp: Keypair;
  market: string;
}

export interface CloseJupiterPerpResult {
  protocol: "jupiter-perps";
  action: "perp_close";
  txSig: string;
}

/**
 * Lodge a `createDecreasePositionRequest` to flatten whichever side
 * (long or short) the agent has open on `market`. We submit BOTH sides'
 * close requests in a single tx: the side without an open position will
 * fail-soft inside the program (request lands but does nothing on the
 * keeper's execute pass). This avoids a read-then-write race on the fork.
 *
 * If both sides are flat the tx still lands as a no-op evidence row —
 * matches the Zeta executor's "always submit a close" semantics.
 */
export async function closeJupiterPerp(
  args: CloseJupiterPerpArgs,
): Promise<CloseJupiterPerpResult> {
  const { surfpool, kp, market } = args;

  const custody = CUSTODY_BY_MARKET[market];
  const underlyingMint = UNDERLYING_MINT_BY_MARKET[market];
  if (!custody || !underlyingMint) {
    throw new Error(
      `closeJupiterPerp: unsupported market "${market}" (expected SOL-PERP / BTC-PERP / ETH-PERP)`,
    );
  }

  // Lodge a close on the long side. The brain only knows one direction
  // per market at a time and the rate-surfaces signal points at long
  // funding, so the open side is overwhelmingly long in practice.
  const side: "long" | "short" = "long";
  const [position] = positionPda(kp.publicKey, custody, side);
  const counter = Math.floor(Date.now() / 1000) & 0xff;
  const [positionRequest] = positionRequestPda(position, USDC_MINT, counter);
  const fundingAta = getAssociatedTokenAddressSync(USDC_MINT, kp.publicKey);

  // Wire layout for createDecreasePositionRequest:
  //   [0..8]    discriminator
  //   [8..16]   sizeUsdDelta:        u64 (u64::MAX = full close)
  //   [16..24]  collateralUsdDelta:  u64
  //   [24..32]  triggerPrice:        u64
  //   [32]      triggerAboveThreshold: u8 (bool)
  //   [33]      entirePosition:      Option<bool> tag (1) + value (1) = full close
  //   [35]      requestType:         u8 (0=Market)
  //   [36]      counter:             u8
  const data = Buffer.concat([
    discriminator("create_decrease_position_request"),
    u64LE(0xffffffffffffffffn), // sizeUsdDelta = u64::MAX
    u64LE(0n),
    u64LE(0n),
    Buffer.from([0]),
    Buffer.from([1, 1]), // Some(true) — close entire position
    Buffer.from([0]), // requestType: Market
    Buffer.from([counter]),
  ]);

  const keys: AccountMeta[] = [
    { pubkey: kp.publicKey, isSigner: true, isWritable: true },
    { pubkey: fundingAta, isSigner: false, isWritable: true },
    { pubkey: position, isSigner: false, isWritable: true },
    { pubkey: positionRequest, isSigner: false, isWritable: true },
    { pubkey: JUP_PERPS_POOL, isSigner: false, isWritable: false },
    { pubkey: custody, isSigner: false, isWritable: false },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: underlyingMint, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: JUP_PERPS_PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = kp.publicKey;
  const { blockhash, lastValidBlockHeight } =
    await surfpool.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight + 300;

  const txSig = await sendAndConfirmTransaction(surfpool, tx, [kp], {
    commitment: "confirmed",
    skipPreflight: true,
  });

  return {
    protocol: "jupiter-perps",
    action: "perp_close",
    txSig,
  };
}
