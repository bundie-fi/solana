import { PublicKey } from "@solana/web3.js";

export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

export const PROGRAM_IDS = {
  strategyToken: new PublicKey(
    process.env.NEXT_PUBLIC_STRATEGY_PROGRAM_ID ||
      "11111111111111111111111111111111"
  ),
  predictionMarket: new PublicKey(
    process.env.NEXT_PUBLIC_PREDICTION_PROGRAM_ID ||
      "11111111111111111111111111111111"
  ),
} as const;
