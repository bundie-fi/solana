/**
 * db.ts — shared pg.Pool wrapper for the chaos-sim daemon.
 *
 * Mirrors packages/backend/src/lib/db.ts. We talk to bundie-db (Postgres on
 * Railway) directly via DATABASE_URL — no PostgREST layer in the monorepo.
 *
 * Same fail-open semantics as the old supabase wrapper: getPool() returns
 * null when DATABASE_URL is unset, dbQuery() resolves to null. Callers that
 * previously checked `if (!supa)` keep working with `if (!pool)` or
 * `if (!result)`.
 *
 * SSL handling: Railway's internal hostname (`*.railway.internal`) does NOT
 * present a TLS cert — connections must run plain TCP inside the private VPC.
 * Public proxies (`*.proxy.rlwy.net`, etc.) require TLS, so we enable it with
 * rejectUnauthorized=false (Railway's certs are self-signed).
 */
import { Pool, type QueryResult, type QueryResultRow } from "pg";

let _pool: Pool | null = null;

export function getPool(): Pool | null {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  _pool = new Pool({
    connectionString: url,
    ssl: url.includes("railway.internal")
      ? false
      : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T> | null> {
  const pool = getPool();
  if (!pool) return null;
  return pool.query<T>(text, params);
}
