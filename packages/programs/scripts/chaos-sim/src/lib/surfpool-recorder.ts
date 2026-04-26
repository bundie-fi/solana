/**
 * surfpool-recorder.ts — persist each successful surfpool tx to Postgres.
 *
 * Surfpool is a local Solana mainnet fork; its txs are real but invisible
 * because there's no public explorer. The chaos-sim daemon calls
 * recordSurfpoolAction() after every confirmed strategy tx so the web app's
 * agent profile can render a live activity panel without needing access to
 * the Surfpool RPC.
 *
 * Scope: lend actions only. LST rotations (Marinade/Jito) execute against
 * devnet today, not surfpool — those positions surface on the agent profile
 * via the Strategy positions panel (live token-account read) instead of this
 * feed. The empty-state copy in surfpool-activity-panel.tsx documents this
 * for users.
 *
 * Read by: backend GET /api/agent/:sns/surfpool-activity.
 *
 * If DATABASE_URL is missing the helper logs a warning and silently no-ops.
 * The daemon must never crash because the feed is unavailable.
 */
import { dbQuery, getPool } from "./db.js";

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
  if (!getPool()) {
    console.warn("[surfpool-recorder] no DATABASE_URL, skipping persist");
    return;
  }
  try {
    await dbQuery(
      `INSERT INTO surfpool_actions (
         agent_sns, slot, tx_sig, protocol, action_type,
         amount_base_units, token_mint, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.agentSns,
        record.slot,
        record.txSig,
        record.protocol,
        record.actionType,
        record.amountLamports ?? null,
        record.tokenMint ?? null,
        record.notes ?? null,
      ],
    );
  } catch (err) {
    console.error(
      "[surfpool-recorder] insert failed:",
      (err as Error).message,
    );
  }
}
