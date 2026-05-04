#!/usr/bin/env -S tsx
/**
 * harden-no-self-target.ts — migration that strengthens the "don't use
 * own pubkey as create_market target" guard in every agent's brain_md.
 *
 * Why: the post-cadence-injection daemon was producing
 * `create_market_error: targetAgentA must not equal creator (insider
 * guard)` rows in agent_action_log — the LLM was hallucinating its
 * own pubkey from history / peer characters because the prompt never
 * surfaced self.pubkey by name. Two fixes:
 *
 *   A. Add a `self.pubkey` field description to the "State fields
 *      explained" block (right after the self.sol line) so the LLM
 *      sees the value as a NAMED, READ-ONLY field.
 *
 *   B. Replace the legacy "For create_market: use peers[].owner as
 *      targetAgentA. You MUST NOT use your own vault." line with a
 *      strengthened version that:
 *        - Mentions targetAgentB explicitly (kind=2)
 *        - Names self.pubkey by name as the thing to avoid
 *
 * Idempotent: gated on the new "self.pubkey" line and the new
 * "self.pubkey — the on-chain insider guard" wording. Re-running on
 * an already-migrated row is a no-op.
 *
 * Usage:
 *   pnpm --filter @bundie/programs exec tsx \
 *     scripts/chaos-sim/src/scripts/harden-no-self-target.ts
 *
 * Env: DATABASE_URL (required), DRY_RUN=1 (optional).
 */
import { config as loadDotEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dbQuery, getPool } from "../lib/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAOS_DIR = join(__dirname, "..", "..");
loadDotEnv({ path: join(CHAOS_DIR, ".env") });

// ─── Patch A: insert self.pubkey line after self.sol line ──────────────────

const NEW_SELF_PUBKEY_LINE =
  `  self.pubkey                     — YOUR vault pubkey. Read-only — never use as a target in create_market (insider guard rejects it).`;

// Anchor on the canonical self.sol description. Insert the new line
// IMMEDIATELY BEFORE it (so self.pubkey appears at the top of the self.*
// block — first thing the LLM reads about itself).
const SELF_SOL_ANCHOR =
  /^(  self\.sol +— your devnet SOL balance \(fee-payer; execution chain\)\.\n)/m;

// ─── Patch B: replace the legacy create_market target rule ─────────────────

const LEGACY_TARGET_RULE =
  /^- For create_market: use peers\[\]\.owner as targetAgentA\. You MUST NOT use your own vault\.\n/m;

const NEW_TARGET_RULE =
  `- For create_market: use peers[].owner as targetAgentA (and targetAgentB for kind=2). You MUST NOT use self.pubkey — the on-chain insider guard will reject the tx. Pick from peers[] only.\n`;

// ─── Idempotency markers ───────────────────────────────────────────────────

const SELF_PUBKEY_MARKER = "self.pubkey                     — YOUR vault pubkey";
const NEW_TARGET_MARKER = "You MUST NOT use self.pubkey";

interface PatchResult {
  changed: boolean;
  next: string;
  patches: string[];
}

function applyPatches(brainMd: string): PatchResult {
  let next = brainMd;
  const patches: string[] = [];

  // Patch A — insert self.pubkey line
  if (next.includes(SELF_PUBKEY_MARKER)) {
    patches.push("self-pubkey-line: already present");
  } else if (SELF_SOL_ANCHOR.test(next)) {
    next = next.replace(SELF_SOL_ANCHOR, `${NEW_SELF_PUBKEY_LINE}\n$1`);
    patches.push("self-pubkey-line: inserted");
  } else {
    patches.push("self-pubkey-line: ANCHOR not matched");
  }

  // Patch B — replace target rule
  if (next.includes(NEW_TARGET_MARKER)) {
    patches.push("target-rule: already strengthened");
  } else if (LEGACY_TARGET_RULE.test(next)) {
    next = next.replace(LEGACY_TARGET_RULE, NEW_TARGET_RULE);
    patches.push("target-rule: replaced");
  } else {
    patches.push("target-rule: legacy variant not matched");
  }

  return { changed: next !== brainMd, next, patches };
}

interface AgentRow {
  sns: string;
  brain_md: string | null;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";
  if (!process.env.DATABASE_URL) {
    console.error(
      "[harden-no-self-target] DATABASE_URL is not set.",
    );
    process.exit(1);
  }

  console.log("=== harden-no-self-target ===");
  console.log(`mode: ${dryRun ? "DRY-RUN" : "LIVE"}\n`);

  const r = await dbQuery<AgentRow>(
    `SELECT sns, brain_md FROM agents ORDER BY sns ASC`,
  );
  const rows = r?.rows ?? [];
  console.log(`agents: ${rows.length}\n`);

  let updated = 0, noChange = 0, nullBrain = 0;

  for (const row of rows) {
    if (!row.brain_md) {
      console.log(`[${row.sns}] brain_md is NULL — skipping`);
      nullBrain++;
      continue;
    }
    const result = applyPatches(row.brain_md);
    console.log(`[${row.sns}] ${result.patches.join(" | ")}`);
    if (!result.changed) {
      noChange++;
      continue;
    }
    if (!dryRun) {
      await dbQuery(
        `UPDATE agents SET brain_md = $1, updated_at = NOW() WHERE sns = $2`,
        [result.next, row.sns],
      );
    }
    updated++;
  }

  console.log(
    `\n=== summary: ${updated} updated, ${noChange} no-change, ${nullBrain} null brain_md ===`,
  );

  await getPool()?.end();
}

main().catch((err) => {
  console.error(
    "[harden-no-self-target] fatal:",
    (err as Error).stack || err,
  );
  process.exit(1);
});
