import { PublicKey } from "@solana/web3.js";

export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

export const PROGRAM_IDS = {
  strategyToken: new PublicKey(
    process.env.NEXT_PUBLIC_STRATEGY_PROGRAM_ID ||
      "Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV"
  ),
  predictionMarket: new PublicKey(
    process.env.NEXT_PUBLIC_PREDICTION_PROGRAM_ID ||
      "Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i"
  ),
} as const;
