/**
 * Registered-agents registry helper.
 *
 * Single source of truth for "which agent vaults are the UI allowed to
 * surface?" Reads `GET /api/agents?status=active` from the backend and
 * exposes:
 *   - `fetchRegisteredAgents()`     → full row array (for leaderboard / strip)
 *   - `fetchRegisteredVaultSet()`   → just the vault pubkey set (for filters)
 *
 * Failure mode: 404 / network error / non-OK / parse error all collapse to
 * an empty array (and therefore an empty set). This is deliberate — the
 * UI should hide *every* agent in that case rather than fall back to a
 * hardcoded list, which would re-introduce zombie agents from old devnet
 * markets after the registry comes online.
 *
 * The `HERO_AGENTS` / `CHAOS_AGENTS` maps in `sns-resolver.ts` are still
 * used as a *label-rendering* fallback when the SNS service is unreachable
 * (vault → display name); they are NOT used as the source of truth for the
 * agent list.
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000";

/**
 * Minimal shape returned by `GET /api/agents`. Only the fields the UI
 * actually consumes are typed here — the backend may return additional
 * columns (preset, brain_md, etc.) which we ignore.
 */
export interface RegisteredAgent {
  sns: string;
  vault_pda: string;
  emoji: string | null;
  display_name: string;
}

/**
 * Fetch all active agents from the Supabase-backed registry. Returns an
 * empty array on any failure (404, network error, parse error).
 *
 * Safe to call from both server and client components — uses the global
 * `fetch` API. Server callers should pass `{ cache: "no-store" }` via the
 * `init` arg if they need fresh data on every render (Next.js defaults to
 * caching `fetch` in server components).
 */
export async function fetchRegisteredAgents(
  init?: RequestInit,
): Promise<RegisteredAgent[]> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/agents?status=active`,
      init,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { agents?: RegisteredAgent[] };
    return body.agents ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch the set of identifying pubkeys for active registered agents.
 * Includes BOTH `vault_pda` (the BundieVault PDA — used as Market.created_by)
 * AND `agent_pubkey` (the authority — what the SNS resolver returns).
 * Used as the `allowedCreators` filter on `fetchAllMarkets` and as the gate
 * for `/agent/[sns]` profile pages.
 */
export async function fetchRegisteredVaultSet(
  init?: RequestInit,
): Promise<Set<string>> {
  const agents = await fetchRegisteredAgents(init);
  const set = new Set<string>();
  for (const a of agents) {
    if (a.vault_pda) set.add(a.vault_pda);
    if (a.agent_pubkey) set.add(a.agent_pubkey);
  }
  return set;
}
