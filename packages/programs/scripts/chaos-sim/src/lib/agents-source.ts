/**
 * agents-source.ts — Supabase-backed agent registry for the chaos-sim daemon.
 *
 * Phase N replaces the hardcoded alice/bob/charlie list with a poll against
 * the `agents` table (status='active'). Per-agent brain.md and policies.yaml
 * are written to a temp dir so the existing Zerion CLI / shared-tick code
 * can keep reading them via filesystem paths (no signature changes).
 *
 * Per-tick action logging writes to `agent_action_log` so the agent profile
 * UI can show recent activity without parsing the on-chain history.
 *
 * If SUPABASE_URL or SUPABASE_SERVICE_KEY is missing, this module returns
 * empty results and logs a warning — the daemon is expected to fall back to
 * the legacy hardcoded list in that case (dev/local workflow).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Loads all currently-active agents from Supabase.
 * Writes per-agent brain.md + policies.yaml to a temp dir so Zerion CLI can
 * read them via existing `--policies <path>` / file-read code paths.
 */
export async function loadActiveAgents(): Promise<ActiveAgent[]> {
  const supa = getSupabase();
  if (!supa) {
    console.warn("[agents-source] no Supabase creds, returning empty list");
    return [];
  }
  const { data, error } = await supa
    .from("agents")
    .select(
      "sns, agent_pubkey, vault_pda, owner_wallet, brain_md, policies_yaml",
    )
    .eq("status", "active");
  if (error) {
    console.error("[agents-source] query failed:", error.message);
    return [];
  }

  return (data ?? []).map((r: Record<string, string>) => {
    const dir = join(TEMP_ROOT, r.sns);
    mkdirSync(dir, { recursive: true });
    const brainMdPath = join(dir, "brain.md");
    const policiesPath = join(dir, "policies.yaml");
    writeFileSync(brainMdPath, r.brain_md);
    writeFileSync(policiesPath, r.policies_yaml);
    return {
      sns: r.sns,
      agentPubkey: r.agent_pubkey,
      vaultPda: r.vault_pda,
      ownerWallet: r.owner_wallet,
      brainMd: r.brain_md,
      policiesYaml: r.policies_yaml,
      policiesPath,
      brainMdPath,
    };
  });
}

/**
 * Logs a tick action to agent_action_log for the agent profile to display.
 * No-op if Supabase creds are missing (so local dev keeps working).
 */
export async function logAgentAction(opts: {
  agentSns: string;
  actionType: string;
  reasoning?: string | null;
  resultJson?: unknown;
}): Promise<void> {
  const supa = getSupabase();
  if (!supa) return;
  const { error } = await supa.from("agent_action_log").insert({
    agent_sns: opts.agentSns,
    action_type: opts.actionType,
    reasoning: opts.reasoning ?? null,
    result_json: opts.resultJson ?? null,
  });
  if (error) console.error("[agents-source] log insert failed:", error.message);
}

// ─── Market-creation rate limiting (Phase O) ──────────────────────────────
//
// Once the agent registry is open to user-launched agents, we need to prevent
// a single agent from spamming markets. Cap is 1 create_market per agent per
// 6 hours, enforced by reading `agent_action_log` before issuing the create_*
// transaction. Skipped attempts are themselves logged (action_type=
// "create_market_skipped") so the agent profile UI can show the cooldown.

const RATE_LIMIT_HOURS = 6;
const RATE_LIMIT_MS = RATE_LIMIT_HOURS * 3_600_000;

/**
 * Returns the timestamp (ms) of the agent's last create_market action, plus a
 * `queryError` flag so callers can distinguish "never created" from "Supabase
 * errored on the query".
 *
 * Behaviour:
 *   - No Supabase configured  → { ts: null, queryError: false } (explicit fail-open
 *     for local dev — the registry isn't expected to be online).
 *   - Supabase query errored  → { ts: null, queryError: true } (callers should
 *     fail-CLOSED on this so a transient outage doesn't enable spam).
 *   - No row found            → { ts: null, queryError: false } (agent has never
 *     created a market).
 *   - Row found               → { ts: <ms>, queryError: false }.
 */
export async function lastMarketCreationTimestamp(
  agentSns: string,
): Promise<{ ts: number | null; queryError: boolean }> {
  const supa = getSupabase();
  if (!supa) return { ts: null, queryError: false };
  const { data, error } = await supa
    .from("agent_action_log")
    .select("tick_at")
    .eq("agent_sns", agentSns)
    .eq("action_type", "create_market")
    .order("tick_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error(
      "[agents-source] lastMarketCreationTimestamp query failed:",
      error.message,
    );
    return { ts: null, queryError: true };
  }
  const row = data?.[0] as { tick_at: string } | undefined;
  return {
    ts: row ? new Date(row.tick_at).getTime() : null,
    queryError: false,
  };
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
 *   - No Supabase configured   → { limited: false } (fail-open for local dev).
 *   - Supabase query errored   → { limited: true, reason: "rate_check_unavailable" }
 *     (fail-CLOSED so a transient Supabase outage doesn't enable market spam).
 *   - Within cooldown window   → { limited: true, reason, nextAllowedAt }.
 *   - Outside cooldown / never → { limited: false }.
 */
export async function isMarketCreationRateLimited(
  agentSns: string,
): Promise<RateLimitCheck> {
  const { ts: last, queryError } = await lastMarketCreationTimestamp(agentSns);
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
