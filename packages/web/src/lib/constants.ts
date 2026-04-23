import { PublicKey } from "@solana/web3.js";

export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

export const PROGRAM_IDS = {
  strategyToken: new PublicKey(
    process.env.NEXT_PUBLIC_STRATEGY_PROGRAM_ID ||
      "Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm"
  ),
  predictionMarket: new PublicKey(
    process.env.NEXT_PUBLIC_PREDICTION_PROGRAM_ID ||
      "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4"
  ),
} as const;
