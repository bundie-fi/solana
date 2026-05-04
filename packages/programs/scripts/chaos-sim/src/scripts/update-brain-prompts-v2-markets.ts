#!/usr/bin/env -S tsx
/**
 * update-brain-prompts-v2-markets.ts — one-shot data migration that swaps
 * the legacy `selector` / `spreadBps` / `seedAmountUsdc` create_market
 * schema in every existing agent's `brain_md` for the v2 NavTarget /
 * Relative / Drawdown schema.
 *
 * Why: agents.brain_md is generated once at agent-create time by
 * `backend/src/lib/agent-templates.ts → generateBrainMd` and persisted to
 * Postgres. The chaos-sim daemon reads that frozen blob every tick — so
 * fixing the generator (commit 4e3bb34) only helps NEW agents. Every
 * existing agent (alice/bob/charlie + the six bootstrap + every wizard
 * agent) keeps emitting the legacy schema, which the executor rejects
 * (kind=2 missing targetAgentB) or accepts with degenerate 1n
 * thresholds (kind=1/3). Result: zero new markets land on-chain.
 *
 * This script does surgical string replacements rather than re-rendering
 * the whole prompt — same pattern as `update-brain-prompts.ts`. That
 * keeps it independent of the backend package and idempotent.
 *
 * Replacements (each anchored on a unique substring from the legacy
 * generator):
 *
 *   1. Header:    "Available market kinds (Phase F …):" + 3 kind lines +
 *                 "Available rate surfaces (on-chain selectors for kind=3):" +
 *                 4 selector lines
 *      →         "Available market kinds (v2 NAV-based, …)" + 3 new kind lines
 *
 *   2. Rule:      "- spreadBps: for utilization (selector 1) use 300-1500…"
 *      →         deleted, replaced by 3 per-kind REQUIRES rules
 *
 *   3. Rule:      "- seedAmountUsdc: always between 1 and 5…"
 *      →         "- seedAmountBusd: …in bUSD."
 *
 *   4. Dedup:     "same targetAgentA + selector combination"
 *      →         "same targetAgentA + kind combination"
 *      And:      "near-identical markets (same subject, same rate surface, …)"
 *      →         "near-identical markets (same subject, same kind, …)"
 *
 *   5. JSON line: legacy `selector` / `spreadBps` / `seedAmountUsdc` schema
 *      →         new `targetAgentB?` / `thresholdLamports?` / `drawdownBps?`
 *                / `seedAmountBusd` schema
 *
 * Idempotent: re-running on an already-migrated row is a no-op (gated on
 * the presence of the unique marker `kind=1 (NavTarget) REQUIRES`).
 *
 * Usage (from the repo root):
 *   pnpm --filter @bundie/programs exec tsx \
 *     scripts/chaos-sim/src/scripts/update-brain-prompts-v2-markets.ts
 *
 * Env:
 *   DATABASE_URL  — required. Same connection string the daemon uses.
 *   DRY_RUN=1     — optional. Print before/after, do not UPDATE.
 *
 * Targets EVERY row in `agents` (status filter intentionally omitted —
 * paused/retired agents may be reactivated and their brain_md should
 * still be valid).
 */

import { config as loadDotEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dbQuery, getPool } from "../lib/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAOS_DIR = join(__dirname, "..", "..");

loadDotEnv({ path: join(CHAOS_DIR, ".env") });

// ─── Replacement payloads ──────────────────────────────────────────────────
//
// All multi-line strings exactly mirror the output of `generateBrainMd`
// in backend/src/lib/agent-templates.ts at commit 4e3bb34. Keep in sync
// if that template changes again.

const NEW_KINDS_BLOCK = [
  "Available market kinds (v2 NAV-based, resolved against on-chain BundieVault snapshots):",
  "  kind=1  NavTarget — predict whether targetAgentA's vault NAV reaches thresholdLamports (6dp bUSD base units, 1 bUSD = 1_000_000) by the resolution slot.",
  "  kind=2  Relative — predict whether targetAgentA's NAV growth beats targetAgentB's NAV growth between creation and the resolution slot. Both NAVs are snapshotted on-chain at create time.",
  "  kind=3  Drawdown — predict whether targetAgentA's vault NAV falls by drawdownBps (1-10000) below the creation-time snapshot before the resolution slot.",
].join("\n");

const NEW_KIND_RULES = [
  "- kind=1 (NavTarget) REQUIRES thresholdLamports (u64, > 0). Pick a target near the peer's current NAV — typically peer.lamports * (1.05 to 1.30) for an upside bet, or * (0.70 to 0.95) for a downside bet. 1 bUSD = 1_000_000 lamports.",
  "- kind=2 (Relative) REQUIRES targetAgentB (a SECOND peers[].owner, distinct from targetAgentA, distinct from your own vault). Omit thresholdLamports/drawdownBps.",
  "- kind=3 (Drawdown) REQUIRES drawdownBps (integer in [1, 10000]). 500 = 5% drawdown, 2000 = 20% drawdown.",
].join("\n");

const NEW_SEED_RULE =
  "- seedAmountBusd: always between 1 and 5. This seeds the market's initial liquidity in bUSD.";

const NEW_JSON_LINE =
  '    {"type": "create_market", "args": {"kind": <1|2|3>, "targetAgentA": "<vault_pubkey>", "targetAgentB"?: "<vault_pubkey, kind=2 only>", "thresholdLamports"?: <u64, kind=1 only>, "drawdownBps"?: <1..10000, kind=3 only>, "windowSlots": <number>, "questionTemplate": "<string max 128 chars>", "seedAmountBusd": <1..5>}}';

// ─── Anchors (regex; legacy strings only) ──────────────────────────────────
//
// Each regex matches a CONTIGUOUS legacy block. We replace with the new
// payload above. Anchors are deliberately broad enough to match small
// punctuation drift in the original generator (e.g. trailing period
// variations) without false positives — every anchor includes a unique
// legacy phrase (`Phase F`, `selector=`, `spreadBps:`, `seedAmountUsdc:`,
// `same targetAgentA + selector`, `selector":`).

// 1. Kinds header + selectors block (one big swap, deletes the
//    "Available rate surfaces" subsection entirely).
const LEGACY_KINDS_BLOCK = new RegExp(
  [
    "^Available market kinds \\(Phase F on-chain market kinds\\):\\n",
    "  kind=1[^\\n]*\\n",
    "  kind=2[^\\n]*\\n",
    "  kind=3[^\\n]*\\n",
    "\\n",
    "Available rate surfaces \\(on-chain selectors for kind=3\\):\\n",
    "  selector=1[^\\n]*\\n",
    "  selector=2[^\\n]*\\n",
    "  selector=4[^\\n]*\\n",
    "  selector=5[^\\n]*\\n",
  ].join(""),
  "m",
);

// 2. spreadBps rule line (single line).
const LEGACY_SPREAD_RULE =
  /^- spreadBps: for utilization \(selector 1\) use 300-1500; for LST rate \(selectors 2,4\) use 50-500\.\n/m;

// Marker that we add the per-kind REQUIRES rules immediately AFTER (the
// targetAgentA rule is preserved verbatim from both old + new prompts).
const TARGET_A_RULE_ANCHOR =
  /(^- For create_market: use peers\[\]\.owner as targetAgentA\. You MUST NOT use your own vault\.\n)/m;

// 3. seedAmountUsdc rule line.
const LEGACY_SEED_RULE =
  /^- seedAmountUsdc: always between 1 and 5\. This seeds the market's initial liquidity\.\n/m;

// 4. Dedup phrasing (two separate single-substring swaps).
const LEGACY_DEDUP_SELECTOR_PHRASE =
  /same targetAgentA \+ selector combination/g;
const LEGACY_DEDUP_RATE_SURFACE_PHRASE =
  /near-identical markets \(same subject, same rate surface, overlapping time windows\)\./g;

// 5. JSON schema line.
const LEGACY_JSON_LINE =
  /^    \{"type": "create_market", "args": \{"kind": <1\|2\|3>, "targetAgentA": "<vault_pubkey>", "selector": <1\|2\|4\|5>, "spreadBps": <u64>, "windowSlots": <u64>, "questionTemplate": "<string max 128 chars>", "seedAmountUsdc": <number>\}\}$/m;

// Idempotency marker — present in any v2-migrated brain_md, absent from
// legacy. Anchored on a phrase the generator emits exactly once.
const ALREADY_MIGRATED_MARKER = "kind=1 (NavTarget) REQUIRES thresholdLamports";

// ─── Migration ────────────────────────────────────────────────────────────

interface Replacement {
  name: string;
  ok: boolean;
}

function migrateBrainMd(brainMd: string): {
  changed: boolean;
  next: string;
  alreadyMigrated: boolean;
  replacements: Replacement[];
  unmatched: string[];
} {
  if (brainMd.includes(ALREADY_MIGRATED_MARKER)) {
    return {
      changed: false,
      next: brainMd,
      alreadyMigrated: true,
      replacements: [],
      unmatched: [],
    };
  }

  const replacements: Replacement[] = [];
  const unmatched: string[] = [];
  let next = brainMd;

  // 1. Kinds block + selectors (single big swap).
  if (LEGACY_KINDS_BLOCK.test(next)) {
    next = next.replace(LEGACY_KINDS_BLOCK, NEW_KINDS_BLOCK + "\n");
    replacements.push({ name: "kinds-block", ok: true });
  } else {
    unmatched.push("kinds-block (Phase F header + selectors)");
  }

  // 2. Drop legacy spreadBps rule.
  if (LEGACY_SPREAD_RULE.test(next)) {
    next = next.replace(LEGACY_SPREAD_RULE, "");
    replacements.push({ name: "spread-rule (deleted)", ok: true });
  } else {
    unmatched.push("spread-rule");
  }

  // Insert the new per-kind REQUIRES rules immediately after the
  // preserved "use peers[].owner as targetAgentA" rule.
  if (TARGET_A_RULE_ANCHOR.test(next)) {
    next = next.replace(TARGET_A_RULE_ANCHOR, `$1${NEW_KIND_RULES}\n`);
    replacements.push({ name: "kind-rules (inserted)", ok: true });
  } else {
    unmatched.push("targetA-anchor (couldn't position kind rules)");
  }

  // 3. seedAmountUsdc → seedAmountBusd.
  if (LEGACY_SEED_RULE.test(next)) {
    next = next.replace(LEGACY_SEED_RULE, NEW_SEED_RULE + "\n");
    replacements.push({ name: "seed-rule", ok: true });
  } else {
    unmatched.push("seed-rule");
  }

  // 4a. Dedup phrasing — selector → kind.
  if (LEGACY_DEDUP_SELECTOR_PHRASE.test(next)) {
    next = next.replace(
      LEGACY_DEDUP_SELECTOR_PHRASE,
      "same targetAgentA + kind combination",
    );
    replacements.push({ name: "dedup-selector-phrase", ok: true });
  } else {
    unmatched.push("dedup-selector-phrase");
  }

  // 4b. Dedup phrasing — rate surface → kind.
  if (LEGACY_DEDUP_RATE_SURFACE_PHRASE.test(next)) {
    next = next.replace(
      LEGACY_DEDUP_RATE_SURFACE_PHRASE,
      "near-identical markets (same subject, same kind, overlapping time windows).",
    );
    replacements.push({ name: "dedup-rate-surface-phrase", ok: true });
  } else {
    unmatched.push("dedup-rate-surface-phrase");
  }

  // 5. JSON schema line.
  if (LEGACY_JSON_LINE.test(next)) {
    next = next.replace(LEGACY_JSON_LINE, NEW_JSON_LINE);
    replacements.push({ name: "json-schema-line", ok: true });
  } else {
    unmatched.push("json-schema-line");
  }

  return {
    changed: next !== brainMd,
    next,
    alreadyMigrated: false,
    replacements,
    unmatched,
  };
}

interface AgentRow {
  sns: string;
  brain_md: string | null;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "1";

  if (!process.env.DATABASE_URL) {
    console.error(
      "[update-brain-prompts-v2-markets] DATABASE_URL is not set. " +
        "Add it to packages/programs/scripts/chaos-sim/.env or export before running.",
    );
    process.exit(1);
  }

  console.log("=== update-brain-prompts-v2-markets ===");
  console.log(`mode: ${dryRun ? "DRY-RUN (no UPDATE)" : "LIVE"}`);
  console.log("");

  const r = await dbQuery<AgentRow>(
    `SELECT sns, brain_md FROM agents ORDER BY sns ASC`,
  );
  const rows = r?.rows ?? [];
  console.log(`agents: ${rows.length}`);
  console.log("");

  let updated = 0;
  let alreadyMigrated = 0;
  let partialMatch = 0;
  let totalMiss = 0;
  let nullBrain = 0;

  for (const row of rows) {
    if (!row.brain_md) {
      console.log(`[${row.sns}] brain_md is NULL — skipping`);
      nullBrain++;
      continue;
    }

    const result = migrateBrainMd(row.brain_md);

    if (result.alreadyMigrated) {
      console.log(`[${row.sns}] already migrated — no-op`);
      alreadyMigrated++;
      continue;
    }

    if (!result.changed) {
      console.log(
        `[${row.sns}] no anchor matched (legacy markers absent) — skipping`,
      );
      totalMiss++;
      continue;
    }

    const matchedNames = result.replacements.map((r) => r.name).join(", ");
    if (result.unmatched.length > 0) {
      console.log(
        `[${row.sns}] PARTIAL match — applied: [${matchedNames}], ` +
          `MISSED: [${result.unmatched.join(", ")}]`,
      );
      partialMatch++;
      // Still apply the partial — the legacy markers we did hit are
      // strictly worse than the new ones we're swapping in.
    } else {
      console.log(`[${row.sns}] full match — applied: [${matchedNames}]`);
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

  console.log("");
  console.log(
    `=== summary: ${updated} updated, ${alreadyMigrated} already migrated, ` +
      `${partialMatch} partial-match (still updated), ${totalMiss} no-match (skipped), ` +
      `${nullBrain} null brain_md ===`,
  );

  await getPool()?.end();
}

main().catch((err) => {
  console.error(
    "[update-brain-prompts-v2-markets] fatal:",
    (err as Error).stack || err,
  );
  process.exit(1);
});
