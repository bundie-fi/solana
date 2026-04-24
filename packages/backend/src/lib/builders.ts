/**
 * builders.ts — unsigned-tx builders for Bundie programs.
 *
 * The backend owns no keys, does no signing, and never reads a wallet from
 * disk. Every route returns the base64 of an unsigned tx for the client to
 * finish.
 *
 * Why hand-encode rather than `program.methods.*().instruction()`? Anchor's
 * instruction builder pulls a Wallet through the Provider — we don't have
 * one. Hand-encoding the 8-byte sha256 disc + Borsh args avoids that whole
 * detour.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  anchorDisc,
  getAssociatedTokenAddress,
  noMintPDA,
  predictionProgramId,
  vaultPDA,
  yesMintPDA,
} from "./solana.js";
import { finalizePrepared, type PreparedTx } from "./prepare.js";

// ---------------------------------------------------------------------------
// prediction-market: buy_shares (Anchor 1.0, disc = sha256("global:buy_shares"))
// ---------------------------------------------------------------------------

const PM_DISC = {
  buyShares: anchorDisc("buy_shares"),
} as const;

export interface PredictBuyArgs {
  /** Market PDA address. */
  market: string;
  /** Strategy / creator account (market's `strategy` field). Required because
   *  the program enforces buyer ≠ creator via this account. */
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
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: strategy, isSigner: false, isWritable: false },
      { pubkey: yesMint, isSigner: false, isWritable: true },
      { pubkey: noMint, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: buyerCollateral, isSigner: false, isWritable: true },
      { pubkey: buyerYesAta, isSigner: false, isWritable: true },
      { pubkey: buyerNoAta, isSigner: false, isWritable: true },
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
