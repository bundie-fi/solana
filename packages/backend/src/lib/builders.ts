/**
 * builders.ts — unsigned-tx builders for Bundie programs.
 *
 * These mirror the prepare-only builders from @bundie/sol-cli
 * (see /mnt/storage/bundie-fi/cli/solana/src/commands/*.ts) so the backend,
 * CLI, and MCP all produce identical PreparedTx shapes. The backend is the
 * thinnest of the three — it owns no keys, does no signing, and never reads
 * a wallet from disk. Every route returns the base64 of an unsigned tx
 * (optionally partial-signed by an ephemeral mint) for the client to finish.
 *
 * Why hand-encode rather than `program.methods.*().instruction()`?
 *  - strategy-token is pinocchio: no IDL, no Anchor methods, single-byte disc.
 *  - prediction-market IS Anchor, but Anchor's instruction builder pulls a
 *    Wallet through the Provider — we don't have one. Hand-encoding the
 *    8-byte sha256 disc + Borsh args avoids that whole detour.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  DEVNET_USDC,
  anchorDisc,
  encodeName,
  getAssociatedTokenAddress,
  navOraclePDA,
  noMintPDA,
  predictionProgramId,
  strategyPDA,
  strategyProgramId,
  vaultPDA,
  walletPDA,
  yesMintPDA,
} from "./solana.js";
import { finalizePrepared, type PreparedTx } from "./prepare.js";

// ---------------------------------------------------------------------------
// Strategy-token instruction discriminators (single byte; see lib.rs dispatch)
// ---------------------------------------------------------------------------
const ST_DISC = {
  CREATE_STRATEGY: 0,
  BUY_SHARES: 1,
  REDEEM_SHARES: 2,
} as const;

/** Known protocol program IDs (mainnet + devnet share these). */
const PROTOCOL_MAP: Record<string, string> = {
  kamino: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  marginfi: "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA",
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
};

/** On-chain `strategy_type` discriminator. Must match `state::strategy`. */
export const STRATEGY_TYPE_YIELD = 0;
export const STRATEGY_TYPE_AGENT = 1;

// ---------------------------------------------------------------------------
// create_strategy (strategy-token, disc 0)
// ---------------------------------------------------------------------------

export interface CreateStrategyArgs {
  name: string;
  protocol: string;
  feeBps: number;
  /** Min deposit in whole USDC (multiplied by 1e6 internally). */
  minDeposit: number;
  /** Optional override for `deposit_mint` (defaults to devnet USDC). */
  usdcMint?: string;
  /** 'yield' (0) routes through Beethoven CPI; 'agent' (1) keeps funds in wallet PDA. */
  strategyType?: "yield" | "agent";
}

export interface PreparedCreateStrategy extends PreparedTx {
  /** Address of the newly created strategy PDA. */
  strategyAddress: string;
  /** Address of the freshly generated share mint (partial-signed in). */
  mintAddress: string;
}

/**
 * Build an unsigned `create_strategy` tx.
 *
 * Instruction layout (data):
 *   [ disc=0 (u8) | strategy_type (u8) | fee_bps (u16le) |
 *     min_deposit (u64le base units) | name [u8;32] ]
 */
export async function buildCreateStrategy(
  conn: Connection,
  payer: PublicKey,
  args: CreateStrategyArgs
): Promise<PreparedCreateStrategy> {
  const strategyType =
    args.strategyType === "agent" ? STRATEGY_TYPE_AGENT : STRATEGY_TYPE_YIELD;

  const protocolKey = new PublicKey(
    PROTOCOL_MAP[args.protocol.toLowerCase()] ?? args.protocol
  );
  const depositMint = args.usdcMint ? new PublicKey(args.usdcMint) : DEVNET_USDC;

  const name32 = encodeName(args.name);
  const [strategyKey] = strategyPDA(payer, name32);
  const [walletKey] = walletPDA(strategyKey);
  const [navKey] = navOraclePDA(strategyKey);

  // Fresh mint keypair — partial-signed into the tx so callers never see the
  // secret. The caller's wallet only needs to add the payer signature.
  const mintKp = Keypair.generate();

  // data layout: [disc=0, strategy_type u8, fee_bps u16le, min_deposit u64le, name[32]]
  const ixData = Buffer.allocUnsafe(1 + 1 + 2 + 8 + 32);
  let off = 0;
  ixData.writeUInt8(ST_DISC.CREATE_STRATEGY, off);
  off += 1;
  ixData.writeUInt8(strategyType, off);
  off += 1;
  ixData.writeUInt16LE(args.feeBps, off);
  off += 2;
  ixData.writeBigUInt64LE(BigInt(Math.round(args.minDeposit * 1_000_000)), off);
  off += 8;
  name32.copy(ixData, off);

  const ix = new TransactionInstruction({
    programId: strategyProgramId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true }, // creator
      { pubkey: strategyKey, isSigner: false, isWritable: true }, // strategy
      { pubkey: mintKp.publicKey, isSigner: true, isWritable: true }, // mint
      { pubkey: walletKey, isSigner: false, isWritable: false }, // wallet
      { pubkey: navKey, isSigner: false, isWritable: true }, // nav_oracle
      { pubkey: depositMint, isSigner: false, isWritable: false }, // deposit_mint
      { pubkey: protocolKey, isSigner: false, isWritable: false }, // protocol
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // reserve placeholder
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: ixData,
  });

  const tx = new Transaction().add(ix);

  const prepared = await finalizePrepared(conn, tx, {
    description: `Create ${strategyType === STRATEGY_TYPE_AGENT ? "agent" : "yield"} strategy "${args.name}" (fee ${args.feeBps} bps, protocol ${args.protocol})`,
    feePayer: payer,
    partialSigners: [mintKp],
    signers: [
      { pubkey: payer.toBase58(), role: "creator" },
      { pubkey: mintKp.publicKey.toBase58(), role: "strategy_mint", ephemeral: true },
    ],
    accounts: [
      { pubkey: payer.toBase58(), role: "creator", writable: true, signer: true },
      { pubkey: strategyKey.toBase58(), role: "strategy_pda", writable: true, signer: false },
      { pubkey: mintKp.publicKey.toBase58(), role: "strategy_mint", writable: true, signer: true },
      { pubkey: walletKey.toBase58(), role: "wallet_pda", writable: false, signer: false },
      { pubkey: navKey.toBase58(), role: "nav_oracle_pda", writable: true, signer: false },
      { pubkey: depositMint.toBase58(), role: "deposit_mint", writable: false, signer: false },
      { pubkey: protocolKey.toBase58(), role: "protocol", writable: false, signer: false },
    ],
    metadata: {
      name: args.name,
      strategy: strategyKey.toBase58(),
      mint: mintKp.publicKey.toBase58(),
      wallet: walletKey.toBase58(),
      navOracle: navKey.toBase58(),
      protocol: protocolKey.toBase58(),
      strategyType,
      feeBps: args.feeBps,
      minDepositUsdc: args.minDeposit,
    },
  });

  return {
    ...prepared,
    strategyAddress: strategyKey.toBase58(),
    mintAddress: mintKp.publicKey.toBase58(),
  };
}

// ---------------------------------------------------------------------------
// buy_shares (strategy-token, disc 1)
// ---------------------------------------------------------------------------

export interface BuyStrategySharesArgs {
  /** Strategy PDA address. */
  strategy: string;
  /** Strategy share mint (read off-chain from the strategy account). */
  shareMint: string;
  /** Strategy wallet PDA (read off-chain from the strategy account). */
  walletPda: string;
  /** Deposit mint (USDC) used by this strategy. */
  depositMint: string;
  /** Amount in whole USDC (× 1e6 internally). */
  amount: number;
}

/**
 * Build an unsigned `buy_shares` tx for the strategy-token program.
 *
 * The caller passes the on-chain values for `shareMint`, `walletPda`, and
 * `depositMint` — the backend doesn't fetch+decode the Strategy account here
 * because that pulls in the pinocchio account layout (the CLI does this via
 * its own `fetchStrategy` reader). Clients that already loaded the Strategy
 * (e.g. via `GET /api/strategies/:id`) can just pass these forward.
 *
 * Instruction layout (data): [ disc=1 (u8) | amount (u64le base units) ]
 */
export async function buildBuyStrategyShares(
  conn: Connection,
  payer: PublicKey,
  args: BuyStrategySharesArgs
): Promise<PreparedTx> {
  const strategy = new PublicKey(args.strategy);
  const shareMint = new PublicKey(args.shareMint);
  const walletKey = new PublicKey(args.walletPda);
  const depositMint = new PublicKey(args.depositMint);
  const amount = BigInt(Math.round(args.amount * 1_000_000));

  const buyerSharesAta = getAssociatedTokenAddress(shareMint, payer);
  const walletTokenAta = getAssociatedTokenAddress(depositMint, walletKey, true);
  const buyerTokenAta = getAssociatedTokenAddress(depositMint, payer);

  const data = Buffer.allocUnsafe(9);
  data.writeUInt8(ST_DISC.BUY_SHARES, 0);
  data.writeBigUInt64LE(amount, 1);

  const ix = new TransactionInstruction({
    programId: strategyProgramId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: strategy, isSigner: false, isWritable: true },
      { pubkey: shareMint, isSigner: false, isWritable: true },
      { pubkey: buyerSharesAta, isSigner: false, isWritable: true },
      { pubkey: walletKey, isSigner: false, isWritable: false },
      { pubkey: walletTokenAta, isSigner: false, isWritable: true },
      { pubkey: buyerTokenAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: depositMint, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);

  return finalizePrepared(conn, tx, {
    description: `Buy ${args.amount} USDC worth of shares in strategy ${args.strategy}`,
    feePayer: payer,
    signers: [{ pubkey: payer.toBase58(), role: "buyer" }],
    accounts: [
      { pubkey: payer.toBase58(), role: "buyer", writable: true, signer: true },
      { pubkey: strategy.toBase58(), role: "strategy", writable: true, signer: false },
      { pubkey: shareMint.toBase58(), role: "strategy_mint", writable: true, signer: false },
      { pubkey: buyerSharesAta.toBase58(), role: "buyer_shares_ata", writable: true, signer: false },
      { pubkey: walletKey.toBase58(), role: "strategy_wallet", writable: false, signer: false },
      { pubkey: walletTokenAta.toBase58(), role: "wallet_token_ata", writable: true, signer: false },
      { pubkey: buyerTokenAta.toBase58(), role: "buyer_token_ata", writable: true, signer: false },
    ],
    metadata: {
      strategy: strategy.toBase58(),
      mint: shareMint.toBase58(),
      amountUsdc: args.amount,
      amountBase: amount.toString(),
    },
  });
}

// ---------------------------------------------------------------------------
// prediction-market: buy_shares (Anchor 1.0, disc = sha256("global:buy_shares"))
// ---------------------------------------------------------------------------

const PM_DISC = {
  buyShares: anchorDisc("buy_shares"),
} as const;

export interface PredictBuyArgs {
  /** Market PDA address. */
  market: string;
  /** Strategy address (the market's `strategy` field). Required because the
   *  program enforces buyer ≠ strategy.authority via this account. */
  strategy: string;
  /** Collateral mint (the market's `collateral_mint` — usually devnet USDC). */
  collateralMint: string;
  /** YES or NO. */
  side: "yes" | "no";
  /** Amount in whole USDC (× 1e6 internally). */
  amount: number;
}

/**
 * Build an unsigned prediction-market `buy_shares` tx.
 *
 * Instruction data: [ disc(8) | outcome (u8: 0=Yes, 1=No) | amount (u64le) ]
 */
export async function buildPredictBuy(
  conn: Connection,
  payer: PublicKey,
  args: PredictBuyArgs
): Promise<PreparedTx> {
  const market = new PublicKey(args.market);
  const strategy = new PublicKey(args.strategy);
  const collateralMint = new PublicKey(args.collateralMint);
  const outcome = args.side === "yes" ? 0 : 1;
  const amount = BigInt(Math.round(args.amount * 1_000_000));

  const [yesMint] = yesMintPDA(market);
  const [noMint] = noMintPDA(market);
  const [vault] = vaultPDA(market);

  const buyerCollateral = getAssociatedTokenAddress(collateralMint, payer);
  const buyerYesAta = getAssociatedTokenAddress(yesMint, payer);
  const buyerNoAta = getAssociatedTokenAddress(noMint, payer);

  // [disc(8), outcome(1), amount(8)] = 17 bytes
  const data = Buffer.allocUnsafe(17);
  PM_DISC.buyShares.copy(data, 0);
  data.writeUInt8(outcome, 8);
  data.writeBigUInt64LE(amount, 9);

  const ix = new TransactionInstruction({
    programId: predictionProgramId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true }, // buyer
      { pubkey: market, isSigner: false, isWritable: true }, // market
      { pubkey: strategy, isSigner: false, isWritable: false }, // strategy (creator-self-exclusion)
      { pubkey: yesMint, isSigner: false, isWritable: true }, // yes_mint
      { pubkey: noMint, isSigner: false, isWritable: true }, // no_mint
      { pubkey: vault, isSigner: false, isWritable: true }, // vault
      { pubkey: buyerCollateral, isSigner: false, isWritable: true }, // buyer_collateral
      { pubkey: buyerYesAta, isSigner: false, isWritable: true }, // buyer_yes_ata
      { pubkey: buyerNoAta, isSigner: false, isWritable: true }, // buyer_no_ata
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);

  return finalizePrepared(conn, tx, {
    description: `Predict ${args.side.toUpperCase()} with ${args.amount} USDC on market ${args.market}`,
    feePayer: payer,
    signers: [{ pubkey: payer.toBase58(), role: "buyer" }],
    accounts: [
      { pubkey: payer.toBase58(), role: "buyer", writable: true, signer: true },
      { pubkey: market.toBase58(), role: "market", writable: true, signer: false },
      { pubkey: strategy.toBase58(), role: "strategy", writable: false, signer: false },
      { pubkey: yesMint.toBase58(), role: "yes_mint", writable: true, signer: false },
      { pubkey: noMint.toBase58(), role: "no_mint", writable: true, signer: false },
      { pubkey: vault.toBase58(), role: "vault", writable: true, signer: false },
      { pubkey: buyerCollateral.toBase58(), role: "buyer_collateral", writable: true, signer: false },
      { pubkey: buyerYesAta.toBase58(), role: "buyer_yes_ata", writable: true, signer: false },
      { pubkey: buyerNoAta.toBase58(), role: "buyer_no_ata", writable: true, signer: false },
    ],
    metadata: {
      market: market.toBase58(),
      strategy: strategy.toBase58(),
      side: args.side,
      amountUsdc: args.amount,
      amountBase: amount.toString(),
    },
  });
}
