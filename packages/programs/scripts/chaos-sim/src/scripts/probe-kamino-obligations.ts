/**
 * probe-kamino-obligations.ts — confirm whether `computeKaminoObligationUsd`
 * is inflating NAV by ignoring the borrows side of leveraged obligations.
 *
 * For every status='active' agent in the agents table, this script:
 *   1. Derives the vanilla Kamino obligation PDA against KAMINO_MAIN_MARKET.
 *   2. Fetches the obligation account from SURFPOOL_RPC_URL.
 *   3. Decodes deposits + borrows via the official klend-sdk `Obligation.decode`.
 *   4. Sums each side from the on-chain `marketValueSf` field
 *      (scaled fraction = USD × 2^60) — Kamino's authoritative USD valuation,
 *      already computed by the program against its own oracle.
 *   5. Compares net (deposits - borrows) to the kaminoUsdMicros the NAV
 *      writer last stored in nav_snapshots.
 *
 * If `borrows > 0` for any agent, the current NAV writer is over-counting by
 * exactly that amount (it never reads the borrows array), which directly
 * inflates the platform TVL number. No mutations are made — read-only probe.
 *
 * Run from the chaos-sim daemon environment (Railway / wherever SURFPOOL_RPC_URL
 * and DATABASE_URL are set):
 *
 *   pnpm --filter @bundie/programs exec tsx \
 *     scripts/chaos-sim/src/scripts/probe-kamino-obligations.ts
 *
 * Override SURFPOOL_RPC_URL or limit the cohort with PROBE_AGENT=<sns> for
 * a single-agent run.
 */
import { config as loadDotEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, PublicKey } from "@solana/web3.js";
import { Obligation } from "@kamino-finance/klend-sdk";

import { getPool, dbQuery } from "../lib/db.js";

// Load chaos-sim .env so the operator can run this exactly the same way as
// the daemon (same DATABASE_URL + SURFPOOL_RPC_URL resolution path).
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: join(__dirname, "..", "..", ".env") });

const KLEND_MAINNET_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
);
const KAMINO_MAIN_MARKET = new PublicKey(
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
);

/** Scaled fraction divisor — Kamino stores USD as raw × 2^60. */
const SF_SCALE = 2n ** 60n;
const ZERO_PUBKEY = "11111111111111111111111111111111";

/**
 * Mirrors `vanillaObligationPda` in commit-nav-helper.ts so the probe stays
 * standalone if that helper's signature ever changes.
 */
function vanillaObligationPda(market: PublicKey, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([0]), // tag
      Buffer.from([0]), // id
      user.toBuffer(),
      market.toBuffer(),
      PublicKey.default.toBuffer(),
      PublicKey.default.toBuffer(),
    ],
    KLEND_MAINNET_PROGRAM_ID,
  );
  return pda;
}

/** BN (scaled fraction) → USD float, via bigint to avoid BN.js precision loss. */
function sfToUsd(sf: { toString(): string }): number {
  const raw = BigInt(sf.toString());
  // Scale to micro-USD before bigint→Number to preserve sub-cent precision.
  const micro = (raw * 1_000_000n) / SF_SCALE;
  return Number(micro) / 1_000_000;
}

interface AgentRow {
  sns: string;
  agent_pubkey: string;
  nav_lamports: string | null;
  kamino_micros: string | null;
}

async function loadActiveAgentsWithNav(filterSns?: string): Promise<AgentRow[]> {
  // Pull the latest nav snapshot per agent so we can compare to the live NAV
  // writer's view — DISTINCT ON mirrors what the /api/stats route does.
  const params: unknown[] = [];
  let snsFilter = "";
  if (filterSns) {
    params.push(filterSns);
    snsFilter = `AND a.sns = $${params.length}`;
  }
  const r = await dbQuery<AgentRow>(
    `SELECT a.sns,
            a.agent_pubkey,
            latest.nav_lamports::text       AS nav_lamports,
            latest.kamino_usd_micros::text  AS kamino_micros
       FROM agents a
       LEFT JOIN LATERAL (
         SELECT n.nav_lamports,
                n.kamino_usd_micros
           FROM nav_snapshots n
          WHERE n.agent_sns = a.sns
          ORDER BY n.ts DESC
          LIMIT 1
       ) latest ON TRUE
      WHERE a.status = 'active'
        ${snsFilter}
      ORDER BY a.sns`,
    params,
  );
  return r?.rows ?? [];
}

async function main() {
  const surfpoolUrl =
    process.env.SURFPOOL_RPC_URL ?? process.env.MAINNET_RPC_URL;
  if (!surfpoolUrl) {
    console.error(
      "FATAL: set SURFPOOL_RPC_URL (or MAINNET_RPC_URL) to the fork RPC the daemon uses.",
    );
    process.exit(1);
  }
  if (!getPool()) {
    console.error("FATAL: DATABASE_URL not set.");
    process.exit(1);
  }

  const conn = new Connection(surfpoolUrl, "confirmed");
  const filter = process.env.PROBE_AGENT?.trim() || undefined;
  const agents = await loadActiveAgentsWithNav(filter);
  if (agents.length === 0) {
    console.log("no active agents matched the filter.");
    return;
  }

  console.log(
    `probe-kamino-obligations — surfpool ${surfpoolUrl.replace(
      /api_key=[^&]+/g,
      "api_key=<redacted>",
    )}`,
  );
  console.log(`market: ${KAMINO_MAIN_MARKET.toBase58()}`);
  console.log(`klend:  ${KLEND_MAINNET_PROGRAM_ID.toBase58()}`);
  console.log("");

  let totalReportedKaminoUsd = 0;
  let totalRealKaminoUsd = 0;
  let totalBorrowUsd = 0;
  const inflated: string[] = [];

  for (const a of agents) {
    const authority = new PublicKey(a.agent_pubkey);
    const pda = vanillaObligationPda(KAMINO_MAIN_MARKET, authority);
    let info;
    try {
      info = await conn.getAccountInfo(pda, "confirmed");
    } catch (err) {
      console.log(`${a.sns}: RPC error fetching ${pda.toBase58()}: ${(err as Error).message}`);
      continue;
    }

    const reportedKaminoUsd =
      a.kamino_micros !== null ? Number(BigInt(a.kamino_micros)) / 1_000_000 : 0;
    totalReportedKaminoUsd += reportedKaminoUsd;

    if (!info) {
      // No obligation = agent has never deposited to vanilla market. Reported
      // kamino_micros should be 0 for these unless the SDK is reading a
      // different obligation type (Multiply, JLP) elsewhere.
      console.log(
        `${a.sns.padEnd(30)} obligation=NONE  reported_kamino=$${reportedKaminoUsd.toFixed(2)}`,
      );
      continue;
    }

    let obl;
    try {
      obl = Obligation.decode(info.data);
    } catch (err) {
      console.log(
        `${a.sns.padEnd(30)} DECODE FAILED (${info.data.length}B): ${(err as Error).message}`,
      );
      continue;
    }

    const deposits = obl.deposits.filter(
      (d) =>
        String(d.depositReserve) !== ZERO_PUBKEY &&
        !d.depositedAmount.isZero(),
    );
    const borrows = obl.borrows.filter(
      (b) =>
        String(b.borrowReserve) !== ZERO_PUBKEY &&
        !b.borrowedAmountSf.isZero(),
    );

    const depositsUsd = deposits.reduce(
      (s, d) => s + sfToUsd(d.marketValueSf),
      0,
    );
    const borrowsUsd = borrows.reduce(
      (s, b) => s + sfToUsd(b.marketValueSf),
      0,
    );
    const netUsd = depositsUsd - borrowsUsd;

    totalRealKaminoUsd += netUsd;
    totalBorrowUsd += borrowsUsd;

    const flag = borrowsUsd > 0.5 ? " *INFLATED*" : "";
    if (borrowsUsd > 0.5) inflated.push(a.sns);

    console.log(
      `${a.sns.padEnd(30)} pda=${pda.toBase58().slice(0, 8)}…  ` +
        `deposits=$${depositsUsd.toFixed(2).padStart(9)}  ` +
        `borrows=$${borrowsUsd.toFixed(2).padStart(9)}  ` +
        `net=$${netUsd.toFixed(2).padStart(9)}  ` +
        `reported=$${reportedKaminoUsd.toFixed(2).padStart(9)}${flag}`,
    );

    // Always enumerate deposits + borrows so we can see exactly which reserve
    // each entry sits in — useful when the NAV writer's number disagrees with
    // the SDK's `marketValueSf` (e.g. byte-offset drift in the hand-rolled
    // decoder, or a reserve that's missing from KAMINO_RESERVES_FOR_NAV).
    for (const d of deposits) {
      console.log(
        `    deposit reserve=${String(d.depositReserve).slice(0, 8)}…  ` +
          `cToken_base=${d.depositedAmount.toString()}  ` +
          `marketValue=$${sfToUsd(d.marketValueSf).toFixed(2)}`,
      );
    }
    for (const b of borrows) {
      const borrowedSf = BigInt(b.borrowedAmountSf.toString());
      const borrowedLiq = borrowedSf / SF_SCALE; // liquidity base units
      console.log(
        `    borrow  reserve=${String(b.borrowReserve).slice(0, 8)}…  ` +
          `borrowed_liq_base=${borrowedLiq}  ` +
          `marketValue=$${sfToUsd(b.marketValueSf).toFixed(2)}`,
      );
    }
  }

  console.log("");
  console.log("─── Aggregate ─────────────────────────────────────────────");
  console.log(
    `reported kamino sum:  $${totalReportedKaminoUsd.toFixed(2)} (from nav_snapshots.components.kaminoUsdMicros)`,
  );
  console.log(
    `on-chain deposits:    $${(totalRealKaminoUsd + totalBorrowUsd).toFixed(2)}`,
  );
  console.log(`on-chain borrows:     $${totalBorrowUsd.toFixed(2)}`);
  console.log(
    `on-chain NET (truth): $${totalRealKaminoUsd.toFixed(2)}  ← what NAV should report`,
  );
  console.log(
    `inflation:            $${(totalReportedKaminoUsd - totalRealKaminoUsd).toFixed(2)}  (reported − truth)`,
  );
  if (inflated.length) {
    console.log(`affected agents:      ${inflated.join(", ")}`);
  } else {
    console.log("affected agents:      (none — no borrows found)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("probe failed:", err);
    process.exit(1);
  });
