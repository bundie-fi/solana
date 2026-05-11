#!/usr/bin/env -S tsx
/**
 * inject-rotation-rules.ts — one-shot migration that adds two
 * "rotate / close positions" directives into every existing agent's
 * brain_md.
 *
 * Why: a live audit of /api/agent/_global/surfpool-activity/recent
 * showed 160 lst_stake + 38 lend_deposit + 2 lst_unstake + 0
 * lend_withdraw rows in the most recent 200 actions. The executor logs
 * both open and close action types correctly — the asymmetry is in the
 * brain's decision distribution. The bootstrap brain prompts told it
 * what TO open but never WHEN to close, so existing agents accumulate
 * positions and never rotate. This migration backfills the same two
 * bullets that `generateBrainMd` now emits for fresh agents.
 *
 * Anchors on the static line "BEFORE proposing a lend_deposit, check
 * self.usdc..." which is present on every brain_md generated after the
 * v2-markets migration. Idempotent — gated on the new "ROTATE positions"
 * sentinel; re-running on a row that already has the rule is a no-op.
 *
 * Usage (from the repo root):
 *   pnpm --filter @bundie/programs exec tsx \
 *     scripts/chaos-sim/src/scripts/inject-rotation-rules.ts
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

// Mirror exactly the two lines emitted by generateBrainMd in
// packages/backend/src/lib/agent-templates.ts. Keep in sync if those
// lines change — backfilled and freshly-minted brain_md should be
// bit-identical so cache hashes line up.
const NEW_LINES = [
  `- ROTATE positions, don't accumulate. A yield strategy that only OPENS is not a strategy. Aim for roughly 1 close action (lend_withdraw or lst_unstake) per 2-3 open actions over each ~24h window. Close triggers: (a) another reserve / LST venue shows >100 bps better rate than your current position, (b) the rate on your current position has dropped >300 bps below where you opened it, or (c) the position has been open >50 history entries without reassessment. Predictors watch closes as a strong signal — closing decisively is itself information.`,
  `- DO NOT force a close in the first 5 history entries after opening (give the position time), or when your current position is still the best rate available across allowed protocols.`,
].join("\n");

const ANCHOR =
  /(^- BEFORE proposing a lend_deposit, check self\.usdc\. If it's near zero, your capital is already deployed — propose lend_withdraw or noop, NOT another deposit\. The platform no longer auto-refills USDC\.\n)/m;
const ALREADY_INJECTED_MARKER = "ROTATE positions, don't accumulate";

interface AgentRow {
  sns: string;
  brain_md: string | null;
}

function inject(brainMd: string): { changed: boolean; next: string } {
  if (brainMd.includes(ALREADY_INJECTED_MARKER)) {
    return { changed: false, next: brainMd };
  }
  if (!ANCHOR.test(brainMd)) {
    return { changed: false, next: brainMd };
  }
  const next = brainMd.replace(ANCHOR, `$1${NEW_LINES}\n`);
  return { changed: true, next };
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  if (!process.env.DATABASE_URL) {
    console.error(
      "[inject-rotation-rules] DATABASE_URL is not set. " +
        "Add it to packages/programs/scripts/chaos-sim/.env or export before running.",
    );
    process.exit(1);
  }

  console.log("=== inject-rotation-rules ===");
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
      if (row.brain_md.includes(ALREADY_INJECTED_MARKER)) {
        console.log(`[${row.sns}] already injected — no-op`);
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
    `\n=== summary: ${updated} updated, ${already} already injected, ` +
      `${noAnchor} skipped (no anchor), ${nullBrain} null brain_md ===`,
  );

  await getPool()?.end();
}

main().catch((err) => {
  console.error(
    "[inject-rotation-rules] fatal:",
    (err as Error).stack || err,
  );
  process.exit(1);
});
