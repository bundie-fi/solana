#!/usr/bin/env -S tsx
/**
 * chaos-sim entry — three subcommands:
 *   setup     generate (or load) the wallet pool and print pubkeys
 *   fund      transfer SOL + USDC from the deployer keypair to the pool
 *   run       execute the phased simulation and write logs
 *   doctor    check pool balances + RPC reachability without spending
 */
import { Connection } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { DEVNET_USDC_MINT, RPC_URL } from "./config.js";
import { fundPool } from "./funding.js";
import { runChaos } from "./orchestrator.js";
import { loadPool, printPool, setupPool } from "./wallets.js";

async function doctor(): Promise<void> {
  const conn = new Connection(RPC_URL, "confirmed");
  const pool = loadPool();
  const slot = await conn.getSlot();
  console.log(`RPC ${RPC_URL} slot=${slot} OK`);
  console.log("");
  console.log("ROLE        SOL       USDC      PUBKEY");
  console.log("-".repeat(80));
  let totalSol = 0;
  let totalUsdc = 0n;
  for (const w of pool) {
    const sol = await conn.getBalance(w.keypair.publicKey, "confirmed");
    const ata = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, w.keypair.publicKey);
    let usdc = 0n;
    try {
      usdc = (await getAccount(conn, ata, "confirmed")).amount;
    } catch {
      // no ATA yet
    }
    totalSol += sol;
    totalUsdc += usdc;
    console.log(
      `${w.role.padEnd(11)} ${(sol / 1e9).toFixed(4).padEnd(9)} ${(Number(usdc) / 1e6).toFixed(4).padEnd(9)} ${w.pubkeyB58}`,
    );
  }
  console.log("-".repeat(80));
  console.log(
    `${"TOTAL".padEnd(11)} ${(totalSol / 1e9).toFixed(4).padEnd(9)} ${(Number(totalUsdc) / 1e6).toFixed(4).padEnd(9)}`,
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "setup": {
      const pool = setupPool();
      printPool(pool);
      console.log(`\n${pool.length} keypairs persisted under packages/programs/scripts/chaos-sim/keys/`);
      console.log(`next: pnpm --filter @bundie/programs chaos:fund`);
      break;
    }
    case "fund": {
      const pool = loadPool();
      await fundPool(pool);
      break;
    }
    case "run": {
      const pool = loadPool();
      await runChaos(pool);
      break;
    }
    case "doctor": {
      await doctor();
      break;
    }
    default:
      console.error("usage: chaos-sim <setup|fund|run|doctor>");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
