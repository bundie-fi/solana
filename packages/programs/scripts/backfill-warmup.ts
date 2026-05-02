#!/usr/bin/env -S tsx
/**
 * backfill-warmup.ts — re-trigger warmup for agents that activated before
 * the 2026-05-02 SOL self-heal landed.
 *
 * Pre-fix, the supervisor airdropped 5 SOL on every tick. Agents that
 * activated under that regime have a `warmup_done_at` timestamp but
 * didn't actually receive a one-shot SOL seed at warmup time — their
 * SOL came from the per-tick airdrop that no longer fires. After the
 * supervisor was downgraded to a 0.1 SOL fee buffer, those agents are
 * effectively starved of staking principal.
 *
 * Setting `warmup_done_at = NULL` re-queues them through the warmup
 * loop, which will airdrop 5 SOL + seed strategy USDC.
 *
 * Default behaviour is dry-run: it prints which agents would be
 * affected and exits. Pass `--confirm` to actually run the UPDATE.
 *
 * Targets: agents with status='active' AND warmup_done_at IS NOT NULL.
 * Filters out retired / paused / pending_init by design.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/programs/scripts/backfill-warmup.ts
 *   DATABASE_URL=... tsx packages/programs/scripts/backfill-warmup.ts --confirm
 *   DATABASE_URL=... tsx packages/programs/scripts/backfill-warmup.ts --confirm --before 2026-05-02
 */
import { Pool } from "pg";

interface CliArgs {
  confirm: boolean;
  before?: string;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { confirm: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--confirm") args.confirm = true;
    else if (a === "--before") args.before = process.argv[++i];
    else if (a === "-h" || a === "--help") {
      console.log(
        "usage: backfill-warmup.ts [--confirm] [--before YYYY-MM-DD]\n" +
          "  default: dry-run, prints affected agents and exits.\n" +
          "  --confirm:  run the UPDATE.\n" +
          "  --before:   only target agents created before this date (defaults to all).",
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const cli = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: url,
    ssl: url.includes("railway.internal")
      ? false
      : { rejectUnauthorized: false },
  });

  try {
    const where: string[] = [
      "status = 'active'",
      "warmup_done_at IS NOT NULL",
    ];
    const params: unknown[] = [];
    if (cli.before) {
      where.push(`created_at < $${params.length + 1}`);
      params.push(cli.before);
    }
    const whereSql = where.join(" AND ");

    const list = await pool.query<{
      sns: string;
      display_name: string;
      created_at: Date;
      warmup_done_at: Date;
    }>(
      `SELECT sns, display_name, created_at, warmup_done_at
         FROM agents
         WHERE ${whereSql}
         ORDER BY created_at ASC`,
      params,
    );

    if (list.rows.length === 0) {
      console.log("No matching agents. Nothing to do.");
      return;
    }

    console.log(
      `Affected agents (${list.rows.length})${cli.before ? ` created before ${cli.before}` : ""}:`,
    );
    console.log("");
    console.log(
      "  " +
        ["sns", "display_name", "created_at"]
          .map((h, i) => h.padEnd([32, 28, 20][i]))
          .join(" "),
    );
    console.log("  " + "-".repeat(80));
    for (const r of list.rows) {
      console.log(
        "  " +
          [
            r.sns.padEnd(32),
            (r.display_name ?? "").padEnd(28),
            r.created_at.toISOString().slice(0, 19).padEnd(20),
          ].join(" "),
      );
    }
    console.log("");

    if (!cli.confirm) {
      console.log(
        "Dry-run complete. Re-run with --confirm to set warmup_done_at = NULL.",
      );
      return;
    }

    const update = await pool.query(
      `UPDATE agents
         SET warmup_done_at = NULL
         WHERE ${whereSql}`,
      params,
    );
    console.log(
      `Updated ${update.rowCount} agent(s). The warmup loop will pick them up within ~1s.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[backfill-warmup] fatal:", (err as Error).stack || err);
  process.exit(1);
});
