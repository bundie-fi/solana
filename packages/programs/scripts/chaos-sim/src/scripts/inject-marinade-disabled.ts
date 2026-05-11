#!/usr/bin/env -S tsx
/**
 * inject-marinade-disabled.ts — one-shot migration that drops
 * "marinade" from the lst_stake / lst_unstake schema lines in every
 * existing agent's brain_md.
 *
 * Why: live audit on 2026-05-11 found that every Marinade Deposit ix
 * on the surfpool fork aborts with `UnregisteredMsolMinted` (Custom:
 * 6071, deposit.rs:110). The fork's mSOL mint.supply is ~36 mSOL
 * higher than Marinade State.msol_supply — almost certainly a
 * partial-persistence issue across a surfpool restart. Until the fork
 * is resynced, every lst_stake the brain emits with protocol=marinade
 * burns tokens on a guaranteed-fail tx (131 errors and counting in
 * agent_action_log, all UnregisteredMsolMinted).
 *
 * Pattern mirrors inject-rotation-rules.ts /
 * inject-market-cadence-rule.ts. Idempotent — gated on the absence of
 * "marinade" in the lst_stake line. Anchors on the EXACT lst_stake
 * schema line the template emits, so a brain_md that's already been
 * patched is a no-op.
 *
 * Usage (from the repo root):
 *   pnpm --filter @bundie/programs exec tsx \
 *     scripts/chaos-sim/src/scripts/inject-marinade-disabled.ts
 *
 * Env:
 *   DATABASE_URL  — required
 *   DRY_RUN=1     — optional; print plan only, no UPDATE
 */
import { config as loadDotEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dbQuery, getPool } from "../lib/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAOS_DIR = join(__dirname, "..", "..");
loadDotEnv({ path: join(CHAOS_DIR, ".env") });

// Source-of-truth strings emitted by generateBrainMd in
// packages/backend/src/lib/agent-templates.ts. The OLD pair includes
// "marinade"|"jito"; the NEW pair restricts to "jito". Keep these in
// sync with the template if either side changes.
const OLD_STAKE   = `    {"type": "lst_stake",     "protocol": "marinade"|"jito",            "args": {"amountSolUi": <number>}} |`;
const NEW_STAKE   = `    {"type": "lst_stake",     "protocol": "jito",                       "args": {"amountSolUi": <number>}} |`;
const OLD_UNSTAKE = `    {"type": "lst_unstake",   "protocol": "marinade"|"jito",            "args": {"amountMsolUi": <number>}} |`;
const NEW_UNSTAKE = `    {"type": "lst_unstake",   "protocol": "jito",                       "args": {"amountMsolUi": <number>}} |`;

interface AgentRow {
  sns: string;
  brain_md: string | null;
}

function inject(brainMd: string): { changed: boolean; next: string } {
  let next = brainMd;
  let changed = false;
  if (next.includes(OLD_STAKE)) {
    next = next.replace(OLD_STAKE, NEW_STAKE);
    changed = true;
  }
  if (next.includes(OLD_UNSTAKE)) {
    next = next.replace(OLD_UNSTAKE, NEW_UNSTAKE);
    changed = true;
  }
  return { changed, next };
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  if (!process.env.DATABASE_URL) {
    console.error(
      "[inject-marinade-disabled] DATABASE_URL is not set. " +
        "Add it to packages/programs/scripts/chaos-sim/.env or export before running.",
    );
    process.exit(1);
  }

  console.log("=== inject-marinade-disabled ===");
  console.log(`mode: ${dryRun ? "DRY-RUN (no UPDATE)" : "LIVE"}\n`);

  const r = await dbQuery<AgentRow>(
    `SELECT sns, brain_md FROM agents ORDER BY sns ASC`,
  );
  const rows = r?.rows ?? [];
  console.log(`agents: ${rows.length}\n`);

  let updated = 0;
  let already = 0;
  let noAnchor = 0;
  let nullBrain = 0;

  for (const row of rows) {
    if (!row.brain_md) {
      console.log(`[${row.sns}] brain_md is NULL — skipping`);
      nullBrain++;
      continue;
    }
    const result = inject(row.brain_md);
    if (!result.changed) {
      // Either already patched (jito-only) or the anchor strings have
      // drifted from the template. Use the NEW string as the "already
      // patched" sentinel — if it's present we're done.
      if (row.brain_md.includes(NEW_STAKE) || row.brain_md.includes(NEW_UNSTAKE)) {
        console.log(`[${row.sns}] already patched — no-op`);
        already++;
      } else {
        console.log(`[${row.sns}] ANCHOR not matched — skipping`);
        noAnchor++;
      }
      continue;
    }
    if (!dryRun) {
      await dbQuery(
        `UPDATE agents
            SET brain_md = $1,
                updated_at = NOW()
          WHERE sns = $2`,
        [result.next, row.sns],
      );
      console.log(`[${row.sns}] UPDATED`);
    } else {
      console.log(`[${row.sns}] DRY-RUN — would UPDATE`);
    }
    updated++;
  }

  console.log(
    `\n=== summary: ${updated} updated, ${already} already patched, ` +
      `${noAnchor} skipped (no anchor), ${nullBrain} null brain_md ===`,
  );

  await getPool()?.end();
}

main().catch((err) => {
  console.error(
    "[inject-marinade-disabled] fatal:",
    (err as Error).stack || err,
  );
  process.exit(1);
});
