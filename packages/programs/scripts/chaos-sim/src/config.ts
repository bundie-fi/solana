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
//   creator: 0.5 USDC seed deposit + 2 × 0.1 rebalances = 0.7 USDC
//   trader:  10 trades × 0.05-0.1 USDC = 0.5–1.0 USDC
// Total per-wallet spend ≤ ~1.0, leaves rent + slippage headroom.
//
// REBALANCES capped at 2 because v1 composition uses kamino only — repeating
// rebalance into the same protocol from the same strategy is a no-op for
// composition variety, so there's no point ranging higher until we add more
// protocols. Bump to 4 once REBALANCE_PROTOCOLS grows.
export const PHASE = {
  CREATORS: 5,
  STRATEGY_SEED_USDC: "0.1",                // shrunk from 0.5 to fit per-wallet USDC after multiple test runs
  REBALANCES_PER_STRATEGY_MIN: 1,
  REBALANCES_PER_STRATEGY_MAX: 1,
  REBALANCE_USDC: "0.05",
  MARKETS_PER_STRATEGY: 2,                  // 5 strategies × 2 = 10 markets
  // create-market needs an --initial-subsidy in USDC. Default is 10 USDC
  // (way over budget). Use the strategy creator's available balance.
  MARKET_INITIAL_SUBSIDY_USDC: "0.1",
  MARKET_THRESHOLD_BPS: 300,                // 3% APY threshold
  MARKET_RESOLUTION_DAYS: 1,                // shorter horizon to keep test loops tight
  TRADER_WALLETS: 5,
  TRADES_PER_TRADER: 10,
  TRADE_USDC_MIN: 50_000,                   // 0.05 USDC
  TRADE_USDC_MAX: 100_000,                  // 0.10 USDC
};

// Rebalance protocols included in the auto-composition recipe.
//
// SCOPE NOTE: each non-kamino protocol's CLI rebalance resolver requires
// protocol-specific config flags (--reserve, --whirlpool, --pool-state,
// --market-index) plus per-strategy account init in some cases. For v1
// of the chaos sim we limit to kamino with a hard-coded devnet reserve
// (KAMINO_DEVNET_RESERVE below) so composition exercises a real Beethoven
// CPI path end-to-end. Adding marinade / drift / orca / raydium / drift-perp
// requires per-protocol config injection in orchestrator.ts — tracked as
// follow-up work.
export const REBALANCE_PROTOCOLS = ["kamino"] as const;
export type RebalanceProtocol = (typeof REBALANCE_PROTOCOLS)[number];

/** Live devnet Kamino USDC reserve (verified by the kamino NAV probe). */
export const KAMINO_DEVNET_RESERVE =
  "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy";

// Inter-tx jitter to avoid devnet rate limits. 200-400ms randomized.
export const TX_JITTER_MIN_MS = 200;
export const TX_JITTER_MAX_MS = 400;
