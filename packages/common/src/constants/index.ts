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
  strategyToken: new PublicKey('Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm'),
  predictionMarket: new PublicKey('Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4'),
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

/**
 * bUSD (Bundie USDC) — branded devnet test token used to seed agents.
 *
 * Hardcoded rather than read from `process.env.NEXT_PUBLIC_BUSD_MINT`
 * because Next's compile-time substitution doesn't reliably reach this
 * package's source under `transpilePackages`, leaving the bundle with
 * the literal "REPLACE_AFTER_SETUP" sentinel string. Symptom: every
 * wallet's bUSD ATA read in CapitalStep early-returned past the actual
 * RPC call, so the wizard always showed "Claim faucet" even when the
 * user already had $50 sitting in their wallet.
 *
 * If we ever need a per-environment mint, plumb it through web's local
 * env reading (where `process.env.NEXT_PUBLIC_*` IS inlined) rather
 * than re-introducing the indirection here.
 */
export const BUSD_MINT = "42LaRiwvuxfQv5rfHMmk9wU3K2nRxMGzgukNJztydpiB";
export const BUSD_DECIMALS = 6;
export const BUSD_FAUCET_AMOUNT = 50;          // dollars per claim
export const BUSD_FAUCET_AMOUNT_BASE = 50_000_000;  // 50 * 10^6
export const BUSD_FAUCET_COOLDOWN_HOURS = 24;
