/**
 * balances.ts — minimal SPL token-balance reader for the brain's observed
 * state.
 *
 * The chaos-sim seeds 1000 USDC into each agent's surfpool ATA every tick
 * (see surfpool-seed.ts) and Marinade stakes land mSOL into a separate ATA.
 * Without surfacing these to the brain, the LLM only sees `self.sol` and
 * concludes "no USDC, can't lend" — so it noops forever.
 *
 * We intentionally do NOT import from commit-nav-helper.ts here. That module
 * is the heavy NAV pricing pipeline (Pyth feeds, Kamino reserves, Zeta SDK
 * boot). Re-using it for a 30-line balance peek would drag the dep graph in
 * and slow the brain prompt assembly. A small dedicated reader is cleaner.
 *
 * Failure semantics: every failure mode (ATA missing, RPC down, parsed-info
 * malformed) returns 0 rather than throwing. The brain prompt must be
 * assembled even when surfpool is flaky.
 */
import { Connection, PublicKey } from "@solana/web3.js";

/** Real mainnet USDC mint — surfpool fork inherits the state. */
export const SURFPOOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Marinade liquid-staking mSOL mint. */
export const SURFPOOL_MSOL_MINT = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";

/** USDC has 6 decimals (1e6 base units = 1 USDC). */
const USDC_DECIMALS = 6;

/** mSOL has 9 decimals (1e9 base units = 1 mSOL). */
const MSOL_DECIMALS = 9;

export interface SurfpoolTokenBalances {
  /** Human-formatted USDC balance (e.g. 1000.0). 0 when ATA missing. */
  usdc: number;
  /** Human-formatted mSOL balance (e.g. 0.5). 0 when ATA missing. */
  msol: number;
}

/**
 * Read the agent's surfpool USDC + mSOL balances by enumerating their
 * SPL token accounts. Decimal-formatted (base units → UI). Any missing
 * ATA / RPC error contributes 0 silently — the brain prompt cannot be
 * blocked on a flaky observation read.
 *
 * Single round-trip via getParsedTokenAccountsByOwner so two reads share
 * one RPC call. Same approach `commit-nav-helper.ts` uses for NAV pricing.
 */
export async function readSurfpoolTokenBalances(
  surfpool: Connection,
  owner: PublicKey,
): Promise<SurfpoolTokenBalances> {
  const out: SurfpoolTokenBalances = { usdc: 0, msol: 0 };
  try {
    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    const accs = await surfpool.getParsedTokenAccountsByOwner(
      owner,
      { programId: TOKEN_PROGRAM_ID },
      "confirmed",
    );
    for (const { account } of accs.value) {
      const parsed = account.data.parsed?.info;
      if (!parsed) continue;
      const mint = String(parsed.mint ?? "");
      // `uiAmount` is the parsed-token-account JSON's pre-scaled decimal
      // value. Falls back to dividing the raw amount when uiAmount is null
      // (rare — happens for mints whose decimals exceed JS number safety).
      const uiAmount = parsed.tokenAmount?.uiAmount;
      const rawAmount = parsed.tokenAmount?.amount;
      if (mint === SURFPOOL_USDC_MINT) {
        if (typeof uiAmount === "number" && Number.isFinite(uiAmount)) {
          out.usdc = uiAmount;
        } else if (typeof rawAmount === "string") {
          out.usdc = Number(rawAmount) / 10 ** USDC_DECIMALS;
        }
      } else if (mint === SURFPOOL_MSOL_MINT) {
        if (typeof uiAmount === "number" && Number.isFinite(uiAmount)) {
          out.msol = uiAmount;
        } else if (typeof rawAmount === "string") {
          out.msol = Number(rawAmount) / 10 ** MSOL_DECIMALS;
        }
      }
    }
  } catch {
    // Surfpool unreachable / token program not loaded — return zeros so the
    // brain prompt still assembles. Same fail-soft contract as readVaultNav.
  }
  return out;
}
