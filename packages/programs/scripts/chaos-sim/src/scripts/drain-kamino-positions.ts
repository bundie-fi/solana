#!/usr/bin/env -S tsx
/**
 * drain-kamino-positions.ts — one-shot maintenance script that closes
 * every active agent's vanilla Kamino obligation on the surfpool fork.
 *
 * Why: agents currently hold $3.6K of vanilla USDC deposits sourced from
 * a manual `seed-empty-agents.ts` $1000-per-agent top-up done after a
 * surfpool wipe. That capital inflates the platform TVL line above
 * what a fresh agent should be carrying. Step 1 of normalization is to
 * pull those positions back to the agent's USDC ATA. Step 2 (cheat-set
 * the ATA back to the standard $100 seed via `surfnet_setTokenAccount`)
 * is intentionally separate and not run by this script — keeping the
 * destructive "burn synthetic USDC" step a deliberate operator action.
 *
 * Behavior:
 *   - For every status='active' agent with a non-empty vanilla obligation
 *     on the Kamino main USDC reserve, submits one `withdrawKamino` call
 *     that passes a large UI amount; the SDK clamps to the obligation's
 *     actual collateral and flattens the position.
 *   - Agents whose obligation is missing or already drained are skipped.
 *   - On per-agent failure (RPC blip, simulation revert, …), logs and
 *     continues to the next agent.
 *
 * Usage:
 *   pnpm --filter @bundie/programs chaos:drain-kamino
 *   DRY_RUN=1   pnpm --filter @bundie/programs chaos:drain-kamino
 *   AGENT=stable-arber pnpm --filter @bundie/programs chaos:drain-kamino
 *
 * Env:
 *   DATABASE_URL       — required.
 *   SURFPOOL_RPC_URL   — required (or MAINNET_RPC_URL as fallback).
 *   DRY_RUN=1          — plan only, no tx submission.
 *   AGENT=<sns>        — limit to a single agent (matches WHERE sns = $1).
 *
 * Side note: the chaos-sim daemon may re-deposit shortly after this
 * script runs — the brain doesn't know an external withdraw just
 * happened, it just sees a fatter USDC ATA. That re-deposit will be
 * smaller (sized off whatever the brain's strategy allocation says, not
 * the historical $1000 over-mint) so TVL still trends toward sanity.
 * Pausing the daemon for the duration of step 1 + step 2 is the cleanest
 * path if you want a deterministic before/after.
 */
import { config as loadDotEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Obligation } from "@kamino-finance/klend-sdk";

import { dbQuery, getPool } from "../lib/db.js";
import { withdrawKamino } from "../lib/kamino-execute.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAOS_DIR = join(__dirname, "..", "..");
loadDotEnv({ path: join(CHAOS_DIR, ".env") });

const KAMINO_MAIN_MARKET = new PublicKey(
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
);
const KLEND_PROGRAM = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
);

/** Q60.60 scaled-fraction divisor for klend marketValueSf. */
const SF_SCALE = 1n << 60n;
const ZERO_PUBKEY = "11111111111111111111111111111111";

/**
 * UI amount handed to the SDK as "withdraw this much". The SDK clamps
 * to whatever the obligation actually holds, so passing a number above
 * every plausible position is the canonical "flatten" idiom. Kamino
 * main USDC reserve has ~$7.7M available liquidity (per the probe), so
 * 1M USDC clears any individual obligation without bumping up against
 * reserve-level limits.
 */
const FLATTEN_AMOUNT_UI = 1_000_000;

function vanillaObligationPda(market: PublicKey, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([0]), // tag
      Buffer.from([0]), // id
      user.toBuffer(),
      market.toBuffer(),
      PublicKey.default.toBuffer(),
      PublicKey.default.toBuffer(),
    ],
    KLEND_PROGRAM,
  );
  return pda;
}

function sfToUsd(sf: { toString(): string }): number {
  const raw = BigInt(sf.toString());
  // Scale to micro-USD first so sub-cent precision survives the BigInt → Number boundary.
  const micro = (raw * 1_000_000n) / SF_SCALE;
  return Number(micro) / 1_000_000;
}

interface AgentRow {
  sns: string;
  agent_pubkey: string;
  agent_secret_key: string | null;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  const filterSns = process.env.AGENT?.trim() || undefined;

  const surfpoolUrl =
    process.env.SURFPOOL_RPC_URL ?? process.env.MAINNET_RPC_URL;
  if (!surfpoolUrl) {
    console.error(
      "FATAL: set SURFPOOL_RPC_URL (or MAINNET_RPC_URL) to the fork RPC the daemon uses.",
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("FATAL: DATABASE_URL not set.");
    process.exit(1);
  }

  const conn = new Connection(surfpoolUrl, "confirmed");

  console.log(`=== drain-kamino-positions ${dryRun ? "(DRY-RUN)" : "(LIVE)"} ===`);
  console.log(
    `surfpool: ${surfpoolUrl.replace(/api_key=[^&]+/g, "api_key=<redacted>")}\n`,
  );

  const params: unknown[] = [];
  let snsFilter = "";
  if (filterSns) {
    params.push(filterSns);
    snsFilter = `AND sns = $${params.length}`;
  }
  const r = await dbQuery<AgentRow>(
    `SELECT sns, agent_pubkey, agent_secret_key
       FROM agents
      WHERE status = 'active'
        AND agent_secret_key IS NOT NULL
        ${snsFilter}
      ORDER BY sns ASC`,
    params,
  );
  const agents = r?.rows ?? [];
  if (agents.length === 0) {
    console.log("no agents matched the filter — nothing to drain.");
    await getPool()?.end();
    return;
  }
  console.log(`agents: ${agents.length}\n`);

  let drained = 0;
  let empty = 0;
  let failed = 0;

  for (const row of agents) {
    if (!row.agent_secret_key) {
      // Filtered in SQL, but guard anyway.
      console.log(`[${row.sns}] no secret key — skipping`);
      continue;
    }
    const authority = new PublicKey(row.agent_pubkey);
    const oblPda = vanillaObligationPda(KAMINO_MAIN_MARKET, authority);

    let info;
    try {
      info = await conn.getAccountInfo(oblPda, "confirmed");
    } catch (e) {
      console.log(
        `[${row.sns}] RPC error fetching obligation: ${(e as Error).message}`,
      );
      failed++;
      continue;
    }
    if (!info) {
      console.log(`[${row.sns}] no obligation — skipping`);
      empty++;
      continue;
    }

    let depositUsd = 0;
    try {
      const obl = Obligation.decode(info.data);
      for (const d of obl.deposits) {
        if (String(d.depositReserve) === ZERO_PUBKEY) continue;
        if (d.depositedAmount.isZero()) continue;
        depositUsd += sfToUsd(d.marketValueSf);
      }
    } catch (e) {
      console.log(
        `[${row.sns}] obligation decode failed: ${(e as Error).message}`,
      );
      failed++;
      continue;
    }
    if (depositUsd < 0.01) {
      console.log(
        `[${row.sns}] obligation empty (deposits=$${depositUsd.toFixed(2)}) — skipping`,
      );
      empty++;
      continue;
    }

    console.log(
      `[${row.sns}] deposits=$${depositUsd.toFixed(2)}  flattening (UI=${FLATTEN_AMOUNT_UI}, SDK clamps)…`,
    );
    if (dryRun) {
      console.log(`  DRY-RUN — would submit withdrawKamino`);
      drained++;
      continue;
    }

    let kp: Keypair;
    try {
      const sk = JSON.parse(row.agent_secret_key);
      kp = Keypair.fromSecretKey(new Uint8Array(sk));
    } catch (e) {
      console.log(
        `[${row.sns}] failed to parse agent_secret_key: ${(e as Error).message}`,
      );
      failed++;
      continue;
    }

    try {
      const result = await withdrawKamino({
        surfpool: conn,
        vault: kp,
        amountUsdcUi: FLATTEN_AMOUNT_UI,
      });
      console.log(
        `  ✓ tx=${result.txSig.slice(0, 24)}…  amountBaseUnits=${result.amountBaseUnits}`,
      );
      drained++;
    } catch (e) {
      console.log(
        `  ✗ withdraw failed: ${(e as Error).message.slice(0, 200)}`,
      );
      failed++;
    }
  }

  console.log(
    `\n=== summary: ${drained} drained${dryRun ? " (dry-run)" : ""}, ${empty} empty/no-obligation, ${failed} failed ===`,
  );
  await getPool()?.end();
}

main().catch((err) => {
  console.error("[drain-kamino-positions] fatal:", err);
  process.exit(1);
});
