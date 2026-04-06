import { Connection, PublicKey } from "@solana/web3.js";

const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";

export const connection = new Connection(rpcUrl, "confirmed");

/** Strategy Token Program ID from env */
export const strategyProgramId = process.env.STRATEGY_PROGRAM_ID
  ? new PublicKey(process.env.STRATEGY_PROGRAM_ID)
  : null;

/** Prediction Market Program ID from env */
export const predictionProgramId = process.env.PREDICTION_PROGRAM_ID
  ? new PublicKey(process.env.PREDICTION_PROGRAM_ID)
  : null;

// TODO: Import IDL and create Program instances once Anchor workspace is built
// export function getStrategyProgram(provider: AnchorProvider) { ... }
// export function getPredictionProgram(provider: AnchorProvider) { ... }
