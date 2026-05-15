/**
 * POST /v1/market-proposals
 *
 * Captures public requests to launch a new event market on Bundie.
 * v0 of public market creation: a user fills in a form on /launch in
 * the webapp, we capture the proposal here, the admin reviews + decides
 * whether to deploy it. No on-chain action yet.
 *
 * Storage strategy: insert into the bundie-db `market_proposals` table
 * if `dbQuery` is configured; otherwise log to stdout so devnet test
 * submissions don't get lost. The schema is below — if the table doesn't
 * exist the INSERT throws and the catch logs to stderr but still returns
 * 200 to the user (a proposal that didn't land in db is recoverable from
 * logs; a 500 to the user is not).
 *
 * SQL to create the table on first deploy:
 *   CREATE TABLE market_proposals (
 *     id BIGSERIAL PRIMARY KEY,
 *     submitted_at TIMESTAMPTZ DEFAULT now(),
 *     requester_wallet TEXT,
 *     requester_contact TEXT,
 *     category TEXT NOT NULL,
 *     description TEXT NOT NULL,
 *     proposed_resolver_class TEXT,
 *     proposed_params JSONB,
 *     notes TEXT,
 *     status TEXT NOT NULL DEFAULT 'pending'
 *   );
 */

import { Hono } from "hono";
import { dbQuery } from "../lib/db.js";

export const proposals = new Hono();

interface ProposalBody {
  category?: string;
  description?: string;
  proposed_resolver_class?: string;
  proposed_params?: Record<string, unknown>;
  requester_wallet?: string;
  requester_contact?: string;
  notes?: string;
}

proposals.post("/market-proposals", async (c) => {
  let body: ProposalBody;
  try {
    body = (await c.req.json()) as ProposalBody;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const category = (body.category ?? "").trim();
  const description = (body.description ?? "").trim();

  if (!category || !description) {
    return c.json(
      {
        error:
          "Both `category` and `description` are required. Describe the event in plain English and pick a category from /v1/events `categories`.",
      },
      400,
    );
  }
  if (description.length > 1_000) {
    return c.json({ error: "description max 1000 chars" }, 400);
  }

  // Capture to db. Failure to insert is logged but does NOT 500 the
  // caller — a proposal that hit our logs but missed the row is still
  // recoverable; a 500 just loses the proposal entirely.
  const row = {
    requester_wallet: body.requester_wallet ?? null,
    requester_contact: body.requester_contact ?? null,
    category,
    description,
    proposed_resolver_class: body.proposed_resolver_class ?? null,
    proposed_params: body.proposed_params ?? null,
    notes: body.notes ?? null,
  };

  try {
    await dbQuery(
      `INSERT INTO market_proposals
         (requester_wallet, requester_contact, category, description,
          proposed_resolver_class, proposed_params, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.requester_wallet,
        row.requester_contact,
        row.category,
        row.description,
        row.proposed_resolver_class,
        row.proposed_params ? JSON.stringify(row.proposed_params) : null,
        row.notes,
      ],
    );
  } catch (err) {
    console.error("[market-proposals] db insert failed:", (err as Error).message);
    console.error("[market-proposals] orphan proposal:", JSON.stringify(row));
  }

  return c.json({
    ok: true,
    message:
      "Thanks. We'll review and reach out if we deploy the market or need more detail.",
  });
});
