/**
 * agents-source.ts — Postgres-backed agent registry for the chaos-sim daemon.
 *
 * Phase N replaces the hardcoded alice/bob/charlie list with a poll against
 * the `agents` table (status='active'). Per-agent brain.md and policies.yaml
 * are written to a temp dir so the existing Zerion CLI / shared-tick code
 * can keep reading them via filesystem paths (no signature changes).
 *
 * Per-tick action logging writes to `agent_action_log` so the agent profile
 * UI can show recent activity without parsing the on-chain history.
 *
 * If DATABASE_URL is missing, this module returns empty results and logs a
 * warning — the daemon is expected to fall back to the legacy hardcoded list
 * in that case (dev/local workflow).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { dbQuery, getPool } from "./db.js";

// Same CHAOS_DIR layout the daemon uses to look up keypairs:
// `<chaos-sim-pkg>/keys/<short>-vault.json`. We mirror this here so the
// supervisor's existsSync(keyPath) check finds the file we just hydrated.
const __dirname_es = dirname(fileURLToPath(import.meta.url));
const CHAOS_KEYS_DIR = join(__dirname_es, "..", "..", "keys");

export interface ActiveAgent {
  sns: string;
  agentPubkey: string;
  vaultPda: string;
  ownerWallet: string;
  brainMd: string;
  policiesYaml: string;
  /** Path to a temp policies.yaml file the Zerion CLI can read via --policies. */
  policiesPath: string;
  /** Path to a temp brain.md file. */
  brainMdPath: string;
}

const TEMP_ROOT = join(tmpdir(), "bundie-agents");

interface AgentRow {
  sns: string;
  agent_pubkey: string;
  vault_pda: string;
  owner_wallet: string;
  brain_md: string | null;
  policies_yaml: string | null;
  agent_secret_key: string | null;
}

/**
 * Loads all currently-active agents from Postgres.
 * Writes per-agent brain.md + policies.yaml to a temp dir so Zerion CLI can
 * read them via existing `--policies <path>` / file-read code paths.
 */
export async function loadActiveAgents(): Promise<ActiveAgent[]> {
  if (!getPool()) {
    console.warn("[agents-source] no DATABASE_URL, returning empty list");
    return [];
  }

  let rows: AgentRow[];
  try {
    const r = await dbQuery<AgentRow>(
      `SELECT sns, agent_pubkey, vault_pda, owner_wallet, brain_md, policies_yaml,
              agent_secret_key
         FROM agents
         WHERE status = $1`,
      ["active"],
    );
    rows = r?.rows ?? [];
  } catch (err) {
    console.error("[agents-source] query failed:", (err as Error).message);
    return [];
  }

  return rows.flatMap((r): ActiveAgent[] => {
    if (!r.brain_md || !r.policies_yaml) {
      console.warn(
        `[agents-source] skipping ${r.sns}: missing brain_md or policies_yaml`,
      );
      logAgentAction({
        agentSns: r.sns,
        actionType: "skipped_corrupt_row",
        reasoning: "missing brain_md or policies_yaml in agents row",
      }).catch(() => {});
      return [];
    }
    const dir = join(TEMP_ROOT, r.sns);
    mkdirSync(dir, { recursive: true });
    const brainMdPath = join(dir, "brain.md");
    const policiesPath = join(dir, "policies.yaml");
    writeFileSync(brainMdPath, r.brain_md);
    writeFileSync(policiesPath, r.policies_yaml);

    // Hydrate the keypair file at the path the daemon's
    // resolveSupabaseAgent() looks at. Hardcoded alice/bob/charlie
    // already have these committed; wizard-created agents land their
    // bytes in agent_secret_key, and we materialize the file here so
    // the existing existsSync(keyPath) gate passes.
    if (r.agent_secret_key) {
      const shortName = r.sns.split(".")[0];
      const keyPath = join(CHAOS_KEYS_DIR, `${shortName}-vault.json`);
      if (!existsSync(keyPath)) {
        try {
          mkdirSync(CHAOS_KEYS_DIR, { recursive: true });
          writeFileSync(keyPath, r.agent_secret_key);
          console.log(
            `[agents-source] hydrated keypair for ${r.sns} → ${keyPath}`,
          );
        } catch (err) {
          console.warn(
            `[agents-source] failed to hydrate keypair for ${r.sns}: ${(err as Error).message}`,
          );
        }
      }
    }

    return [
      {
        sns: r.sns,
        agentPubkey: r.agent_pubkey,
        vaultPda: r.vault_pda,
        ownerWallet: r.owner_wallet,
        brainMd: r.brain_md,
        policiesYaml: r.policies_yaml,
        policiesPath,
        brainMdPath,
      },
    ];
  });
}

/**
 * Logs a tick action to agent_action_log for the agent profile to display.
 * No-op if DATABASE_URL is missing (so local dev keeps working).
 */
export async function logAgentAction(opts: {
  agentSns: string;
  actionType: string;
  reasoning?: string | null;
  resultJson?: unknown;
}): Promise<void> {
  if (!getPool()) return;
  try {
    await dbQuery(
      `INSERT INTO agent_action_log (agent_sns, action_type, reasoning, result_json)
       VALUES ($1, $2, $3, $4)`,
      [
        opts.agentSns,
        opts.actionType,
        opts.reasoning ?? null,
        opts.resultJson != null ? JSON.stringify(opts.resultJson) : null,
      ],
    );
  } catch (err) {
    console.error("[agents-source] log insert failed:", (err as Error).message);
  }
}

/**
 * Throttled audit-log for skipped agents (missing keypair, pubkey mismatch,
 * corrupt row, etc.). Inserts a row into agent_action_log only if the most
 * recent matching skipped_* entry for this agent is older than `windowMs`
 * (default 1h). Cheap query — no in-memory cache, so it survives daemon
 * restarts. Failures are swallowed so the supervisor never crashes on log I/O.
 */
export async function logSkippedAgent(opts: {
  agentSns: string;
  actionType: string; // e.g. "skipped_no_keypair", "skipped_pubkey_mismatch", "skipped_corrupt_row"
  reasoning: string;
  windowMs?: number;
}): Promise<void> {
  if (!getPool()) return;
  const windowMs = opts.windowMs ?? 60 * 60_000;
  try {
    const r = await dbQuery<{ created_at: string; tick_at: string }>(
      `SELECT tick_at AS created_at
         FROM agent_action_log
         WHERE agent_sns = $1
           AND action_type LIKE 'skipped_%'
         ORDER BY tick_at DESC
         LIMIT 1`,
      [opts.agentSns],
    );
    if (r && r.rows.length > 0) {
      const last = new Date(r.rows[0].created_at).getTime();
      if (Number.isFinite(last) && Date.now() - last < windowMs) {
        return; // throttled
      }
    }
  } catch (e) {
    console.error(
      "[agents-source] skipped-log throttle threw:",
      (e as Error).message,
    );
    // fall through and insert anyway — fail open so we don't lose audit rows.
  }

  await logAgentAction({
    agentSns: opts.agentSns,
    actionType: opts.actionType,
    reasoning: opts.reasoning,
  }).catch(() => {});
}

// ─── Market-creation rate limiting (Phase O) ──────────────────────────────
//
// Once the agent registry is open to user-launched agents, we need to prevent
// a single agent from spamming markets. Cap is 1 create_market per agent per
// 6 hours, enforced by reading `agent_action_log` before issuing the create_*
// transaction. Skipped attempts are themselves logged (action_type=
// "create_market_skipped") so the agent profile UI can show the cooldown.

const RATE_LIMIT_HOURS = Number(process.env.MARKET_RATE_LIMIT_HOURS ?? 6);
const RATE_LIMIT_MS = RATE_LIMIT_HOURS * 3_600_000;

/**
 * Returns the timestamp (ms) of the agent's last create_market action, plus a
 * `queryError` flag so callers can distinguish "never created" from "the DB
 * errored on the query".
 *
 * Behaviour:
 *   - No DATABASE_URL configured → { ts: null, queryError: false } (explicit
 *     fail-open for local dev — the registry isn't expected to be online).
 *   - Query errored              → { ts: null, queryError: true } (callers
 *     should fail-CLOSED on this so a transient outage doesn't enable spam).
 *   - No row found               → { ts: null, queryError: false } (agent
 *     has never created a market).
 *   - Row found                  → { ts: <ms>, queryError: false }.
 */
export async function lastMarketCreationAtMs(
  agentSns: string,
): Promise<{ ts: number | null; queryError: boolean }> {
  if (!getPool()) return { ts: null, queryError: false };
  try {
    const r = await dbQuery<{ tick_at: string }>(
      `SELECT tick_at
         FROM agent_action_log
         WHERE agent_sns = $1
           AND action_type = 'create_market'
         ORDER BY tick_at DESC
         LIMIT 1`,
      [agentSns],
    );
    const row = r?.rows[0];
    return {
      ts: row ? new Date(row.tick_at).getTime() : null,
      queryError: false,
    };
  } catch (err) {
    console.error(
      "[agents-source] lastMarketCreationAtMs query failed:",
      (err as Error).message,
    );
    return { ts: null, queryError: true };
  }
}

export interface RateLimitCheck {
  limited: boolean;
  reason?: string;
  nextAllowedAt?: number;
}

/**
 * Returns true if the agent is within its market-creation cooldown window.
 *
 * Failure modes:
 *   - No DATABASE_URL configured → { limited: false } (fail-open for local dev).
 *   - Query errored              → { limited: true, reason: "rate_check_unavailable" }
 *     (fail-CLOSED so a transient DB outage doesn't enable market spam).
 *   - Within cooldown window     → { limited: true, reason, nextAllowedAt }.
 *   - Outside cooldown / never   → { limited: false }.
 */
export async function isMarketCreationRateLimited(
  agentSns: string,
): Promise<RateLimitCheck> {
  const { ts: last, queryError } = await lastMarketCreationAtMs(agentSns);
  if (queryError) {
    return { limited: true, reason: "rate_check_unavailable" };
  }
  if (last == null) return { limited: false };
  const elapsed = Date.now() - last;
  if (elapsed < RATE_LIMIT_MS) {
    const nextAllowedAt = last + RATE_LIMIT_MS;
    return {
      limited: true,
      reason: `market_creation_rate_limit (${RATE_LIMIT_HOURS}h cooldown)`,
      nextAllowedAt,
    };
  }
  return { limited: false };
}
