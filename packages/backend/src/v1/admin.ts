/**
 * /v1/admin/* — admin-only endpoints. Token-gated via `x-admin-token`.
 *
 * Mounted under /v1/admin so the global x402 middleware sees it (admin
 * is on the same v1 surface) — but x402 has no price entry for these
 * paths so it falls through to the admin's own check below.
 *
 * Auth: every request must carry `x-admin-token` matching the
 * BUNDIE_ADMIN_TOKEN env var. If the env var is unset, the entire admin
 * router is disabled (returns 503) — safer than defaulting to "open"
 * during a misconfigured deploy.
 */

import { Hono } from "hono";
import { dbQuery } from "../lib/db.js";

export const admin = new Hono();

function requireAdminToken(c: {
  req: { header: (k: string) => string | undefined };
}): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  const expected = process.env.BUNDIE_ADMIN_TOKEN;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error:
        "Admin endpoints disabled — set BUNDIE_ADMIN_TOKEN in the backend environment to enable.",
    };
  }
  const got =
    c.req.header("x-admin-token") ?? c.req.header("X-Admin-Token") ?? "";
  if (got !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

// ─── Market proposals ───────────────────────────────────────────────────

interface ProposalRow {
  id: string;
  submitted_at: string;
  requester_wallet: string | null;
  requester_contact: string | null;
  category: string;
  description: string;
  proposed_resolver_class: string | null;
  proposed_params: unknown;
  notes: string | null;
  status: string;
  reviewed_at: string | null;
  reviewer_note: string | null;
}

admin.get("/proposals", async (c) => {
  const auth = requireAdminToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const status = c.req.query("status"); // optional filter
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);

  let sql = `SELECT id, submitted_at, requester_wallet, requester_contact,
                    category, description, proposed_resolver_class,
                    proposed_params, notes, status,
                    reviewed_at, reviewer_note
             FROM market_proposals`;
  const params: unknown[] = [];
  if (status) {
    sql += ` WHERE status = $1`;
    params.push(status);
  }
  sql += ` ORDER BY submitted_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  try {
    const r = await dbQuery<ProposalRow>(sql, params);
    if (!r) return c.json({ proposals: [], total: 0, db: "unavailable" });
    return c.json({ proposals: r.rows, total: r.rowCount ?? r.rows.length });
  } catch (err) {
    console.error("[admin/proposals] read failed:", (err as Error).message);
    return c.json({ error: "Query failed" }, 500);
  }
});

interface UpdateBody {
  status?: "pending" | "approved" | "rejected" | "deployed";
  reviewer_note?: string;
}

admin.patch("/proposals/:id", async (c) => {
  const auth = requireAdminToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) {
    return c.json({ error: "id must be numeric" }, 400);
  }

  let body: UpdateBody;
  try {
    body = (await c.req.json()) as UpdateBody;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const ALLOWED = new Set(["pending", "approved", "rejected", "deployed"]);
  if (body.status && !ALLOWED.has(body.status)) {
    return c.json(
      { error: `status must be one of: ${[...ALLOWED].join(", ")}` },
      400,
    );
  }

  // Partial update: status + reviewer_note. reviewed_at gets set when
  // status changes from pending → any terminal state.
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.status) {
    sets.push(`status = $${params.length + 1}`);
    params.push(body.status);
    if (body.status !== "pending") {
      sets.push(`reviewed_at = now()`);
    }
  }
  if (body.reviewer_note !== undefined) {
    sets.push(`reviewer_note = $${params.length + 1}`);
    params.push(body.reviewer_note || null);
  }
  if (sets.length === 0) {
    return c.json({ error: "Nothing to update" }, 400);
  }
  params.push(id);
  const sql = `UPDATE market_proposals SET ${sets.join(", ")}
               WHERE id = $${params.length}
               RETURNING id, status, reviewed_at, reviewer_note`;

  try {
    const r = await dbQuery(sql, params);
    if (!r || r.rowCount === 0) {
      return c.json({ error: `Proposal ${id} not found` }, 404);
    }
    return c.json({ ok: true, updated: r.rows[0] });
  } catch (err) {
    console.error("[admin/proposals] update failed:", (err as Error).message);
    return c.json({ error: "Update failed" }, 500);
  }
});

// Lightweight count summary — used by the admin UI to badge each tab.
admin.get("/proposals/_counts", async (c) => {
  const auth = requireAdminToken(c);
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  try {
    const r = await dbQuery<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text AS n
         FROM market_proposals
         GROUP BY status`,
    );
    const counts: Record<string, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      deployed: 0,
    };
    for (const row of r?.rows ?? []) counts[row.status] = Number(row.n);
    return c.json({ counts });
  } catch (err) {
    console.error("[admin/proposals/_counts] failed:", (err as Error).message);
    return c.json({ counts: { pending: 0, approved: 0, rejected: 0, deployed: 0 } });
  }
});
