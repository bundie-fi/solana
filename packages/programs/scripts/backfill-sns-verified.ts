#!/usr/bin/env -S tsx
/**
 * backfill-sns-verified.ts — re-check on-chain SNS ownership for agents
 * that registered before the SNS verification step shipped.
 *
 * Pre-2026-05-02, the agents.ts registration route did not verify that
 * the wallet claiming `<sub>.bundie.sol` actually owns the subdomain on
 * mainnet — every row was inserted with `sns_verified = false`. After
 * verification landed, the column flips to `true` ONLY at registration
 * time. Existing user-registered agents (yudhish-agent, junheng-agent,
 * ycccc) need a one-shot re-check to flip the bit if the on-chain proof
 * agrees with the wallet that registered them.
 *
 * The script:
 *   1. SELECTs agents WHERE sns_verified = false AND sns LIKE '%.bundie.sol'
 *      (the LIKE filter excludes bootstrap agents whose `sns` is a
 *      synthetic identifier — see seed-bootstrap-agents.ts).
 *   2. For each, strips the `.bundie.sol` suffix and calls
 *      `resolveSnsOwner(mainnetConn, sub)` from packages/backend.
 *   3. If the resolved owner matches the agent's `owner_wallet`, flips
 *      sns_verified to true. Else leaves it false.
 *
 * Default behaviour is dry-run: prints a per-agent table with the resolved
 * owner, expected owner, match flag, and would-be action; no DB writes.
 * Pass `--confirm` to apply the UPDATEs.
 *
 * Usage:
 *   DATABASE_URL=... MAINNET_RPC_URL=... tsx packages/programs/scripts/backfill-sns-verified.ts
 *   DATABASE_URL=... MAINNET_RPC_URL=... tsx packages/programs/scripts/backfill-sns-verified.ts --confirm
 */
import { Pool } from "pg";
import { Connection } from "@solana/web3.js";
import { resolveSnsOwner } from "../../backend/src/lib/sns-verify.js";

interface CliArgs {
  confirm: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { confirm: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--confirm") args.confirm = true;
    else if (a === "-h" || a === "--help") {
      console.log(
        "usage: backfill-sns-verified.ts [--confirm]\n" +
          "  default: dry-run, prints resolved vs expected owners and exits.\n" +
          "  --confirm:  apply UPDATEs for agents whose chain owner matches owner_wallet.",
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

interface AgentRow {
  sns: string;
  owner_wallet: string;
  display_name: string | null;
}

async function main(): Promise<void> {
  const cli = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }

  // SNS lives on mainnet only — devnet has no NameRegistry data. Fall back
  // to the public mainnet RPC if the operator hasn't supplied a private
  // endpoint; this script makes O(N) requests where N is the number of
  // unverified user-registered agents (currently 3), well under any
  // public-RPC rate limit.
  const mainnetRpc =
    process.env.MAINNET_RPC_URL ??
    process.env.MAINNET_RPC ??
    "https://api.mainnet-beta.solana.com";
  const mainnetConn = new Connection(mainnetRpc, "confirmed");

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes("railway.internal")
      ? false
      : { rejectUnauthorized: false },
  });

  try {
    const list = await pool.query<AgentRow>(
      `SELECT sns, owner_wallet, display_name
         FROM agents
         WHERE sns_verified = false
           AND sns LIKE '%.bundie.sol'
         ORDER BY created_at ASC`,
    );

    if (list.rows.length === 0) {
      console.log(
        "No matching agents (sns_verified=false AND sns LIKE '%.bundie.sol'). Nothing to do.",
      );
      return;
    }

    console.log(
      `Re-checking ${list.rows.length} unverified user-registered agent(s) against mainnet SNS:`,
    );
    console.log(`  RPC: ${mainnetRpc}`);
    console.log("");
    console.log(
      "  " +
        ["sns", "resolved_owner", "expected_owner", "match", "action"]
          .map((h, i) => h.padEnd([32, 46, 46, 7, 12][i]))
          .join(" "),
    );
    console.log("  " + "-".repeat(140));

    const toFlip: string[] = [];
    for (const r of list.rows) {
      const sub = r.sns.replace(/\.bundie\.sol$/, "");
      const resolved = await resolveSnsOwner(mainnetConn, sub);
      const match = resolved !== null && resolved === r.owner_wallet;
      const action = match
        ? cli.confirm
          ? "FLIP -> true"
          : "would flip"
        : resolved === null
          ? "skip (unresolved)"
          : "skip (mismatch)";
      console.log(
        "  " +
          [
            r.sns.padEnd(32),
            (resolved ?? "(null)").padEnd(46),
            r.owner_wallet.padEnd(46),
            (match ? "yes" : "no").padEnd(7),
            action.padEnd(12),
          ].join(" "),
      );
      if (match) toFlip.push(r.sns);
    }
    console.log("");

    if (toFlip.length === 0) {
      console.log(
        "No agents had matching on-chain ownership. Nothing to flip.",
      );
      return;
    }

    if (!cli.confirm) {
      console.log(
        `Dry-run complete. ${toFlip.length} agent(s) would flip to sns_verified=true. Re-run with --confirm to apply.`,
      );
      return;
    }

    const update = await pool.query(
      `UPDATE agents
         SET sns_verified = true
         WHERE sns = ANY($1::text[])`,
      [toFlip],
    );
    console.log(`Updated ${update.rowCount} agent(s) → sns_verified = true.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[backfill-sns-verified] fatal:", (err as Error).stack || err);
  process.exit(1);
});
