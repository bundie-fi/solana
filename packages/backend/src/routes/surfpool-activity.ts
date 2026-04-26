/**
 * surfpool-activity.ts — read endpoint for the agent profile's
 * "Live strategy execution on Solana mainnet fork" panel.
 *
 * Surfpool is a local mainnet fork; its txs are real but invisible to web
 * visitors because there's no public explorer. The chaos-sim daemon writes
 * each landed surfpool tx to the `surfpool_actions` Supabase table; this
 * route reads them back and shapes them for the web UI.
 *
 * GET /api/agent/:sns/surfpool-activity?limit=50
 *
 * Defaults limit to 50, caps at 200, orders by created_at DESC, filters
 * agent_sns = :sns. If Supabase is unavailable, returns 503 with an empty
 * actions[] so the UI can still render (graceful degrade).
 */
import { Hono } from "hono";
import { supabase } from "../lib/supabase.js";

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

  if (!supabase) {
    return c.json(
      {
        agent: sns,
        actions: [],
        error: "Supabase not configured on backend",
      },
      503,
    );
  }

  const { data, error } = await supabase
    .from("surfpool_actions")
    .select(
      "id, slot, tx_sig, protocol, action_type, amount_base_units, token_mint, notes, created_at",
    )
    .eq("agent_sns", sns)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return c.json(
      { error: "Failed to fetch surfpool activity", detail: error.message },
      500,
    );
  }

  const rows = (data ?? []) as SurfpoolActionRow[];
  const actions: SurfpoolActionDto[] = rows.map((r) => ({
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
