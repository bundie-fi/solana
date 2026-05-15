/**
 * Idempotent on-startup schema bootstrap.
 *
 * Each statement here is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF
 * NOT EXISTS`, so it's safe to run on every backend boot. New schema
 * lives here so a fresh deploy onto an empty database just works, and
 * the supabase/migrations/*.sql files stay as the source of truth for
 * the diffs (paste them in alongside the SQL there).
 *
 * Failure mode: if dbQuery returns null (DATABASE_URL not set), we
 * silently noop — that matches the rest of the backend's fail-open db
 * contract.
 */
import { dbQuery } from "./db.js";

const STATEMENTS = [
  // resolver_track_record (2026-05-14)
  `CREATE TABLE IF NOT EXISTS resolver_track_record (
     resolver_id TEXT PRIMARY KEY,
     total INTEGER NOT NULL DEFAULT 0,
     disputed INTEGER NOT NULL DEFAULT 0,
     lost INTEGER NOT NULL DEFAULT 0,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // market_proposals (2026-05-15) — captures public requests from /launch
  `CREATE TABLE IF NOT EXISTS market_proposals (
     id BIGSERIAL PRIMARY KEY,
     submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     requester_wallet TEXT,
     requester_contact TEXT,
     category TEXT NOT NULL,
     description TEXT NOT NULL,
     proposed_resolver_class TEXT,
     proposed_params JSONB,
     notes TEXT,
     status TEXT NOT NULL DEFAULT 'pending',
     reviewed_at TIMESTAMPTZ,
     reviewer_note TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS market_proposals_status_idx
     ON market_proposals (status, submitted_at DESC)`,
  `CREATE INDEX IF NOT EXISTS market_proposals_requester_idx
     ON market_proposals (requester_wallet)
     WHERE requester_wallet IS NOT NULL`,
];

let _ranOnce = false;

export async function ensureSchema(): Promise<void> {
  if (_ranOnce) return;
  _ranOnce = true;
  try {
    for (const sql of STATEMENTS) {
      const r = await dbQuery(sql);
      if (r === null) {
        // dbQuery returned null → DATABASE_URL absent. Don't keep
        // trying for every statement; one log line is enough.
        console.warn(
          "[migrations] DATABASE_URL not set — skipping schema bootstrap.",
        );
        return;
      }
    }
    console.log("[migrations] schema bootstrap complete");
  } catch (err) {
    console.error(
      "[migrations] bootstrap failed (continuing):",
      (err as Error).message,
    );
  }
}
