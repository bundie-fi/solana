#!/usr/bin/env -S tsx
/**
 * chaos-sim entry — subcommands:
 *   setup           generate (or load) the wallet pool and print pubkeys
 *   fund            transfer SOL + USDC from the deployer keypair to the pool
 *   run             execute the phased simulation and write logs
 *   doctor          check pool balances + RPC reachability without spending
 *   register-names  one-shot: register each agent's `<name>.sol` on devnet
 *                   via Bonfida SNS (idempotent — skips already-registered
 *                   names). NEVER auto-runs — burns devnet SOL.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";

// DEVNET_USDC_MINT is still used by `doctor` for balance display, even
// though the SNS registration path no longer touches USDC.
import { DEVNET_USDC_MINT, RPC_URL } from "./config.js";
import { fundPool } from "./funding.js";
import { runChaos } from "./orchestrator.js";
import {
  getDomainForAgent,
  isNameRegistered,
  registerNameOnDevnet,
} from "./sns.js";
import { ChaosWallet, loadPool, printPool, setupPool } from "./wallets.js";

/** Pubkey accessor — ChaosWallet may or may not carry a Keypair (vault path
 *  has only `pubkeyB58`); we always have the b58 string regardless. */
function chaosPub(w: ChaosWallet): PublicKey {
  return new PublicKey(w.pubkeyB58);
}

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
    const sol = await conn.getBalance(chaosPub(w), "confirmed");
    const ata = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, chaosPub(w));
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

async function registerNames(): Promise<void> {
  // Explicit, opt-in. Spends devnet SOL (rent for a 1kB name account
  // ~0.011 SOL each + tx fee). Iterates the pool, skips names that are
  // already on-chain. Reports namePda + signature per agent.
  //
  // Uses the SPL Name Service `Create` ix directly — Bonfida's
  // `registerDomainName` requires a Pyth feed for the payment mint that
  // doesn't exist on devnet. No USDC needed; just rent + tx fee.
  const conn = new Connection(RPC_URL, "confirmed");
  const pool = loadPool();

  console.log(`SNS register-names — ${pool.length} agents`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(
    "NOTE: this writes to devnet. Each new registration costs ~0.011 SOL rent + fee (no USDC required).",
  );
  console.log("");
  console.log("ROLE         DOMAIN                 STATUS");
  console.log("-".repeat(80));

  for (const w of pool) {
    let domain: string;
    try {
      domain = getDomainForAgent(w.role);
    } catch (e) {
      console.log(
        `${w.role.padEnd(12)} -                      no-name-assigned  (${(e as Error).message})`,
      );
      continue;
    }

    // Idempotent: short-circuit when on-chain registry already exists.
    const bare = domain.replace(/\.sol$/i, "");
    const existingOwner = await isNameRegistered(conn, bare).catch(() => null);
    if (existingOwner) {
      const matches = existingOwner.equals(chaosPub(w));
      console.log(
        `${w.role.padEnd(12)} ${domain.padEnd(22)} already-registered  owner=${existingOwner.toBase58()}${
          matches ? " (matches)" : " (DOES NOT MATCH wallet — name was claimed by someone else)"
        }`,
      );
      continue;
    }

    try {
      const result = await registerNameOnDevnet(conn, w, domain);
      console.log(
        `${w.role.padEnd(12)} ${domain.padEnd(22)} REGISTERED          pda=${result.namePda} sig=${result.signature}`,
      );
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 200) ?? String(e);
      console.log(
        `${w.role.padEnd(12)} ${domain.padEnd(22)} FAILED              ${msg}`,
      );
    }

    // Polite pacing — devnet SNS is shared infra.
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("");
  console.log("done. Re-run safely; already-registered names are skipped.");
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "setup": {
      const pool = setupPool();
      printPool(pool);
      const vaultManaged = pool.filter((w) => w.signWith === "zerion-vault").length;
      const fileFallback = pool.filter((w) => w.signWith === "file").length;
      console.log(
        `\n${pool.length} agents — ${vaultManaged} vault-managed (Zerion / OWS), ${fileFallback} file-fallback`,
      );
      console.log(
        `Vault-managed agents live in ~/.ows/wallets/ (override via BUNDIE_AGENT_VAULT_PATH).`,
      );
      if (fileFallback > 0) {
        console.log(
          `${fileFallback} agents still use keys/<role>.json fallback. Run \`node packages/zerion-agent/src/cli.js chaos-sim-migrate\` to import them into the Zerion vault.`,
        );
      }
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
    case "register-names": {
      await registerNames();
      break;
    }
    default:
      console.error(
        "usage: chaos-sim <setup|fund|run|doctor|register-names>",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
