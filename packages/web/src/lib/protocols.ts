/**
 * Static catalog of every Beethoven-wired protocol available to the
 * strategy-token program (devnet `Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV`).
 *
 * Source of truth for program IDs:
 *   packages/beethoven/crates/{deposit,swap,perps}/<protocol>/src/lib.rs
 *   (`pub const <NAME>_PROGRAM_ID: Address = ...`)
 *
 * Keep this file in sync whenever a new protocol is wired into Beethoven and
 * the strategy-token dispatch table. There are 33 entries today
 * (9 Deposit + 22 Swap + 2 Perps).
 */

export type ProtocolCategory = "deposit" | "swap" | "perps";

export interface Protocol {
  /** Canonical kebab-case identifier — stable across UI + on-chain dispatch. */
  id: string;
  /** Display name shown to end users. */
  name: string;
  /** Top-level grouping. */
  category: ProtocolCategory;
  /** Devnet program ID (base58). */
  programId: string;
  /** One-line user-facing blurb. */
  description: string;
}

export const PROTOCOLS: Protocol[] = [
  // ─── Deposit (9) ─────────────────────────────────────────────────────────
  {
    id: "kamino",
    name: "Kamino",
    category: "deposit",
    programId: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
    description: "Lending market — supply assets to earn variable yield.",
  },
  {
    id: "jupiter",
    name: "Jupiter Earn",
    category: "deposit",
    programId: "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9",
    description: "Aggregated yield vaults curated by Jupiter.",
  },
  {
    id: "drift",
    name: "Drift Spot",
    category: "deposit",
    programId: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
    description: "Spot deposit into Drift's borrow/lend markets.",
  },
  {
    id: "drift-vaults",
    name: "Drift Vaults",
    category: "deposit",
    programId: "vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR",
    description: "Manager-run vaults built on top of Drift.",
  },
  {
    id: "marginfi",
    name: "MarginFi",
    category: "deposit",
    programId: "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA",
    description: "Cross-margin lending pools with isolated risk.",
  },
  {
    id: "marinade",
    name: "Marinade",
    category: "deposit",
    programId: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
    description: "Liquid stake SOL into mSOL.",
  },
  {
    id: "spl-stake-pool",
    name: "SPL Stake Pool",
    category: "deposit",
    programId: "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy",
    description: "Native stake-pool program — Jito, BlazeStake, custom LSTs.",
  },
  {
    id: "meteora-vaults",
    name: "Meteora Dynamic Vaults",
    category: "deposit",
    programId: "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi",
    description: "Auto-allocating yield aggregator across lenders.",
  },
  {
    id: "solend",
    name: "Solend",
    category: "deposit",
    programId: "ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx",
    description: "Permissionless lending markets (Save).",
  },

  // ─── Swap (22) ───────────────────────────────────────────────────────────
  {
    id: "orca-whirlpools",
    name: "Orca Whirlpools",
    category: "swap",
    programId: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    description: "Concentrated-liquidity AMM by Orca.",
  },
  {
    id: "raydium-clmm",
    name: "Raydium CLMM",
    category: "swap",
    programId: "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH",
    description: "Raydium concentrated-liquidity AMM (devnet).",
  },
  {
    id: "raydium-amm-v4",
    name: "Raydium AMM v4",
    category: "swap",
    programId: "DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav",
    description: "Raydium constant-product AMM (devnet).",
  },
  {
    id: "raydium-cpmm",
    name: "Raydium CPMM",
    category: "swap",
    programId: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
    description: "Raydium constant-product market maker (mainnet ID).",
  },
  {
    id: "raydium-cpmm-devnet",
    name: "Raydium CPMM (devnet)",
    category: "swap",
    programId: "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb",
    description: "Devnet build of Raydium CPMM.",
  },
  {
    id: "meteora-dlmm",
    name: "Meteora DLMM",
    category: "swap",
    programId: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    description: "Discrete liquidity bins, zero slippage inside a bin.",
  },
  {
    id: "meteora-damm-v2",
    name: "Meteora DAMM v2",
    category: "swap",
    programId: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
    description: "Dynamic constant-product AMM by Meteora.",
  },
  {
    id: "phoenix",
    name: "Phoenix",
    category: "swap",
    programId: "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",
    description: "On-chain CLOB by Ellipsis Labs.",
  },
  {
    id: "openbook-v2",
    name: "OpenBook v2",
    category: "swap",
    programId: "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb",
    description: "Permissionless central limit order book.",
  },
  {
    id: "manifest",
    name: "Manifest",
    category: "swap",
    programId: "MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms",
    description: "Minimalist CLOB primitive.",
  },
  {
    id: "heaven",
    name: "Heaven",
    category: "swap",
    programId: "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o",
    description: "Bonding-curve based memecoin venue.",
  },
  {
    id: "aldrin",
    name: "Aldrin",
    category: "swap",
    programId: "AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6",
    description: "Aldrin AMM v1.",
  },
  {
    id: "aldrin-v2",
    name: "Aldrin v2",
    category: "swap",
    programId: "CURVGoZn8zycx6FXwwevgBTB2gVvdbGTEpvMJDbgs2t4",
    description: "Aldrin curve-based AMM v2.",
  },
  {
    id: "futarchy",
    name: "Futarchy",
    category: "swap",
    programId: "FUTARELBfJfQ8RDGhg1wdhddq1odMAJUePHFuBYfUxKq",
    description: "Conditional-token AMM for futarchy markets.",
  },
  {
    id: "gamma",
    name: "Gamma",
    category: "swap",
    programId: "GAMMA7meSFWaBXF25oSUgmGRwaW6sCMFLmBNiMSdbHVT",
    description: "Concentrated AMM optimised for stable pairs.",
  },
  {
    id: "scale-amm",
    name: "Scale AMM",
    category: "swap",
    programId: "SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA",
    description: "Scale's classic constant-product pools.",
  },
  {
    id: "scale-vmm",
    name: "Scale VMM",
    category: "swap",
    programId: "SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa",
    description: "Scale's virtual market-maker pools.",
  },
  {
    id: "omnipair",
    name: "Omnipair",
    category: "swap",
    programId: "omnixgS8fnqHfCcTGKWj6JtKjzpJZ1Y5y9pyFkQDkYE",
    description: "Single-sided pair swap primitive.",
  },
  {
    id: "hadron",
    name: "Hadron",
    category: "swap",
    programId: "Q72w4coozA552keKDdeeh2EyQw32qfMFsHPu6cbatom",
    description: "Hadron AMM venue.",
  },
  {
    id: "perena",
    name: "Perena",
    category: "swap",
    programId: "NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P",
    description: "Stableswap optimised for pegged assets.",
  },
  {
    id: "solfi",
    name: "SolFi",
    category: "swap",
    programId: "SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe",
    description: "SolFi RFQ-style swap router (v1).",
  },
  {
    id: "solfi-v2",
    name: "SolFi v2",
    category: "swap",
    programId: "SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF",
    description: "SolFi RFQ-style swap router (v2).",
  },

  // ─── Perps (2) ───────────────────────────────────────────────────────────
  {
    id: "mango",
    name: "Mango v4",
    category: "perps",
    programId: "4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg",
    description: "Mango cross-margin perpetuals.",
  },
  {
    id: "zeta",
    name: "Zeta",
    category: "perps",
    programId: "BG3oRikW8d16YjUEmX3ZxHm9SiJzrGtMhsSR8aCw1Cd7",
    description: "Zeta perps + on-chain options.",
  },
];

const PROTOCOL_INDEX: Map<string, Protocol> = new Map(
  PROTOCOLS.map((p) => [p.id, p])
);

export function findProtocol(id: string): Protocol | undefined {
  return PROTOCOL_INDEX.get(id);
}

export function protocolsByCategory(c: ProtocolCategory): Protocol[] {
  return PROTOCOLS.filter((p) => p.category === c);
}
