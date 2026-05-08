/**
 * One-shot USDC top-up for the 5 empty agents post-surfpool-wipe.
 *
 * Hits surfpool's `surfnet_setTokenAccount` cheat-code via the existing
 * ensureSurfpoolUsdc helper. The cheat-code creates the ATA on-demand
 * if missing, so this is safe even on a fresh fork where the agents'
 * USDC accounts don't yet exist.
 *
 * Usage:
 *   pnpm --filter @bundie/programs exec tsx scripts/seed-empty-agents.ts
 *
 * Optional env:
 *   SURFPOOL_RPC_URL  defaults to the public Railway hostname so this
 *                     can be run from a local dev machine.
 *   SEED_USDC_UI      defaults to 1000.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { ensureSurfpoolUsdc } from "./chaos-sim/src/lib/surfpool-seed.js";

const RPC = process.env.SURFPOOL_RPC_URL ?? "https://bundie-surfpool-production.up.railway.app";
const AMOUNT = Number(process.env.SEED_USDC_UI ?? "1000");

const AGENTS: Array<[string, string]> = [
  ["barbell",         "4GgG1CyrrAefJvYBF4smgLxjjBmFKaye69cdEg9HZv5r"],
  ["apy-rotator",     "CQHoUDgyYeMq4fktxEm2nmRC2we2DiaUM78cmPhrU4DY"],
  ["funding-shorter", "8DWydCZJYda6Q8CLPbY6iXxH6qwZzqkgsZXBCb3nyeuo"],
  ["stable-arber",    "6dAWXZtN1RzAXy66iFKTgGxLdqxyXTYTsuFzZpf5QMMv"],
  ["kamino-stacker",  "Adz82F1bUBi62kkDMG6KQhrYN6emf5tuj1KuTNqMAiBx"],
];

(async () => {
  const conn = new Connection(RPC, "confirmed");
  console.log(`Surfpool: ${RPC}`);
  console.log(`Top-up target: ${AMOUNT} USDC per agent\n`);
  for (const [sns, pk] of AGENTS) {
    try {
      const result = await ensureSurfpoolUsdc(conn, new PublicKey(pk), AMOUNT);
      const ui = (result.balanceBaseUnits / 1e6).toFixed(2);
      console.log(`  ✓ ${sns.padEnd(18)}  ${ui.padStart(10)} USDC  (${result.method})`);
    } catch (err) {
      console.log(`  ✗ ${sns.padEnd(18)}  failed: ${(err as Error).message}`);
    }
  }
})();
