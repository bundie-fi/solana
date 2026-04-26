/**
 * surfpool-recorder.ts — persist each successful surfpool tx to Supabase.
 *
 * Surfpool is a local Solana mainnet fork; its txs are real but invisible
 * because there's no public explorer. The chaos-sim daemon calls
 * recordSurfpoolAction() after every confirmed strategy tx so the web app's
 * agent profile can render a live activity panel without needing access to
 * the Surfpool RPC.
 *
 * Read by: backend GET /api/agent/:sns/surfpool-activity.
 *
 * If SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (also accepts SUPABASE_SERVICE_KEY
 * for parity with the backend) is missing, the helper logs a warning and
 * silently no-ops. The daemon must never crash because the feed is unavailable.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
// Accept either env var name — backend uses SUPABASE_SERVICE_KEY, the spec
// here calls for SUPABASE_SERVICE_ROLE_KEY. Either works.
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "";

let client: ReturnType<typeof createClient> | null = null;
function getClient() {
  if (!supabaseUrl || !supabaseKey) return null;
  if (!client) client = createClient(supabaseUrl, supabaseKey);
  return client;
}

export type SurfpoolProtocol =
  | "kamino"
  | "marginfi"
  | "marinade"
  | "jito"
  | "drift"
  | "orca"
  | "solend";

export interface SurfpoolActionRecord {
  agentSns: string;
  slot: number;
  txSig: string;
  protocol: SurfpoolProtocol;
  actionType: string;
  amountLamports?: number | null;
  tokenMint?: string | null;
  notes?: string | null;
}

export async function recordSurfpoolAction(
  record: SurfpoolActionRecord,
): Promise<void> {
  const c = getClient();
  if (!c) {
    console.warn("[surfpool-recorder] no Supabase creds, skipping persist");
    return;
  }
  const { error } = await c.from("surfpool_actions").insert({
    agent_sns: record.agentSns,
    slot: record.slot,
    tx_sig: record.txSig,
    protocol: record.protocol,
    action_type: record.actionType,
    amount_lamports: record.amountLamports ?? null,
    token_mint: record.tokenMint ?? null,
    notes: record.notes ?? null,
  });
  if (error) console.error("[surfpool-recorder] insert failed:", error.message);
}
