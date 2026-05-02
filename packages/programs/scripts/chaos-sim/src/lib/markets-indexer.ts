/**
 * markets-indexer.ts — daemon-side mirror of on-chain prediction markets
 * into Postgres.
 *
 * Markets live entirely on-chain (devnet, prediction-market program
 * Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4). The home-page stats
 * strip and the discovery feed (`GET /api/markets`) need cheap aggregate
 * reads — `getProgramAccounts` per request is too slow. So once per
 * supervisor cycle we snapshot every visible Market account into the
 * `markets` table via `INSERT ... ON CONFLICT DO UPDATE`.
 *
 * Reuses the auto-resolver's `fetchAllMarkets` helper to avoid duplicating
 * Anchor deserialization. Per-market errors log + continue — we never let
 * one malformed market kill the whole pass.
 *
 * Volumes (`yes_volume` / `no_volume`) are stored in 6dp bUSD base units
 * (matches `nav_lamports`). On-chain the program tracks
 * `total_yes_cost` / `total_no_cost` (cost basis paid into the LS-LMSR
 * vault per side), which is the closest analog to per-side volume the
 * Market account exposes — `total_volume` is a single u64 of the sum.
 */
import type { Connection } from "@solana/web3.js";

import { dbQuery, getPool } from "./db.js";
import { fetchAllMarkets, type FetchedMarketRow } from "./auto-resolver.js";

interface IndexedRow {
  marketPda: string;
  createdBy: string;
  kind: number;
  question: string | null;
  resolutionSlot: number;
  status: "open" | "resolved" | "expired";
  outcome: number | null;
  yesVolume: bigint;
  noVolume: bigint;
}

/**
 * Project a raw Anchor-decoded market row into the columnar shape the
 * `markets` table accepts. Returns null when the row is missing the
 * required `created_by` field — old v1 markets predating the
 * `created_by` introduction won't have it, and we intentionally exclude
 * them from the mirror so the table's NOT NULL constraint holds.
 */
function projectMarket(row: FetchedMarketRow): IndexedRow | null {
  const a = row.account;

  // Anchor decodes MarketStatus as `{ active: {} }` / `{ resolved: {} }`.
  // Map to our 3-state mirror domain: open (active), resolved (resolved),
  // expired (kept for future use — past resolution_slot but not yet
  // resolved on-chain). For now we only emit open/resolved.
  let status: "open" | "resolved" | "expired" = "open";
  if (a.status && typeof a.status === "object") {
    if ("resolved" in a.status) status = "resolved";
    else if ("active" in a.status) status = "open";
  }

  // Outcome is `Option<Outcome>` → `{ yes: {} }` | `{ no: {} }` | null.
  let outcome: number | null = null;
  if (a.outcome && typeof a.outcome === "object") {
    if ("yes" in a.outcome) outcome = 1;
    else if ("no" in a.outcome) outcome = 0;
  }

  const createdBy = a.createdBy ?? a.created_by ?? a.authority ?? null;
  if (!createdBy) return null;

  const kind = Number(a.kind ?? 0);
  const resolutionSlot = Number(a.resolutionSlot ?? a.resolution_slot ?? 0);
  const question: string | null =
    typeof a.question === "string" ? a.question : null;

  // Per-side cost basis is the closest on-chain analog to "volume per
  // outcome". The single-u64 `total_volume` field can't be split, so we
  // use the cost-basis pair which sums to (slightly less than)
  // total_volume net of fees.
  const yesVolume = BigInt(
    (a.totalYesCost ?? a.total_yes_cost ?? 0).toString(),
  );
  const noVolume = BigInt(
    (a.totalNoCost ?? a.total_no_cost ?? 0).toString(),
  );

  return {
    marketPda: row.publicKey.toBase58(),
    createdBy: createdBy.toString(),
    kind,
    question,
    resolutionSlot,
    status,
    outcome,
    yesVolume,
    noVolume,
  };
}

/**
 * Upsert one market row. Best-effort: errors log + continue.
 */
async function upsertMarket(m: IndexedRow): Promise<void> {
  await dbQuery(
    `INSERT INTO markets (
       market_pda, created_by, kind, question, resolution_slot,
       status, outcome, yes_volume, no_volume, last_synced_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (market_pda) DO UPDATE
       SET status = EXCLUDED.status,
           outcome = EXCLUDED.outcome,
           yes_volume = EXCLUDED.yes_volume,
           no_volume = EXCLUDED.no_volume,
           resolved_at = CASE WHEN EXCLUDED.status = 'resolved'
                              AND markets.resolved_at IS NULL
                              THEN now() ELSE markets.resolved_at END,
           last_synced_at = now()`,
    [
      m.marketPda,
      m.createdBy,
      m.kind,
      m.question,
      m.resolutionSlot,
      m.status,
      m.outcome,
      m.yesVolume.toString(),
      m.noVolume.toString(),
    ],
  );
}

export interface IndexerSummary {
  fetched: number;
  upserted: number;
  skipped: number;
  failed: number;
}

/**
 * One pass: fetch every Market account on devnet and upsert into Postgres.
 * Returns a summary; never throws (per-row errors are swallowed and
 * counted). Caller is responsible for rate-limiting (we hit
 * getProgramAccounts once per call).
 */
export async function runMarketsIndexerPass(
  devnet: Connection,
): Promise<IndexerSummary> {
  // No DB → nothing to mirror. Match the fail-open semantics used
  // elsewhere in the daemon (e.g. activity-log.ts).
  if (!getPool()) {
    return { fetched: 0, upserted: 0, skipped: 0, failed: 0 };
  }

  let rows: FetchedMarketRow[];
  try {
    rows = await fetchAllMarkets(devnet);
  } catch (err) {
    console.warn(
      `[markets-indexer] fetchAllMarkets failed: ${(err as Error).message}`,
    );
    return { fetched: 0, upserted: 0, skipped: 0, failed: 0 };
  }

  let upserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    let projected: IndexedRow | null;
    try {
      projected = projectMarket(row);
    } catch (err) {
      failed++;
      console.warn(
        `[markets-indexer] project ${row.publicKey.toBase58().slice(0, 12)}… failed: ${(err as Error).message}`,
      );
      continue;
    }
    if (!projected) {
      skipped++;
      continue;
    }
    try {
      await upsertMarket(projected);
      upserted++;
    } catch (err) {
      failed++;
      console.warn(
        `[markets-indexer] upsert ${projected.marketPda.slice(0, 12)}… failed: ${(err as Error).message}`,
      );
    }
  }

  return { fetched: rows.length, upserted, skipped, failed };
}
