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

interface SupabaseAgentRow {
  sns: string;
  agent_pubkey: string;
  vault_pda: string;
  owner_wallet: string;
  brain_md: string | null;
  policies_yaml: string | null;
}

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

  return (data ?? []).flatMap((r: SupabaseAgentRow): ActiveAgent[] => {
    if (!r.brain_md || !r.policies_yaml) {
      console.warn(
        `[agents-source] skipping ${r.sns}: missing brain_md or policies_yaml`,
      );
      logAgentAction({
        agentSns: r.sns,
        actionType: "skipped_corrupt_row",
        reasoning: "missing brain_md or policies_yaml in Supabase row",
      }).catch(() => {});
      return [];
    }
    const dir = join(TEMP_ROOT, r.sns);
    mkdirSync(dir, { recursive: true });
    const brainMdPath = join(dir, "brain.md");
    const policiesPath = join(dir, "policies.yaml");
    writeFileSync(brainMdPath, r.brain_md);
    writeFileSync(policiesPath, r.policies_yaml);
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
 * No-op if Supabase creds are missing (so local dev keeps working).
 */
export async function logAgentAction(opts: {
  agentSns: string;
  actionType: string;
  reasoning?: string;
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
  const supa = getSupabase();
  if (!supa) return;
  const windowMs = opts.windowMs ?? 60 * 60_000;
  try {
    const { data, error } = await supa
      .from("agent_action_log")
      .select("created_at")
      .eq("agent_sns", opts.agentSns)
      .like("action_type", "skipped_%")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error(
        "[agents-source] skipped-log throttle query failed:",
        error.message,
      );
      // Fail open — still attempt to insert so we don't lose the audit row.
    } else if (data && data.length > 0) {
      const last = new Date(data[0].created_at as string).getTime();
      if (Number.isFinite(last) && Date.now() - last < windowMs) {
        return; // throttled
      }
    }
  } catch (e) {
    console.error(
      "[agents-source] skipped-log throttle threw:",
      (e as Error).message,
    );
    // fall through and insert anyway
  }

  await logAgentAction({
    agentSns: opts.agentSns,
    actionType: opts.actionType,
    reasoning: opts.reasoning,
  }).catch(() => {});
}
