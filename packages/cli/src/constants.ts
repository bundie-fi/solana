import { PublicKey } from '@solana/web3.js';

export const PROGRAM_IDS = {
  strategyToken:    new PublicKey('Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV'),
  predictionMarket: new PublicKey('Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i'),
} as const;
