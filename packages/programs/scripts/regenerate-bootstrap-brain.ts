#!/usr/bin/env -S tsx
/**
 * regenerate-bootstrap-brain.ts — re-run generateBrainMd against the
 * STRATEGIES map and overwrite the `brain_md` column for each existing
 * bootstrap agent.
 *
 * Why: the brain.md template now embeds a sentinel
 * (`===LIVE_INPUTS_BELOW...===`) that the chaos-sim's redpill-brain.ts
 * splits on to apply Anthropic prompt caching. Bootstrap agents created
 * before that change have the OLD layout in their `brain_md` row and
 * thus fall through to the non-cached legacy path. Running this once
 * after the backend deploys with the new generateBrainMd brings every
 * bootstrap agent onto the cached path, dropping per-tick input cost
 * by ~70-80% on cached calls.
 *
 * Default dry-run (prints byte deltas only); pass `--confirm` to apply.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/programs/scripts/regenerate-bootstrap-brain.ts
 *   DATABASE_URL=... tsx packages/programs/scripts/regenerate-bootstrap-brain.ts --confirm
 */
import { Pool } from "pg";

import { generateBrainMd } from "../../backend/src/lib/agent-templates";
import { STRATEGIES } from "./seed-bootstrap-agents";

interface CliArgs {
  confirm: boolean;
}

function parseArgs(): CliArgs {
  return {
    confirm: process.argv.includes("--confirm"),
  };
}

async function main(): Promise<void> {
  const cli = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: url,
    ssl: url.includes("railway.internal")
      ? false
      : { rejectUnauthorized: false },
  });

  try {
    const target = await pool.query<{
      sns: string;
      brain_md: string;
      preset: string;
    }>(
      `SELECT sns, brain_md, preset FROM agents
        WHERE sns = ANY($1::text[])
        ORDER BY sns`,
      [Object.keys(STRATEGIES)],
    );

    if (target.rows.length === 0) {
      console.log("No bootstrap agents found in DB. Nothing to regenerate.");
      return;
    }

    let regenCount = 0;
    let unchangedCount = 0;
    for (const row of target.rows) {
      const spec = STRATEGIES[row.sns];
      if (!spec) continue;
      const newBrain = generateBrainMd({
        preset: spec.preset,
        displayName: spec.displayName,
        allowedProtocols: spec.allowedProtocols,
        customAddition: spec.strategyParagraph,
      });

      if (newBrain === row.brain_md) {
        console.log(
          `  ${row.sns.padEnd(20)} unchanged (${row.brain_md.length}B)`,
        );
        unchangedCount += 1;
        continue;
      }

      console.log(
        `  ${row.sns.padEnd(20)} ${row.brain_md.length}B → ${newBrain.length}B ` +
          `(Δ ${newBrain.length - row.brain_md.length > 0 ? "+" : ""}${newBrain.length - row.brain_md.length})`,
      );

      if (cli.confirm) {
        await pool.query(
          `UPDATE agents SET brain_md = $1 WHERE sns = $2`,
          [newBrain, row.sns],
        );
        regenCount += 1;
      }
    }

    console.log("");
    if (cli.confirm) {
      console.log(
        `Regenerated ${regenCount} agent(s). Unchanged: ${unchangedCount}.`,
      );
    } else {
      console.log(
        `Dry-run complete. ${target.rows.length - unchangedCount} agent(s) would be updated. ` +
          `Re-run with --confirm to apply.`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[regenerate-bootstrap-brain] fatal:", err);
  process.exit(1);
});
