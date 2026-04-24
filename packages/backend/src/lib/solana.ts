import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
// `@bundie/common`'s root export uses TS-only directory imports that pure
// node ESM (used by tsx) can't resolve. We import the IDL JSON directly,
// which works in both tsc and runtime ESM. The PredictionMarket TYPE comes
// from the .ts companion file (type-only imports get erased at build time).
import predictionMarketIdl from "@bundie/common/src/idl/prediction_market.json" with { type: "json" };
import type { PredictionMarket } from "@bundie/common/src/idl/prediction_market.js";
import { createHash } from "crypto";

const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";

export const connection = new Connection(rpcUrl, "confirmed");

/** Prediction Market Program ID */
export const predictionProgramId = new PublicKey(
  process.env.PREDICTION_PROGRAM_ID || "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4"
);

// ---------------------------------------------------------------------------
// SPL constants — re-declared inline so we don't pull in `@solana/spl-token`
// just for two pubkeys + ATA derivation. The values are pinned to mainnet/devnet
// SPL Token program and Associated Token Account program (verified against
// `@solana/spl-token@0.4.14`).
// ---------------------------------------------------------------------------

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/** Devnet USDC mint (Circle) — default `collateral_mint` for prediction markets. */
export const DEVNET_USDC = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

/**
 * Compute an Associated Token Account address without `@solana/spl-token`.
 * `allowOwnerOffCurve` MUST be true when the owner is a PDA.
 */
export function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  _allowOwnerOffCurve = false
): PublicKey {
  // `findProgramAddressSync` doesn't enforce on-curve checks for the seeds, so
  // the `_allowOwnerOffCurve` flag is informational here — kept for API
  // parity with `@solana/spl-token`'s `getAssociatedTokenAddressSync`.
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

// ---------------------------------------------------------------------------
// Prediction-market PDAs (Anchor program)
// ---------------------------------------------------------------------------

/** market PDA: seeds = ["market", creator, market_id_le8] */
export function marketPDA(
  creator: PublicKey,
  marketId: bigint
): [PublicKey, number] {
  const idBuf = Buffer.allocUnsafe(8);
  idBuf.writeBigUInt64LE(marketId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), idBuf],
    predictionProgramId
  );
}

/** vault PDA: seeds = ["vault", market] */
export function vaultPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    predictionProgramId
  );
}

/** yes_mint PDA: seeds = ["yes_mint", market] */
export function yesMintPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), market.toBuffer()],
    predictionProgramId
  );
}

/** no_mint PDA: seeds = ["no_mint", market] */
export function noMintPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), market.toBuffer()],
    predictionProgramId
  );
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** 8-byte Anchor instruction discriminator (sha256("global:<name>")[0..8]). */
export function anchorDisc(ixName: string): Buffer {
  return createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

// ---------------------------------------------------------------------------
// Anchor program plumbing
//
// Prediction-market is a real Anchor program. The helpers below give us a
// typed `Program<PredictionMarket>` for read paths (decoding accounts,
// fetching state). For tx BUILDING we still encode the discriminator + Borsh
// args by hand — this is intentional. Anchor's
// `program.methods.*().instruction()` path requires a full provider with a
// wallet, which is the wrong shape for an unsigned-tx server. We keep the
// typed Program for read-only usage.
// ---------------------------------------------------------------------------

/** Build an AnchorProvider bound to our shared `connection`. */
export function makeProvider(wallet: Wallet): AnchorProvider {
  return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

/** Convenience for server-side scripts that hold a raw Keypair. */
export function makeProviderFromKeypair(kp: Keypair): AnchorProvider {
  return makeProvider(new Wallet(kp));
}

/**
 * Typed Anchor client for the prediction-market program.
 *
 * Pass a provider built from a read-only `Wallet` (e.g. a fresh `Keypair`
 * generated server-side and discarded) — it is never used to sign in this
 * codepath; `Program` only needs it for type compatibility.
 */
export function getPredictionProgram(
  provider: AnchorProvider
): Program<PredictionMarket> {
  return new Program<PredictionMarket>(
    predictionMarketIdl as PredictionMarket,
    provider
  );
}

export type { Keypair };
