import { ProtocolGrid, type Protocol } from "@/components/ProtocolGrid";
import { Stat } from "@/components/ui/Stat";

/**
 * The full set of Beethoven protocols wired into the strategy-token program.
 *
 * Source of truth:
 *   - packages/programs/programs/strategy-token/Cargo.toml (`beethoven` features)
 *   - packages/beethoven/crates/{deposit,swap,perps}/<name>/src/lib.rs
 *     (each crate exposes a `<NAME>_PROGRAM_ID` constant — copied verbatim).
 *
 * 9 deposit + 22 swap + 2 perps = 33 protocols.
 */
const PROTOCOLS: Protocol[] = [
  // ── Deposit (9) ──────────────────────────────────────────────────────
  {
    name: "Kamino Lend",
    category: "Deposit",
    subCategory: "lending",
    programId: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
    devnet: true,
  },
  {
    name: "Jupiter Earn",
    category: "Deposit",
    subCategory: "vault aggregator",
    programId: "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9",
    devnet: true,
  },
  {
    name: "Drift Deposit",
    category: "Deposit",
    subCategory: "lending / borrow",
    programId: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
    devnet: true,
  },
  {
    name: "MarginFi",
    category: "Deposit",
    subCategory: "lending",
    programId: "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA",
    devnet: true,
  },
  {
    name: "Marinade",
    category: "Deposit",
    subCategory: "liquid staking",
    programId: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
    devnet: true,
  },
  {
    name: "Solend",
    category: "Deposit",
    subCategory: "lending",
    programId: "ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx",
    devnet: true,
  },
  {
    name: "SPL Stake Pool",
    category: "Deposit",
    subCategory: "liquid staking",
    programId: "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy",
    devnet: true,
  },
  {
    name: "Drift Vaults",
    category: "Deposit",
    subCategory: "vault aggregator",
    programId: "vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR",
    devnet: true,
  },
  {
    name: "Meteora Vaults",
    category: "Deposit",
    subCategory: "vault aggregator",
    programId: "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi",
    devnet: true,
  },

  // ── Perps (2) ────────────────────────────────────────────────────────
  {
    name: "Mango v4",
    category: "Perps",
    subCategory: "perps + spot margin",
    programId: "4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg",
    devnet: true,
  },
  {
    name: "Zeta",
    category: "Perps",
    subCategory: "perps + options",
    programId: "BG3oRikW8d16YjUEmX3ZxHm9SiJzrGtMhsSR8aCw1Cd7",
    devnet: true,
  },

  // ── Swap (22) ────────────────────────────────────────────────────────
  {
    name: "Raydium CPMM",
    category: "Swap",
    subCategory: "constant product",
    programId: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
    devnet: true,
  },
  {
    name: "Raydium CPMM (devnet)",
    category: "Swap",
    subCategory: "constant product",
    programId: "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb",
    devnet: true,
  },
  {
    name: "Raydium CLMM",
    category: "Swap",
    subCategory: "CLMM",
    programId: "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH",
    devnet: true,
  },
  {
    name: "Raydium AMM v4",
    category: "Swap",
    subCategory: "constant product",
    programId: "DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav",
    devnet: true,
  },
  {
    name: "Orca Whirlpools",
    category: "Swap",
    subCategory: "CLMM",
    programId: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    devnet: true,
  },
  {
    name: "Meteora DLMM",
    category: "Swap",
    subCategory: "bin-based AMM",
    programId: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    devnet: true,
  },
  {
    name: "Meteora DAMM v2",
    category: "Swap",
    subCategory: "constant product",
    programId: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
    devnet: true,
  },
  {
    name: "Phoenix",
    category: "Swap",
    subCategory: "CLOB",
    programId: "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",
    devnet: true,
  },
  {
    name: "OpenBook v2",
    category: "Swap",
    subCategory: "CLOB",
    programId: "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb",
    devnet: true,
  },
  {
    name: "Manifest",
    category: "Swap",
    subCategory: "CLOB",
    programId: "MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms",
    devnet: true,
  },
  {
    name: "Aldrin",
    category: "Swap",
    subCategory: "constant product",
    programId: "AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6",
    devnet: true,
  },
  {
    name: "Aldrin v2",
    category: "Swap",
    subCategory: "stable curve",
    programId: "CURVGoZn8zycx6FXwwevgBTB2gVvdbGTEpvMJDbgs2t4",
    devnet: true,
  },
  {
    name: "Futarchy",
    category: "Swap",
    subCategory: "prediction AMM",
    programId: "FUTARELBfJfQ8RDGhg1wdhddq1odMAJUePHFuBYfUxKq",
    devnet: true,
  },
  {
    name: "Gamma",
    category: "Swap",
    subCategory: "CPMM",
    programId: "GAMMA7meSFWaBXF25oSUgmGRwaW6sCMFLmBNiMSdbHVT",
    devnet: true,
  },
  {
    name: "Hadron",
    category: "Swap",
    subCategory: "AMM",
    programId: "Q72w4coozA552keKDdeeh2EyQw32qfMFsHPu6cbatom",
    devnet: true,
  },
  {
    name: "Heaven",
    category: "Swap",
    subCategory: "AMM",
    programId: "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o",
    devnet: true,
  },
  {
    name: "Omnipair",
    category: "Swap",
    subCategory: "AMM",
    programId: "omnixgS8fnqHfCcTGKWj6JtKjzpJZ1Y5y9pyFkQDkYE",
    devnet: true,
  },
  {
    name: "Perena",
    category: "Swap",
    subCategory: "stable swap",
    programId: "NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P",
    devnet: true,
  },
  {
    name: "Scale AMM",
    category: "Swap",
    subCategory: "AMM",
    programId: "SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA",
    devnet: true,
  },
  {
    name: "Scale VMM",
    category: "Swap",
    subCategory: "virtual market",
    programId: "SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa",
    devnet: true,
  },
  {
    name: "SolFi",
    category: "Swap",
    subCategory: "AMM",
    programId: "SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe",
    devnet: true,
  },
  {
    name: "SolFi v2",
    category: "Swap",
    subCategory: "AMM",
    programId: "SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF",
    devnet: true,
  },
];

export const metadata = {
  title: "Protocols — Bundie",
  description:
    "All 33 Beethoven protocols wired into the Bundie strategy-token program: deposit vaults, swap routers, and perps DEXes — live on Solana devnet.",
};

export default function ProtocolsPage() {
  const deposit = PROTOCOLS.filter((p) => p.category === "Deposit").length;
  const swap = PROTOCOLS.filter((p) => p.category === "Swap").length;
  const perps = PROTOCOLS.filter((p) => p.category === "Perps").length;

  return (
    <main className="mx-auto w-full max-w-content px-4 py-6 md:px-8 md:py-12">
      {/* ─── Hero ─── */}
      <section className="mb-8 md:mb-12">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400">
            Composable surface
          </span>
          <h1 className="font-serif text-display text-neutral-900">
            <em className="text-amber-400">Protocols</em>.
          </h1>
          <p className="text-body text-neutral-700 max-w-xl mt-2">
            Every Solana DeFi primitive Bundie can route capital through.
            Strategy authors compose these into tradeable positions — your
            shares track NAV in real time.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3 md:max-w-xl">
          <Stat label="Deposit" value={deposit} tone="gold" align="left" />
          <Stat label="Swap" value={swap} tone="purple" align="left" />
          <Stat label="Perps" value={perps} tone="success" align="left" />
        </div>
      </section>

      <ProtocolGrid protocols={PROTOCOLS} />
    </main>
  );
}
