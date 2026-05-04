#!/usr/bin/env -S tsx
/**
 * inject-market-cadence-rule.ts — one-shot migration that adds a
 * "WHEN to open markets" directive + a paired "kind=2 needs two distinct
 * peer targets" rule into every existing agent's brain_md.
 *
 * Why: post-migration, only the `aggressive` preset's allocation block
 * said "Open prediction markets on peers when you spot meaningful
 * divergence". The bootstrap agents (yield-hunter, balanced, conservative,
 * perp-trader) had nothing telling them market creation was part of
 * their job, so they emitted only commit_nav / lend / lst actions and
 * never tried create_market. This migration injects the two new
 * framework-level rules from agent-templates.ts (added in the same
 * commit) into every agent so all 11 will start considering markets.
 *
 * Anchors on the v2 marker line "For create_market: use peers[].owner
 * as targetAgentA. You MUST NOT use your own vault." which is present
 * on every brain_md after the v2-markets migration. Idempotent — gated
 * on the new "WHEN to open markets" sentinel; re-running on a row that
 * already has the rule is a no-op.
 *
 * Usage (from the repo root):
 *   pnpm --filter @bundie/programs exec tsx \
 *     scripts/chaos-sim/src/scripts/inject-market-cadence-rule.ts
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

// Mirror exactly the two lines emitted by generateBrainMd at the same
// commit. Keep in sync if those lines change.
const NEW_LINES = [
  `- WHEN to open markets: at least once per 6h cooldown window, if you see ANY peer with a different NAV trajectory than yours (peer.sol differs from your self.sol by >5% either direction), open a kind=2 (Relative) market betting on whichever vault you think will outperform — yours or theirs. Markets are how the platform earns predictor flow, so each agent should open at least one market per cooldown period when the brain is forced to re-run.`,
  `- Pair the kind=2 head-to-head with the strongest divergence signal you observe. Pick targetAgentA + targetAgentB BOTH from peers[] (you are the creator, so neither target may be your own vault — insider guard). Otherwise use kind=1 (NavTarget) or kind=3 (Drawdown) against a single peer.`,
].join("\n");

const ANCHOR =
  /(^- For create_market: use peers\[\]\.owner as targetAgentA\. You MUST NOT use your own vault\.\n)/m;
const ALREADY_INJECTED_MARKER = "WHEN to open markets:";

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
      "[inject-market-cadence-rule] DATABASE_URL is not set. " +
        "Add it to packages/programs/scripts/chaos-sim/.env or export before running.",
    );
    process.exit(1);
  }

  console.log("=== inject-market-cadence-rule ===");
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
    "[inject-market-cadence-rule] fatal:",
    (err as Error).stack || err,
  );
  process.exit(1);
});
