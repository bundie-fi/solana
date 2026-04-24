/**
 * create-rate-barrier-market.ts — build + send a kind=5 (Rate Barrier)
 * prediction market creation tx, signed by a Bundie agent vault keypair.
 *
 * Hand-encodes the Anchor ix: we bypass `@coral-xyz/anchor` Wallet/Provider
 * plumbing because the agent vault is a plain Keypair here (the Zerion
 * sign-and-send path lives in packages/zerion-agent — this script runs in
 * chaos-sim with direct signing for the deterministic devnet evidence run).
 *
 * Wire layout after the 8-byte discriminator (`sha256("global:create_market_v2")[..8]`):
 *   question:        String              (u32 LE len + utf-8 bytes)
 *   market_id:       u64 LE
 *   kind:            u8
 *   payload:         [u8; 64]            (raw bytes)
 *   resolution_slot: u64 LE
 *   initial_subsidy: u64 LE
 *   fee_bps:         u16 LE
 *   initial_nav_a:   u64 LE
 *   initial_nav_b:   u64 LE
 *
 * Rate Barrier payload (kind=5):
 *   payload[0..8]   = threshold_bps          (u64 LE, must be > 0)
 *   payload[8..16]  = window_start_slot      (u64 LE)
 *   payload[16..24] = window_end_slot        (u64 LE, > start)
 *   payload[24..32] = rate_reader_selector   (u64 LE, > 0; 1 = Kamino USDC supply)
 *   payload[32..64] = reserved (zero)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "node:crypto";
// Policy fast-path for non-swap ix. Throws on DENY, no-op on ALLOW.
// Relative import keeps this a workspace-local dependency without
// pulling @bundie/zerion-agent into package.json.
// @ts-expect-error — JS module, no type declarations provided
import { enforceProgramPolicy } from "../../../../../zerion-agent/src/bundie/program-enforcer.js";

export const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);

/** Devnet USDC (used as collateral across chaos-sim). */
export const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

/** Market kind = Rate Barrier. See programs/prediction-market/src/state/market.rs. */
export const MARKET_KIND_RATE_BARRIER = 5;

/** Per-market payload length (see MARKET_PAYLOAD_LEN). */
export const MARKET_PAYLOAD_LEN = 64;

export interface CreateRateBarrierArgs {
  connection: Connection;
  agentVault: Keypair;
  thresholdBps: bigint;
  windowStartSlot: bigint;
  windowEndSlot: bigint;
  selector: bigint;
  question: string;
  marketId: bigint;
  resolutionSlot: bigint;
  initialSubsidy: bigint;
  feeBps: number;
  collateralMint?: PublicKey;
  /**
   * Optional — absolute path to the agent's `policies.yaml`. When set, the tx
   * is routed through `enforceProgramPolicy()` BEFORE signing. Throws with a
   * clear `DENIED ...` message if the program_allowlist predicate rejects it.
   * Omit to skip the gate (legacy call-sites; not recommended in production).
   */
  policyPath?: string;
}

export interface CreateRateBarrierResult {
  signature: string;
  marketPda: string;
  vaultPda: string;
  yesMintPda: string;
  noMintPda: string;
  /**
   * Set when `policyPath` was supplied AND the program_allowlist predicate
   * allowed the ix. Absent when no policy gate was run.
   */
  policyGate?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function anchorDiscriminator(fnName: string): Buffer {
  return createHash("sha256")
    .update(`global:${fnName}`)
    .digest()
    .subarray(0, 8);
}

function u8(v: number): Buffer {
  const b = Buffer.alloc(1);
  b.writeUInt8(v, 0);
  return b;
}

function u16LE(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
}

function u64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}

function borshString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

function buildRateBarrierPayload(
  thresholdBps: bigint,
  windowStartSlot: bigint,
  windowEndSlot: bigint,
  selector: bigint,
): Buffer {
  const payload = Buffer.alloc(MARKET_PAYLOAD_LEN);
  payload.set(u64LE(thresholdBps), 0);
  payload.set(u64LE(windowStartSlot), 8);
  payload.set(u64LE(windowEndSlot), 16);
  payload.set(u64LE(selector), 24);
  // bytes 32..64 are zero-initialized (reserved)
  return payload;
}

function derivePdas(creator: PublicKey, marketId: bigint) {
  // Strategy seed = creator (agent vault); keeps the market PDA unique per
  // (agent, market_id) since we removed strategy-token but the seed remains.
  const strategy = creator;

  const marketIdLE = u64LE(marketId);
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), strategy.toBuffer(), marketIdLE],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPda.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  const [yesMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), marketPda.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  const [noMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), marketPda.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  return { strategy, marketPda, vaultPda, yesMintPda, noMintPda };
}

// ───────────────────────────────────────────────────────────────────────────
// Main export
// ───────────────────────────────────────────────────────────────────────────

export async function createRateBarrierMarket(
  args: CreateRateBarrierArgs,
): Promise<CreateRateBarrierResult> {
  const {
    connection,
    agentVault,
    thresholdBps,
    windowStartSlot,
    windowEndSlot,
    selector,
    question,
    marketId,
    resolutionSlot,
    initialSubsidy,
    feeBps,
  } = args;
  const collateralMint = args.collateralMint ?? DEVNET_USDC_MINT;

  // Sanity — same invariants the on-chain program enforces, so we fail fast
  // with a clear message instead of a raw program error if callers pass bad
  // args.
  if (initialSubsidy <= 0n) {
    throw new Error("initialSubsidy must be > 0 (program invariant)");
  }
  if (thresholdBps <= 0n) {
    throw new Error("thresholdBps must be > 0 (program invariant)");
  }
  if (windowEndSlot <= windowStartSlot) {
    throw new Error("windowEndSlot must be > windowStartSlot");
  }
  if (selector <= 0n) {
    throw new Error("selector must be > 0 (1 = Kamino USDC supply)");
  }
  if (question.length > 128) {
    throw new Error("question exceeds 128 chars (program invariant)");
  }

  // ─── Policy gate (program_allowlist) ─────────────────────────────────────
  // Runs BEFORE we build/sign the tx. Throws on DENY with err.code/err.reason
  // attached. This closes the "create_market_v2 bypasses the enforcer" gap —
  // the fast-path validates (programId, ix) instead of swap-shaped context.
  if (args.policyPath) {
    enforceProgramPolicy({
      policyPath: args.policyPath,
      programId: PREDICTION_MARKET_PROGRAM_ID.toBase58(),
      instructionName: "create_market_v2",
    });
  }

  const creator = agentVault.publicKey;
  const { strategy, marketPda, vaultPda, yesMintPda, noMintPda } = derivePdas(
    creator,
    marketId,
  );

  const payload = buildRateBarrierPayload(
    thresholdBps,
    windowStartSlot,
    windowEndSlot,
    selector,
  );

  // Encode ix data in the exact Borsh order of the Rust handler signature.
  const data = Buffer.concat([
    anchorDiscriminator("create_market_v2"),
    borshString(question),
    u64LE(marketId),
    u8(MARKET_KIND_RATE_BARRIER),
    payload,
    u64LE(resolutionSlot),
    u64LE(initialSubsidy),
    u16LE(feeBps),
    u64LE(0n), // initial_nav_a — unused for kind=5
    u64LE(0n), // initial_nav_b — unused for kind=5
  ]);

  // Accounts in the exact order the Anchor struct declares them.
  const keys = [
    { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: marketPda, isSigner: false, isWritable: true },
    { pubkey: strategy, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // strategy_b (unused for kind=5)
    { pubkey: collateralMint, isSigner: false, isWritable: false },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: yesMintPda, isSigner: false, isWritable: true },
    { pubkey: noMintPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = creator;

  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [agentVault],
    { commitment: "confirmed" },
  );

  return {
    signature,
    marketPda: marketPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    yesMintPda: yesMintPda.toBase58(),
    noMintPda: noMintPda.toBase58(),
    policyGate: args.policyPath
      ? `enforceProgramPolicy passed (program_allowlist allowed ${PREDICTION_MARKET_PROGRAM_ID.toBase58().slice(0, 4)}...create_market_v2)`
      : undefined,
  };
}
