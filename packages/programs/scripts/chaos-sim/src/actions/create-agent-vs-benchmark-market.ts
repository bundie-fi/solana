/**
 * create-agent-vs-benchmark-market.ts — build + send a kind=6
 * (AgentVsBenchmark) prediction market creation tx.
 *
 * Kind=6 asks: "will the target agent vault's NAV growth exceed a
 * benchmark rate by at least `spreadBps` over a slot window?"
 *
 * Payload layout (64 bytes):
 *   [0..8]   spreadBps               (u64 LE) — required excess over benchmark
 *   [8..16]  windowStartSlot         (u64 LE)
 *   [16..24] windowEndSlot           (u64 LE)
 *   [24..32] benchmarkReaderSelector (u64 LE, same table as RateBarrier)
 *   [32..64] targetAgent             (Pubkey, 32 bytes) — vault being measured
 *
 * On-chain guard: targetAgent MUST != creator (insider-trading prevention).
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
// @ts-expect-error — JS module, no type declarations provided
import { enforceProgramPolicy } from "../../../../../zerion-agent/src/bundie/program-enforcer.js";

export const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);

export const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

export const MARKET_KIND_AGENT_VS_BENCHMARK = 6;
export const MARKET_PAYLOAD_LEN = 64;

export interface CreateAgentVsBenchmarkArgs {
  connection: Connection;
  /** The agent that CREATES the market (bob). Must != targetAgent. */
  creatorVault: Keypair;
  /** The vault whose NAV is being measured (alice). Must != creator. */
  targetAgent: PublicKey;
  spreadBps: bigint;
  windowStartSlot: bigint;
  windowEndSlot: bigint;
  benchmarkSelector: bigint;
  question: string;
  marketId: bigint;
  resolutionSlot: bigint;
  initialSubsidy: bigint;
  feeBps: number;
  collateralMint?: PublicKey;
  policyPath?: string;
}

export interface CreateAgentVsBenchmarkResult {
  signature: string;
  marketPda: string;
  vaultPda: string;
  yesMintPda: string;
  noMintPda: string;
  policyGate?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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

function buildKind6Payload(
  spreadBps: bigint,
  windowStartSlot: bigint,
  windowEndSlot: bigint,
  benchmarkSelector: bigint,
  targetAgent: PublicKey,
): Buffer {
  const payload = Buffer.alloc(MARKET_PAYLOAD_LEN);
  payload.set(u64LE(spreadBps), 0);
  payload.set(u64LE(windowStartSlot), 8);
  payload.set(u64LE(windowEndSlot), 16);
  payload.set(u64LE(benchmarkSelector), 24);
  payload.set(targetAgent.toBuffer(), 32); // 32 bytes
  return payload;
}

function derivePdas(creator: PublicKey, marketId: bigint) {
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

// ─── Main export ──────────────────────────────────────────────────────────

export async function createAgentVsBenchmarkMarket(
  args: CreateAgentVsBenchmarkArgs,
): Promise<CreateAgentVsBenchmarkResult> {
  const {
    connection, creatorVault, targetAgent, spreadBps,
    windowStartSlot, windowEndSlot, benchmarkSelector,
    question, marketId, resolutionSlot, initialSubsidy, feeBps,
  } = args;
  const collateralMint = args.collateralMint ?? DEVNET_USDC_MINT;
  const creator = creatorVault.publicKey;

  if (creator.equals(targetAgent)) {
    throw new Error("creator cannot equal targetAgent (on-chain insider guard)");
  }
  if (initialSubsidy <= 0n) throw new Error("initialSubsidy must be > 0");
  if (spreadBps <= 0n) throw new Error("spreadBps must be > 0");
  if (windowEndSlot <= windowStartSlot) throw new Error("windowEndSlot must be > windowStartSlot");
  if (benchmarkSelector <= 0n) throw new Error("benchmarkSelector must be > 0");
  if (question.length > 128) throw new Error("question exceeds 128 chars");

  if (args.policyPath) {
    enforceProgramPolicy({
      policyPath: args.policyPath,
      programId: PREDICTION_MARKET_PROGRAM_ID.toBase58(),
      instructionName: "create_market_v2",
    });
  }

  const { strategy, marketPda, vaultPda, yesMintPda, noMintPda } = derivePdas(creator, marketId);

  const payload = buildKind6Payload(
    spreadBps, windowStartSlot, windowEndSlot, benchmarkSelector, targetAgent,
  );

  const data = Buffer.concat([
    anchorDiscriminator("create_market_v2"),
    borshString(question),
    u64LE(marketId),
    u8(MARKET_KIND_AGENT_VS_BENCHMARK),
    payload,
    u64LE(resolutionSlot),
    u64LE(initialSubsidy),
    u16LE(feeBps),
    u64LE(0n), // initial_nav_a — unused for kind=6
    u64LE(0n), // initial_nav_b — unused for kind=6
  ]);

  const keys = [
    { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: marketPda, isSigner: false, isWritable: true },
    { pubkey: strategy, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // strategy_b unused
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
    connection, tx, [creatorVault], { commitment: "confirmed" },
  );

  return {
    signature,
    marketPda: marketPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    yesMintPda: yesMintPda.toBase58(),
    noMintPda: noMintPda.toBase58(),
    policyGate: args.policyPath
      ? `enforceProgramPolicy passed (kind=6 create_market_v2 on ${targetAgent.toBase58().slice(0, 8)}…)`
      : undefined,
  };
}
