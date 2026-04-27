#!/usr/bin/env -S tsx
/**
 * update-brain-prompts.ts — one-shot data migration that surfaces the
 * agent's surfpool USDC + mSOL balances to the brain.
 *
 * Why: chaos-sim seeds 1000 USDC into each agent's surfpool ATA every tick
 * and Marinade stakes land mSOL into a separate ATA, but the brain prompt
 * currently only describes `self.sol`. Result: the LLM reasons "no USDC,
 * can't lend" and noops forever. shared-tick.ts now exposes `self.usdc` /
 * `self.msol` in STATE_JSON; this script teaches the existing alice / bob /
 * charlie brain prompts about those new fields so the model uses them.
 *
 * Behaviour:
 *   - Connects to DATABASE_URL (the same Postgres the daemon polls).
 *   - For each of the three demo agents, fetches their current `brain_md`.
 *   - Inserts two new schema lines after the existing `self.sol` line.
 *   - Idempotent: re-running on an already-updated row is a no-op (the
 *     regex matches `self.usdc` and bails).
 *   - Logs a unified diff-ish "before/after" so the operator can confirm
 *     the change before re-deploying the daemon.
 *
 * Usage (from the repo root):
 *   pnpm --filter @bundie/programs exec tsx \
 *     scripts/chaos-sim/src/scripts/update-brain-prompts.ts
 *
 * (No npm-script alias added — package.json is untouched per the migration
 * spec. Use the `exec tsx` form above; same path the daemon uses to load
 * other scripts in this dir.)
 *
 * Env:
 *   DATABASE_URL  — required. Same connection string the daemon uses.
 *   DRY_RUN=1     — optional. Print before/after, do not UPDATE.
 *
 * NOTE: This script is intentionally NOT invoked by the build pipeline.
 * The user runs it manually against the production DB.
 */

import { config as loadDotEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dbQuery, getPool } from "../lib/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAOS_DIR = join(__dirname, "..", "..");

// Load chaos-sim .env so the operator can run this exactly the same way as
// the daemon (same DATABASE_URL resolution path).
loadDotEnv({ path: join(CHAOS_DIR, ".env") });

/** Demo agents whose brain.md we know is structurally identical. */
const TARGET_SNS = [
  "alice.bundie.sol",
  "bob.bundie.sol",
  "charlie.bundie.sol",
];

const NEW_LINES = [
  "  self.usdc                       — your surfpool USDC balance (auto-seeded each tick).",
  "  self.msol                       — your surfpool mSOL balance from prior Marinade stakes.",
].join("\n");

/**
 * Insert NEW_LINES immediately after the trailing `self.sol` block (which
 * spans two lines in the canonical brain.md — `self.sol` itself and an
 * indented continuation). We anchor on the second line of the block so a
 * one-line variant of the prompt is also handled.
 *
 * Idempotent: if `self.usdc` already appears in the prompt, return the
 * input verbatim.
 */
function insertSchemaLines(brainMd: string): { changed: boolean; next: string } {
  if (brainMd.includes("self.usdc")) {
    return { changed: false, next: brainMd };
  }

  // Canonical shape (alice/bob/charlie):
  //   self.sol                        — your surfpool SOL balance (fee-payer +
  //                                     collateral source for strategy txs).
  //   self.lamports                   — same in lamports.
  //
  // Insert NEW_LINES after the closing of the self.sol block. We anchor on
  // the line ending in `strategy txs).` because that's the unique marker.
  const anchorRegex = /([ \t]*collateral source for strategy txs\)\.)\n/;
  if (anchorRegex.test(brainMd)) {
    const next = brainMd.replace(anchorRegex, `$1\n${NEW_LINES}\n`);
    return { changed: true, next };
  }

  // Fallback anchor: insert directly after a bare `self.sol …` line.
  // Matches indented `self.sol` (with any trailing description) ending in `\n`.
  const fallbackRegex = /^([ \t]+self\.sol\b[^\n]*)\n/m;
  if (fallbackRegex.test(brainMd)) {
    const next = brainMd.replace(fallbackRegex, `$1\n${NEW_LINES}\n`);
    return { changed: true, next };
  }

  // No anchor matched — caller logs and skips.
  return { changed: false, next: brainMd };
}

interface AgentRow {
  sns: string;
  brain_md: string | null;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";

  if (!process.env.DATABASE_URL) {
    console.error(
      "[update-brain-prompts] DATABASE_URL is not set. " +
        "Add it to packages/programs/scripts/chaos-sim/.env or export it before running.",
    );
    process.exit(1);
  }

  console.log("=== update-brain-prompts ===");
  console.log(`mode:     ${dryRun ? "DRY-RUN (no UPDATE)" : "LIVE"}`);
  console.log(`agents:   ${TARGET_SNS.join(", ")}`);
  console.log("");

  let updated = 0;
  let skippedAlready = 0;
  let skippedNoAnchor = 0;
  let missing = 0;

  for (const sns of TARGET_SNS) {
    const r = await dbQuery<AgentRow>(
      `SELECT sns, brain_md FROM agents WHERE sns = $1 LIMIT 1`,
      [sns],
    );
    const row = r?.rows[0];
    if (!row || !row.brain_md) {
      console.log(`[${sns}] NOT FOUND in agents table — skipping`);
      missing++;
      continue;
    }

    const before = row.brain_md;
    const { changed, next } = insertSchemaLines(before);

    if (!changed) {
      if (before.includes("self.usdc")) {
        console.log(`[${sns}] already up-to-date (self.usdc present) — no-op`);
        skippedAlready++;
      } else {
        console.log(
          `[${sns}] no anchor line matched (no \`self.sol\`) — manual review required`,
        );
        skippedNoAnchor++;
      }
      continue;
    }

    // Print a localised diff: the 8 lines bracketing the insertion point.
    const idx = next.indexOf(NEW_LINES);
    const window = next.slice(Math.max(0, idx - 200), idx + NEW_LINES.length + 200);
    console.log(`[${sns}] BEFORE → AFTER (insertion window):`);
    console.log("  --- inserted block ---");
    console.log(
      window
        .split("\n")
        .map((l) => `  | ${l}`)
        .join("\n"),
    );
    console.log("");

    if (!dryRun) {
      await dbQuery(
        `UPDATE agents
            SET brain_md = $1,
                updated_at = NOW()
          WHERE sns = $2`,
        [next, sns],
      );
      console.log(`[${sns}] UPDATED in agents table (+${NEW_LINES.length} chars)`);
    } else {
      console.log(`[${sns}] DRY-RUN — would UPDATE (${NEW_LINES.length} chars)`);
    }
    updated++;
  }

  console.log("");
  console.log(
    `=== summary: ${updated} updated, ${skippedAlready} already up-to-date, ` +
      `${skippedNoAnchor} skipped (no anchor), ${missing} missing ===`,
  );

  await getPool()?.end();
}

main().catch((err) => {
  console.error("[update-brain-prompts] fatal:", (err as Error).stack || err);
  process.exit(1);
});
