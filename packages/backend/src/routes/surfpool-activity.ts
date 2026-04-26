/**
 * surfpool-activity.ts — read endpoint for the agent profile's
 * "Live strategy execution on Solana mainnet fork" panel.
 *
 * Surfpool is a local mainnet fork; its txs are real but invisible to web
 * visitors because there's no public explorer. The chaos-sim daemon writes
 * each landed surfpool tx to the `surfpool_actions` Postgres table; this
 * route reads them back and shapes them for the web UI.
 *
 * GET /api/agent/:sns/surfpool-activity?limit=50
 *
 * Defaults limit to 50, caps at 200, orders by created_at DESC, filters
 * agent_sns = :sns. If DATABASE_URL is unavailable, returns 503 with an empty
 * actions[] so the UI can still render (graceful degrade).
 */
import { Hono } from "hono";
import { dbQuery } from "../lib/db.js";

export const surfpoolActivity = new Hono();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface SurfpoolActionRow {
  id: number;
  slot: number;
  tx_sig: string;
  protocol: string;
  action_type: string;
  amount_base_units: number | null;
  token_mint: string | null;
  notes: string | null;
  created_at: string;
}

interface SurfpoolActionDto {
  id: number;
  slot: number;
  txSig: string;
  protocol: string;
  actionType: string;
  amountBaseUnits: number | null;
  tokenMint: string | null;
  notes: string | null;
  createdAt: string;
}

surfpoolActivity.get("/:sns/surfpool-activity", async (c) => {
  const sns = c.req.param("sns");
  const rawLimit = c.req.query("limit");

  let limit = DEFAULT_LIMIT;
  if (rawLimit) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  if (!sns || sns.length === 0) {
    return c.json({ error: "agent sns required" }, 400);
  }

  let result;
  try {
    result = await dbQuery<SurfpoolActionRow>(
      `SELECT id, slot, tx_sig, protocol, action_type, amount_base_units,
              token_mint, notes, created_at
         FROM surfpool_actions
         WHERE agent_sns = $1
         ORDER BY created_at DESC
         LIMIT $2`,
      [sns, limit],
    );
  } catch (err) {
    return c.json(
      {
        error: "Failed to fetch surfpool activity",
        detail: (err as Error).message,
      },
      500,
    );
  }

  if (!result) {
    return c.json(
      {
        agent: sns,
        actions: [],
        error: "Database not configured on backend",
      },
      503,
    );
  }

  const actions: SurfpoolActionDto[] = result.rows.map((r) => ({
    id: r.id,
    slot: Number(r.slot),
    txSig: r.tx_sig,
    protocol: r.protocol,
    actionType: r.action_type,
    amountBaseUnits:
      r.amount_base_units != null ? Number(r.amount_base_units) : null,
    tokenMint: r.token_mint,
    notes: r.notes,
    createdAt: r.created_at,
  }));

  return c.json({ agent: sns, actions });
});
