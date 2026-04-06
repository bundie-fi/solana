import { PublicKey } from '@solana/web3.js'

/** Solana cluster */
export const CLUSTER = 'devnet' as const

/** RPC endpoints */
export const RPC_ENDPOINTS = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
} as const

/** Program IDs — update after deployment */
export const PROGRAM_IDS = {
  strategyToken: new PublicKey('Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV'),
  predictionMarket: new PublicKey('Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i'),
} as const

/** PDA seed prefixes */
export const SEEDS = {
  strategy: Buffer.from('strategy'),
  wallet: Buffer.from('wallet'),
  nav: Buffer.from('nav'),
  market: Buffer.from('market'),
} as const

/** Theme colors */
export const COLORS = {
  earnGold: '#d4a853',
  predictPurple: '#a78bfa',
  background: '#0a0a0f',
  surface: '#141420',
  border: '#1e1e2e',
} as const

/** Precision constants */
export const PRECISION = {
  /** NAV scaling factor (1e9) */
  NAV_SCALE: 1_000_000_000n,
  /** Basis points divisor */
  BPS_DIVISOR: 10_000,
  /** LS-LMSR scaling factor */
  LMSR_SCALE: 1_000_000_000n,
} as const
