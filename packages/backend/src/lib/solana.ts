import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";

export const connection = new Connection(rpcUrl, "confirmed");

/** Strategy Token Program ID */
export const strategyProgramId = new PublicKey(
  process.env.STRATEGY_PROGRAM_ID || "Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm"
);

/** Prediction Market Program ID */
export const predictionProgramId = new PublicKey(
  process.env.PREDICTION_PROGRAM_ID || "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4"
);

// ---------------------------------------------------------------------------
// Anchor program plumbing
//
// Strategy-token is a pinocchio program — there is no Anchor IDL, so we never
// expose a `getStrategyProgram`. Decoding is hand-rolled in the script layer
// (see `packages/programs/scripts/keeper.mjs`) and in the cli/web packages.
//
// Prediction-market is a real Anchor program, so we want a typed
// `Program<PredictionMarket>` here. The wiring below is INTENTIONALLY
// commented out: `@coral-xyz/anchor` and `@bundie/common` (which re-exports
// the IDL) are not declared in this package's `package.json`. Activate by:
//
//   1. Adding the deps:
//        pnpm --filter @bundie/backend add @coral-xyz/anchor @bundie/common
//   2. Uncommenting the block below.
//
// Code is kept here so the contract is documented and a one-line uncomment
// turns the helpers on once those deps land.
//
// ---------------------------------------------------------------------------
// import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
// import {
//   predictionMarketIdl,
//   type PredictionMarket,
// } from "@bundie/common/src/idl/index.js";
//
// /** Build an AnchorProvider bound to our shared `connection`. */
// export function makeProvider(wallet: Wallet): AnchorProvider {
//   return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
// }
//
// /** Convenience for server-side scripts that hold a raw Keypair. */
// export function makeProviderFromKeypair(kp: Keypair): AnchorProvider {
//   return makeProvider(new Wallet(kp));
// }
//
// /** Typed Anchor client for the prediction-market program. */
// export function getPredictionProgram(
//   provider: AnchorProvider,
// ): Program<PredictionMarket> {
//   return new Program<PredictionMarket>(
//     predictionMarketIdl as PredictionMarket,
//     provider,
//   );
// }
//
// // No Anchor client for strategy-token — it's pinocchio. Build raw
// // TransactionInstructions using `strategyProgramId` and the discriminator
// // byte map documented in @bundie/common/src/idl/index.ts.
//
// // Keep `Keypair` re-imported even when the block is disabled so the import
// // does not become unused after activation.
export type { Keypair };
