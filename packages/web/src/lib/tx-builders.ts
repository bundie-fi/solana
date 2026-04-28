/**
 * Hand-encoded prediction-market transactions.
 *
 * We deliberately DON'T pull the Anchor method-builder into the client
 * bundle , it drags in a large BN/borsh surface that Next.js has to polyfill.
 * Instead we encode the two instructions we actually need (buy_shares +
 * redeem) using their Anchor discriminators and the account layouts from
 * `packages/common/src/idl/prediction_market.json`.
 *
 * Anchor discriminator = first 8 bytes of sha256("global:<ix_name>"). The
 * values below were taken verbatim from the IDL so we don't need the
 * `crypto.subtle` roundtrip at runtime.
 */
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PROGRAM_IDS } from "./constants";
import { deriveMarketPdas, type MarketView } from "./markets";

// ─── Anchor discriminators (from IDL) ────────────────────────────────────
// Taken verbatim from packages/common/src/idl/prediction_market.json.

const DISC_BUY_SHARES = Uint8Array.from([40, 239, 138, 154, 8, 37, 106, 108]);
const DISC_REDEEM = Uint8Array.from([184, 12, 86, 149, 70, 196, 97, 225]);

// ─── u64 LE helper ───────────────────────────────────────────────────────

function encodeU64LE(value: number | bigint): Uint8Array {
  const v = typeof value === "bigint" ? value : BigInt(value);
  const buf = new Uint8Array(8);
  let n = v;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

// ─── buy_shares ──────────────────────────────────────────────────────────

export interface BuildBuySharesArgs {
  market: MarketView;
  buyer: PublicKey;
  outcome: "yes" | "no";
  /** Amount of collateral to spend, in base units (USDC = 1_000_000 per $1). */
  amount: number | bigint;
}

/**
 * Build a Transaction that calls `buy_shares` on the prediction-market
 * program. Caller signs + sends; we don't require a wallet in the builder
 * so this module stays SSR-safe.
 *
 * The `buyer_collateral` account is derived as the buyer's ATA for the
 * market's collateral mint. If the buyer hasn't funded that account yet
 * the ix will fail , a separate "fund my USDC" flow is out of scope for
 * this PR.
 */
export function buildBuyShares({
  market,
  buyer,
  outcome,
  amount,
}: BuildBuySharesArgs): TransactionInstruction {
  const programId = PROGRAM_IDS.predictionMarket;
  const marketPk = new PublicKey(market.address);
  const strategyPk = new PublicKey(market.strategy);
  const collateralMintPk = new PublicKey(market.collateralMint);

  const { yesMint, noMint, vault } = deriveMarketPdas(programId, marketPk);

  const buyerCollateral = getAssociatedTokenAddressSync(
    collateralMintPk,
    buyer,
    false,
  );
  const buyerYesAta = getAssociatedTokenAddressSync(yesMint, buyer, false);
  const buyerNoAta = getAssociatedTokenAddressSync(noMint, buyer, false);

  // Outcome enum: 0 = Yes, 1 = No (Anchor enum discriminator).
  const outcomeByte = outcome === "yes" ? 0 : 1;

  const data = new Uint8Array(8 + 1 + 8);
  data.set(DISC_BUY_SHARES, 0);
  data[8] = outcomeByte;
  data.set(encodeU64LE(amount), 9);

  const keys = [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: marketPk, isSigner: false, isWritable: true },
    { pubkey: strategyPk, isSigner: false, isWritable: false },
    { pubkey: yesMint, isSigner: false, isWritable: true },
    { pubkey: noMint, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: buyerCollateral, isSigner: false, isWritable: true },
    { pubkey: buyerYesAta, isSigner: false, isWritable: true },
    { pubkey: buyerNoAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.from(data),
  });
}

export async function buildBuySharesTx(
  connection: Connection,
  args: BuildBuySharesArgs,
): Promise<Transaction> {
  const ix = buildBuyShares(args);
  const tx = new Transaction().add(ix);
  tx.feePayer = args.buyer;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  return tx;
}

// ─── redeem ──────────────────────────────────────────────────────────────

export interface BuildRedeemArgs {
  market: MarketView;
  redeemer: PublicKey;
}

/**
 * Build a `redeem` ix for a resolved market. Picks the winning outcome
 * mint based on `market.outcome`; if the market isn't resolved the caller
 * should guard before invoking.
 */
export function buildRedeem({
  market,
  redeemer,
}: BuildRedeemArgs): TransactionInstruction {
  if (market.outcome !== "yes" && market.outcome !== "no") {
    throw new Error("redeem: market not resolved");
  }
  const programId = PROGRAM_IDS.predictionMarket;
  const marketPk = new PublicKey(market.address);
  const collateralMintPk = new PublicKey(market.collateralMint);
  const { yesMint, noMint, vault } = deriveMarketPdas(programId, marketPk);

  const winnerMint = market.outcome === "yes" ? yesMint : noMint;
  const redeemerShares = getAssociatedTokenAddressSync(
    winnerMint,
    redeemer,
    false,
  );
  const redeemerCollateral = getAssociatedTokenAddressSync(
    collateralMintPk,
    redeemer,
    false,
  );

  const keys = [
    { pubkey: redeemer, isSigner: true, isWritable: true },
    { pubkey: marketPk, isSigner: false, isWritable: false },
    { pubkey: winnerMint, isSigner: false, isWritable: true },
    { pubkey: redeemerShares, isSigner: false, isWritable: true },
    { pubkey: redeemerCollateral, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.from(DISC_REDEEM),
  });
}

export async function buildRedeemTx(
  connection: Connection,
  args: BuildRedeemArgs,
): Promise<Transaction> {
  const ix = buildRedeem(args);
  const tx = new Transaction().add(ix);
  tx.feePayer = args.redeemer;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  return tx;
}
