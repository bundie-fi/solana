import { Connection, PublicKey } from "@solana/web3.js";

const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";

export const connection = new Connection(rpcUrl, "confirmed");

/** Strategy Token Program ID */
export const strategyProgramId = new PublicKey(
  process.env.STRATEGY_PROGRAM_ID || "Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV"
);

/** Prediction Market Program ID */
export const predictionProgramId = new PublicKey(
  process.env.PREDICTION_PROGRAM_ID || "Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i"
);

// TODO: Import IDL and create Program instances once Anchor workspace is built
// export function getStrategyProgram(provider: AnchorProvider) { ... }
// export function getPredictionProgram(provider: AnchorProvider) { ... }
