/**
 * resolver_track_record persistence.
 *
 * The /v1/event-price response surfaces a per-resolver track record
 * ({total, disputed, lost}). Until now it was a hardcoded zero stub in
 * event-price.ts; this module backs it with the bundie-db `resolver_track_record`
 * table (see supabase/migrations/20260514120000_resolver_track_record.sql).
 *
 * Caching: the counts only change when a market resolves (rare), but the
 * read sits on the hot x402-priced path. A per-process 30s LRU map keeps
 * the steady-state read off Postgres. The TTL is short enough that a fresh
 * dispute outcome reflects within ~30s of the on-chain settlement.
 *
 * Fail-open: if DATABASE_URL isn't configured (local dev without bundie-db
 * running), we return zeros and never throw — preserves the prior behaviour
 * so /v1/event-price never 500s on a missing DB.
 */
import { dbQuery } from "../lib/db.js";

export interface TrackRecord {
  total: number;
  disputed: number;
  lost: number;
}

const ZERO: TrackRecord = { total: 0, disputed: 0, lost: 0 };

interface CacheEntry {
  value: TrackRecord;
  expiresAt: number;
}

const TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

interface Row {
  total: number;
  disputed: number;
  lost: number;
}

/**
 * Returns the track record for a resolver_id (e.g. "PYTH_THRESHOLD_DURATION").
 * Hits a 30s in-process cache; falls back to zeros on DB miss or DB-absent.
 */
export async function getTrackRecord(resolverId: string): Promise<TrackRecord> {
  const now = Date.now();
  const cached = cache.get(resolverId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let value: TrackRecord = ZERO;
  try {
    const r = await dbQuery<Row>(
      "SELECT total, disputed, lost FROM resolver_track_record WHERE resolver_id = $1",
      [resolverId],
    );
    if (r && r.rows.length > 0) {
      const row = r.rows[0];
      value = {
        // pg returns INTEGER columns as JS number; the Number() cast is
        // defensive in case the column type ever migrates to BIGINT.
        total: Number(row.total),
        disputed: Number(row.disputed),
        lost: Number(row.lost),
      };
    }
  } catch (err) {
    // Don't crash the priced endpoint on a DB blip — surface zeros and log.
    console.error("[track-record] read failed:", (err as Error).message);
  }

  cache.set(resolverId, { value, expiresAt: now + TTL_MS });
  return value;
}

/**
 * Upserts the track record for a resolver. Callers (resolver settlement
 * path, admin tooling) pass the absolute counts, not deltas. Invalidates
 * the local cache so the next read reflects the write within the same
 * process; other processes pick it up after their own 30s TTL.
 *
 * No-ops if DATABASE_URL is unset.
 */
export async function setTrackRecord(
  resolverId: string,
  record: TrackRecord,
): Promise<void> {
  try {
    await dbQuery(
      `INSERT INTO resolver_track_record (resolver_id, total, disputed, lost, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (resolver_id) DO UPDATE
         SET total = EXCLUDED.total,
             disputed = EXCLUDED.disputed,
             lost = EXCLUDED.lost,
             updated_at = now()`,
      [resolverId, record.total, record.disputed, record.lost],
    );
  } catch (err) {
    console.error("[track-record] write failed:", (err as Error).message);
  }
  cache.delete(resolverId);
}

/**
 * Atomically increments a single counter on the resolver_track_record row.
 * Used by the resolver-runner after a successful on-chain settlement
 * (`field="total"`). Dispute/loss bookkeeping plugs in here once an
 * override mechanism exists — pass `field="disputed"` or `"lost"`.
 *
 * Server-side increment avoids the read-modify-write race between
 * concurrent runner processes. No-ops if DATABASE_URL is unset.
 */
export async function incrementTrackRecord(
  resolverId: string,
  field: keyof TrackRecord,
): Promise<void> {
  try {
    await dbQuery(
      `INSERT INTO resolver_track_record (resolver_id, total, disputed, lost, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (resolver_id) DO UPDATE
         SET ${field} = resolver_track_record.${field} + 1,
             updated_at = now()`,
      [
        resolverId,
        field === "total" ? 1 : 0,
        field === "disputed" ? 1 : 0,
        field === "lost" ? 1 : 0,
      ],
    );
  } catch (err) {
    console.error("[track-record] increment failed:", (err as Error).message);
  }
  cache.delete(resolverId);
}
