/**
 * seed-fresh-markets.ts — one-shot creator that bypasses the brain.
 *
 * Why: Qwen-7b reliably picks lend_deposit / perp_open / lst_stake
 * (simple-arg schemas) over create_market (6+ args). Net result is
 * ~1 new market per day, which leaves the discover surface stale.
 *
 * This script signs as each registered agent's keypair (pulled from
 * agents.agent_secret_key in Postgres) and calls create_market_v2
 * directly with reasonable defaults across all three kinds:
 *   kind=1 NavTarget   — "Will <agent>'s NAV exceed X bUSD?"
 *   kind=2 Relative    — "Will <agentA> outperform <agentB>?"
 *   kind=3 Drawdown    — "Will <agent>'s NAV drop >X% in N slots?"
 *
 * Insider guard (on-chain): creator MUST NOT equal targetAgentA (or
 * targetAgentB for kind=2). The script picks targets randomly from
 * peer agents and re-rolls if it lands on the creator.
 *
 * Usage (run from inside Railway so DATABASE_URL + RPC env are
 * injected — agent keypairs aren't on the local dev box):
 *   railway run --service bundie-agents \
 *     pnpm --filter @bundie/programs exec tsx \
 *     packages/programs/scripts/seed-fresh-markets.ts
 *
 * Env:
 *   DATABASE_URL     postgres conn string (auto-set by Railway)
 *   SURFPOOL_RPC_URL surfpool RPC (auto-set by Railway), defaults to
 *                    the public Railway hostname for local runs
 *   MARKETS_PER_AGENT default 2 — total = active_agents × this
 */
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { Pool } from "pg";
import {
  createNavMarket,
  bundieVaultPda,
  type NavMarketKind,
} from "./chaos-sim/src/actions/create-nav-market.js";

// Public TCP-proxy URL works from outside Railway; the in-network
// DATABASE_URL has a *.railway.internal hostname that won't resolve
// from a local dev box. Prefer the public URL when both are set.
const DB_URL = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
// Markets land on DEVNET (per chaos-sim action-executor.ts:693
// `connection: args.devnet`), not the surfpool fork. Earlier draft
// of this script pointed at surfpool — markets created there don't
// show up in the web UI, which reads via fetchAllMarkets(devnet).
const RPC_URL =
  process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const MARKETS_PER_AGENT = Number(process.env.MARKETS_PER_AGENT ?? "2");

if (!DB_URL) {
  console.error("DATABASE_URL/DATABASE_PUBLIC_URL not set");
  process.exit(1);
}

interface AgentRow {
  sns: string;
  agent_pubkey: string;
  agent_secret_key: string;
}

function loadKeypair(secret: string): Keypair {
  const trimmed = secret.trim();
  // The DB column stores the keypair JSON exactly as solana-keygen writes
  // it: a JSON array of 64 ints. Same shape across all rows; no base64
  // alternates yet.
  const bytes = Uint8Array.from(JSON.parse(trimmed));
  return Keypair.fromSecretKey(bytes);
}

function pickPeer(creator: PublicKey, agents: Array<{ pk: PublicKey; sns: string }>): { pk: PublicKey; sns: string } {
  // Re-roll until we find one that isn't the creator. With ≥2 agents
  // the loop terminates in expected O(1) calls.
  for (let i = 0; i < 50; i++) {
    const pick = agents[Math.floor(Math.random() * agents.length)]!;
    if (!pick.pk.equals(creator)) return pick;
  }
  throw new Error("could not pick a non-self peer (only 1 agent registered?)");
}

function questionFor(kind: NavMarketKind, creator: string, target: string, target2: string | null, params: { thresholdBusd?: number; drawdownPct?: number; windowMin: number }): string {
  switch (kind) {
    case 1:
      return `Will ${target}'s NAV exceed ${params.thresholdBusd} bUSD in ${params.windowMin}m?`;
    case 2:
      return `Will ${target} outperform ${target2} in ${params.windowMin}m?`;
    case 3:
      return `Will ${target}'s NAV drop ${params.drawdownPct}%+ in ${params.windowMin}m?`;
  }
}

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const pool = new Pool({ connectionString: DB_URL });
  console.log(`RPC: ${RPC_URL}`);
  console.log(`DB connected, querying active agents…`);

  const r = await pool.query<AgentRow>(
    `SELECT sns, agent_pubkey, agent_secret_key
       FROM agents
      WHERE status = 'active' AND agent_secret_key IS NOT NULL`,
  );
  const rows = r.rows;
  console.log(`Active agents with secret_key: ${rows.length}`);
  if (rows.length < 2) {
    console.error("Need ≥ 2 agents for relative-kind markets; aborting.");
    await pool.end();
    process.exit(1);
  }

  const agents = rows.map((row) => ({
    sns: row.sns,
    pk: new PublicKey(row.agent_pubkey),
    kp: loadKeypair(row.agent_secret_key),
  }));

  const currentSlot = await conn.getSlot("confirmed");
  console.log(`current slot: ${currentSlot}`);

  const results: Array<{ creator: string; market: string; question: string; ok: boolean; err?: string }> = [];

  for (const creator of agents) {
    for (let n = 0; n < MARKETS_PER_AGENT; n++) {
      // Round-robin kind selection so each agent emits one of each
      // shape across the run; index 0..2 maps to kind 1/2/3.
      const kind = ((n % 3) + 1) as NavMarketKind;
      const peerA = pickPeer(creator.pk, agents);
      const peerB = kind === 2 ? pickPeer(peerA.pk, agents.filter((a) => !a.pk.equals(peerA.pk))) : null;

      // Resolution window: 30 min in slots (~ 4500 slots @ 400ms/slot).
      // Short enough that recordings can capture resolution within a
      // single recording session if the user wants to stage settlement.
      const windowSlots = 4500;
      const resolutionSlot = BigInt(currentSlot + windowSlots);
      const windowMin = 30;

      // Per-kind params — pick numbers that are realistically reachable
      // so the resolver settles meaningfully.
      const thresholdBusd =
        kind === 1 ? 700 + Math.floor(Math.random() * 300) : undefined; // 700..999 bUSD
      const drawdownPct = kind === 3 ? 1 + Math.floor(Math.random() * 4) : undefined; // 1..4%

      const question = questionFor(
        kind,
        creator.sns,
        peerA.sns,
        peerB?.sns ?? null,
        {
          thresholdBusd: thresholdBusd ?? 0,
          drawdownPct: drawdownPct ?? 0,
          windowMin,
        },
      );

      const marketId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

      try {
        console.log(`[${creator.sns} kind=${kind}] creating: ${question}`);
        const out = await createNavMarket({
          connection: conn,
          creatorVault: creator.kp,
          kind,
          targetAgentA: peerA.pk,
          targetAgentB: peerB?.pk ?? null,
          thresholdLamports:
            kind === 1 ? BigInt(thresholdBusd!) * 1_000_000n : undefined,
          drawdownBps: kind === 3 ? BigInt(drawdownPct!) * 100n : undefined,
          question,
          marketId,
          resolutionSlot,
          // 1.5 bUSD initial subsidy keeps the LMSR from being too thin
          // to bet on but doesn't drain creator capital fast.
          initialSubsidy: 1_500_000n,
          // 1% LMSR fee — same default the brain uses.
          feeBps: 100,
        });
        console.log(`  ✓ market ${out.marketPda.slice(0, 12)}…  tx ${out.signature.slice(0, 12)}…`);
        results.push({ creator: creator.sns, market: out.marketPda, question, ok: true });
      } catch (err) {
        const msg = (err as Error).message.slice(0, 200);
        console.log(`  ✗ failed: ${msg}`);
        results.push({ creator: creator.sns, market: "", question, ok: false, err: msg });
      }
    }
  }

  await pool.end();
  console.log("\n=== summary ===");
  const ok = results.filter((r) => r.ok).length;
  console.log(`succeeded: ${ok} / ${results.length}`);
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  ✗ ${r.creator}: ${r.err}`);
  }
}

main().catch((err) => {
  console.error("fatal:", (err as Error).message);
  process.exit(1);
});
