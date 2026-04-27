/**
 * create-nav-market.ts — build + send a NAV-based prediction-market
 * (kind 1/2/3) creation tx, signed by a Bundie agent vault keypair.
 *
 * The on-chain `create_market_v2` handler now snapshots BundieVault NAV
 * at create time for kinds 1 (NavTarget), 2 (Relative / head-to-head),
 * and 3 (Drawdown). The legacy `initial_nav_a` / `initial_nav_b` u64
 * args are passed as 0 — the handler ignores them for these kinds and
 * overrides from the BundieVault NAV.
 *
 * Per-kind 64-byte payload layout:
 *   kind=1 NavTarget   payload[0..8]  = threshold_lamports (u64 LE, > 0)
 *   kind=2 Relative    payload empty (resolver reads snapshotted nav_a/b)
 *   kind=3 Drawdown    payload[0..8]  = drawdown_bps       (u64 LE, 1..=10_000)
 *
 * Hand-encoded Anchor ix: the chaos-sim deliberately bypasses
 * `@coral-xyz/anchor` Wallet/Provider plumbing because the agent vault
 * is a plain Keypair here and we want zero workspace coupling.
 *
 * Wire layout after the 8-byte discriminator (`sha256("global:create_market_v2")[..8]`):
 *   question:        String              (Borsh: u32 LE len + utf-8 bytes, max 128)
 *   market_id:       u64 LE
 *   kind:            u8
 *   payload:         [u8; 64]
 *   resolution_slot: u64 LE
 *   initial_subsidy: u64 LE
 *   fee_bps:         u16 LE
 *   initial_nav_a:   u64 LE              (0 — handler overrides from vault)
 *   initial_nav_b:   u64 LE              (0 — handler overrides from vault)
 *
 * Account ordering matches `CreateMarketV2` in the Rust handler. The two
 * trailing optional accounts (`target_vault_a`, `target_vault_b`) follow
 * Anchor's optional-account convention: present accounts pass the real
 * pubkey; absent slots pass the program ID itself as the sentinel.
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
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
// @ts-expect-error — JS module, no type declarations provided
import { enforceProgramPolicy } from "../../../../../zerion-agent/src/bundie/program-enforcer.js";

export const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);

/** Bundie's own bUSD mint on devnet — minted by setup-busd. The actual mint
 *  used for prediction-market collateral. The previous USDC devnet pubkey
 *  here was a copy-paste leftover from the rate-readers prototype and
 *  produced markets denominated in a token nobody held. Override via
 *  BUSD_MINT env for non-default deploys (e.g. mainnet). */
export const DEVNET_BUSD_MINT = new PublicKey(
  process.env.BUSD_MINT ?? "42LaRiwvuxfQv5rfHMmk9wU3K2nRxMGzgukNJztydpiB",
);

export const MARKET_KIND_NAV_TARGET = 1;
export const MARKET_KIND_RELATIVE = 2;
export const MARKET_KIND_DRAWDOWN = 3;
export const MARKET_PAYLOAD_LEN = 64;

export type NavMarketKind = 1 | 2 | 3;

export interface CreateNavMarketArgs {
  connection: Connection;
  /** Agent vault Keypair signing as the market creator. */
  creatorVault: Keypair;
  /** Market kind (1=NavTarget, 2=Relative, 3=Drawdown). */
  kind: NavMarketKind;
  /** Pubkey of agent A's BundieVault authority (must != creator for kind=1/3). */
  targetAgentA: PublicKey;
  /** Pubkey of agent B's BundieVault authority. Required for kind=2. */
  targetAgentB?: PublicKey | null;
  /** kind=1: target NAV in lamports (1 bUSD = 1_000_000). */
  thresholdLamports?: bigint;
  /** kind=3: drawdown threshold in bps (1..=10_000). */
  drawdownBps?: bigint;
  question: string;
  marketId: bigint;
  resolutionSlot: bigint;
  initialSubsidy: bigint;
  feeBps: number;
  collateralMint?: PublicKey;
  policyPath?: string;
}

export interface CreateNavMarketResult {
  signature: string;
  marketPda: string;
  vaultPda: string;
  yesMintPda: string;
  noMintPda: string;
  targetVaultAPda: string;
  targetVaultBPda?: string;
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

/** Derive `[\"bundie_vault\", authority]` PDA against the prediction-market program. */
export function bundieVaultPda(authority: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bundie_vault"), authority.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  return pda;
}

function buildKindPayload(
  kind: NavMarketKind,
  thresholdLamports: bigint | undefined,
  drawdownBps: bigint | undefined,
): Buffer {
  const payload = Buffer.alloc(MARKET_PAYLOAD_LEN);
  switch (kind) {
    case MARKET_KIND_NAV_TARGET: {
      if (thresholdLamports === undefined || thresholdLamports <= 0n) {
        throw new Error("kind=1 requires thresholdLamports > 0");
      }
      payload.set(u64LE(thresholdLamports), 0);
      break;
    }
    case MARKET_KIND_RELATIVE: {
      // Resolver reads snapshotted NAVs from market state — payload empty.
      break;
    }
    case MARKET_KIND_DRAWDOWN: {
      if (
        drawdownBps === undefined ||
        drawdownBps <= 0n ||
        drawdownBps > 10_000n
      ) {
        throw new Error("kind=3 requires drawdownBps in [1, 10000]");
      }
      payload.set(u64LE(drawdownBps), 0);
      break;
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unknown kind: ${_exhaustive as number}`);
    }
  }
  return payload;
}

function deriveMarketPdas(strategy: PublicKey, marketId: bigint) {
  // `strategy` is the peer-agent BundieVault PDA the market predicts on
  // (NOT the creator's wallet — that produced an unbuyable market under the
  // pre-2026-04-27 program because buy_shares validates strategy account
  // layout). Anchor seeds the market PDA off this pubkey, so changing it
  // gives every new market a fresh address space.
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

export async function createNavMarket(
  args: CreateNavMarketArgs,
): Promise<CreateNavMarketResult> {
  const {
    connection,
    creatorVault,
    kind,
    targetAgentA,
    targetAgentB,
    thresholdLamports,
    drawdownBps,
    question,
    marketId,
    resolutionSlot,
    initialSubsidy,
    feeBps,
  } = args;
  const collateralMint = args.collateralMint ?? DEVNET_BUSD_MINT;
  const creator = creatorVault.publicKey;

  if (![1, 2, 3].includes(kind as number)) {
    throw new Error(`unsupported kind ${kind}; expected 1, 2, or 3`);
  }
  if (initialSubsidy <= 0n) throw new Error("initialSubsidy must be > 0");
  if (question.length > 128) throw new Error("question exceeds 128 chars");

  // Insider guard: kinds 1/3 measure agent A's NAV against a snapshot, so
  // the creator MUST not equal targetAgentA. Kind=2 compares two distinct
  // agents — creator is not necessarily either of them, but cannot be both
  // simultaneously (and cannot match A or B).
  if (creator.equals(targetAgentA)) {
    throw new Error("create_market: creator cannot equal targetAgentA");
  }

  if (kind === MARKET_KIND_RELATIVE) {
    if (!targetAgentB) {
      throw new Error("kind=2 requires targetAgentB");
    }
    if (targetAgentA.equals(targetAgentB)) {
      throw new Error("kind=2 requires distinct targetAgentA/B");
    }
    if (creator.equals(targetAgentB)) {
      throw new Error("create_market: creator cannot equal targetAgentB");
    }
  }

  if (args.policyPath) {
    enforceProgramPolicy({
      policyPath: args.policyPath,
      programId: PREDICTION_MARKET_PROGRAM_ID.toBase58(),
      instructionName: "create_market_v2",
    });
  }

  const targetVaultAPda = bundieVaultPda(targetAgentA);
  const targetVaultBPda =
    kind === MARKET_KIND_RELATIVE && targetAgentB
      ? bundieVaultPda(targetAgentB)
      : null;

  // The market's `strategy` is the peer-agent BundieVault PDA (the vault
  // whose NAV the market predicts on). buy_shares validates this account
  // against the BundieVault discriminator + reads its `authority` field for
  // the creator-self-exclusion check, so a real on-chain vault is required.
  const { strategy, marketPda, vaultPda, yesMintPda, noMintPda } =
    deriveMarketPdas(targetVaultAPda, marketId);

  // Creator's bUSD ATA — the source of the seed-liquidity transfer the
  // program does inside create_market_v2. Built idempotently below so the
  // tx works on a fresh agent that hasn't received bUSD yet (the ATA is
  // created on first creation; subsequent calls no-op).
  const subsidySourceAta = getAssociatedTokenAddressSync(collateralMint, creator);

  // For kind=2 the on-chain handler also requires `strategy_b !=
  // SystemProgram` and uses it as the second strategy identity. Reuse
  // targetAgentB as the strategy_b identity — the resolver only reads
  // BundieVault NAV via target_vault_b, so any unique pubkey works.
  const strategyB =
    kind === MARKET_KIND_RELATIVE && targetAgentB
      ? targetAgentB
      : SystemProgram.programId;

  const payload = buildKindPayload(kind, thresholdLamports, drawdownBps);

  const data = Buffer.concat([
    anchorDiscriminator("create_market_v2"),
    borshString(question),
    u64LE(marketId),
    u8(kind),
    payload,
    u64LE(resolutionSlot),
    u64LE(initialSubsidy),
    u16LE(feeBps),
    u64LE(0n), // initial_nav_a — handler overrides from vault for kinds 1/2/3
    u64LE(0n), // initial_nav_b — handler overrides from vault for kinds 1/2/3
  ]);

  // Anchor optional accounts: pass the program ID itself as the sentinel
  // for any None slot. target_vault_a is required for kinds 1/2/3.
  // target_vault_b is required only for kind=2.
  const targetVaultBAccount = targetVaultBPda ?? PREDICTION_MARKET_PROGRAM_ID;

  const keys = [
    { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: marketPda, isSigner: false, isWritable: true },
    { pubkey: strategy, isSigner: false, isWritable: false },
    { pubkey: strategyB, isSigner: false, isWritable: false },
    { pubkey: collateralMint, isSigner: false, isWritable: false },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: yesMintPda, isSigner: false, isWritable: true },
    { pubkey: noMintPda, isSigner: false, isWritable: true },
    // Order matches CreateMarketV2 in create_market_v2.rs — subsidy_source
    // sits between the no_mint init slot and token_program.
    { pubkey: subsidySourceAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: targetVaultAPda, isSigner: false, isWritable: false },
    { pubkey: targetVaultBAccount, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys,
    data,
  });

  // Idempotent ATA create: cheap if the ATA already exists, mandatory on
  // first market creation per agent. Bundling it into the same tx keeps
  // the create_market_v2 path atomic w.r.t. ATA presence.
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    creator,
    subsidySourceAta,
    creator,
    collateralMint,
  );

  const tx = new Transaction().add(ataIx).add(ix);
  tx.feePayer = creator;

  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [creatorVault],
    { commitment: "confirmed" },
  );

  return {
    signature,
    marketPda: marketPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    yesMintPda: yesMintPda.toBase58(),
    noMintPda: noMintPda.toBase58(),
    targetVaultAPda: targetVaultAPda.toBase58(),
    targetVaultBPda: targetVaultBPda?.toBase58(),
    policyGate: args.policyPath
      ? `enforceProgramPolicy passed (kind=${kind} create_market_v2 on ${targetAgentA.toBase58().slice(0, 8)}…)`
      : undefined,
  };
}
