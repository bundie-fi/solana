/**
 * config.ts — chaos-sim constants.
 *
 * Tweakable. Set CHAOS_RPC env var to override RPC. All amounts are in
 * USDC base units (10^6 = 1 USDC) or lamports (10^9 = 1 SOL).
 */
import { PublicKey } from "@solana/web3.js";

export const RPC_URL = process.env.CHAOS_RPC || "https://api.devnet.solana.com";

// Pool size + per-wallet seed. Tight by design: deployer holds ~14.99 USDC
// total (mint authority is multisig — no faucet). 10 wallets (5 creators
// + 5 traders) × 1.2 USDC = 12 USDC, leaves ~3 USDC reserve.
export const WALLET_COUNT = 5;                       // creators AND traders (10 total wallets)
export const SEED_SOL_LAMPORTS = 0.05 * 1e9;         // 0.05 SOL each
export const SEED_USDC_BASE_UNITS = 1_200_000;       // 1.2 USDC each (6 dp)

export const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

export const STRATEGY_TOKEN_PROGRAM_ID = new PublicKey(
  "Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm",
);
export const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);

// CLI binary path. We invoke the published @bundie/sol-cli@0.4.0 via npx
// so the harness doesn't depend on a workspace install.
export const CLI_BIN = process.env.CHAOS_CLI || "npx -y -p @bundie/sol-cli@latest bundie-sol";

// Phase sizing scaled to fit the 1.2 USDC/wallet budget:
//   creator: 0.5 USDC seed deposit + 3 × 0.1 rebalances = 0.8 USDC
//   trader:  10 trades × 0.05-0.1 USDC = 0.5–1.0 USDC
// Total per-wallet spend ≤ ~1.0, leaves rent + slippage headroom.
export const PHASE = {
  CREATORS: 5,                              // 5 strategies, each multi-protocol
  STRATEGY_SEED_USDC: "0.5",                // initial buy_shares passed via --deposit
  REBALANCES_PER_STRATEGY_MIN: 2,           // composition: 2-4 protocols
  REBALANCES_PER_STRATEGY_MAX: 4,
  REBALANCE_USDC: "0.1",                    // amount per rebalance leg
  MARKETS_PER_STRATEGY: 2,                  // 5 strategies × 2 = 10 markets
  TRADER_WALLETS: 5,
  TRADES_PER_TRADER: 10,                    // halved from spec to fit budget
  TRADE_USDC_MIN: 50_000,                   // 0.05 USDC
  TRADE_USDC_MAX: 100_000,                  // 0.10 USDC
};

// Available rebalance protocols. After the Drift-perp agent merges, append
// 'drift-perp' to this list and the harness will start composing it in.
export const REBALANCE_PROTOCOLS = [
  "kamino",          // spot lending
  "drift",           // spot lending (deposit side)
  "marinade",        // LST mint
  "orca-whirlpools", // CLMM swap
  "raydium-clmm",    // CLMM swap
  // 'drift-perp',   // ← unlocked once strategy-token byte 8 ships
] as const;
export type RebalanceProtocol = (typeof REBALANCE_PROTOCOLS)[number];

// Inter-tx jitter to avoid devnet rate limits. 200-400ms randomized.
export const TX_JITTER_MIN_MS = 200;
export const TX_JITTER_MAX_MS = 400;
