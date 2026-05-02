#!/usr/bin/env -S tsx
/**
 * run-agent-daemon.ts — chaos-sim daemon entrypoint.
 *
 * Two operating modes, both Postgres-backed:
 *
 *   1. **Supervisor mode** (no `--agent` flag, default): polls the `agents`
 *      table every POLL_INTERVAL_MS and ticks every active agent in parallel.
 *      This is the Railway-deployed worker.
 *
 *   2. **Single-agent dev mode** (`--agent <sns> [--once]`): fetches one row
 *      from the same `agents` table and ticks just that agent. Used for
 *      hand-running ticks during local development.
 *
 * The daemon fails fast if REDPILL_API_KEY or ZERION_API_KEY is missing —
 * the error points at the chaos-sim .env. SURFPOOL_RPC_URL / DEVNET_RPC_URL
 * are optional overrides.
 *
 * Each tick still requires a local Keypair (the existing `commit_nav` and
 * action-executor code signs directly). The keypair is loaded from
 * `keys/<short>-vault.json` where `<short>` is the first label of the SNS
 * (e.g. `alice` for `alice.bundie.sol`). The backend's create-agent route
 * is expected to write that file during provisioning.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

import { runTick, type PeerAgent } from "./agents/shared-tick.js";
import { logActivity } from "./lib/activity-log.js";
import {
  loadActiveAgents,
  logAgentAction,
  logSkippedAgent,
  type ActiveAgent,
} from "./lib/agents-source.js";
import { isSurfpoolReachable } from "./lib/action-executor.js";
import { warmupLoop } from "./lib/warmup.js";
import {
  fetchResolvableCandidates,
  runResolverPass,
} from "./lib/auto-resolver.js";
import { runMarketsIndexerPass } from "./lib/markets-indexer.js";
import { prewarmZetaExchange } from "./lib/zeta-execute.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAOS_DIR = join(__dirname, "..");

// ─── .env loading ──────────────────────────────────────────────────────────
// Load the chaos-sim .env first (required for REDPILL + ZERION keys). A
// missing file is fatal because the daemon can't reason without it.
const DOTENV_PATH = join(CHAOS_DIR, ".env");
loadDotEnv({ path: DOTENV_PATH });

// 15s is the sweet spot for "agent feels alive seconds after I register"
// without adding meaningful RPC pressure. Each tick already fans out
// in parallel via Promise.all, so cycle time is bounded by the slowest
// per-agent tick (~10–20s on the brain LLM call), not the interval.
// Override via CHAOS_SIM_POLL_INTERVAL_MS for local dev / load tests.
const POLL_INTERVAL_MS = Number(process.env.CHAOS_SIM_POLL_INTERVAL_MS ?? 15_000);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    console.error(
      `\n[run-agent-daemon] MISSING ENV: ${name}\n` +
        `  Add it to: ${DOTENV_PATH}\n` +
        `  Example:   ${name}=...\n`,
    );
    process.exit(1);
  }
  return v;
}

// ─── CLI args ──────────────────────────────────────────────────────────────

interface CliArgs {
  agent: string; // empty → supervisor mode
  once: boolean;
  intervalMs: number;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let agent = "";
  let once = false;
  let intervalMs = POLL_INTERVAL_MS;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agent") {
      agent = argv[++i] ?? "";
    } else if (a === "--once") {
      once = true;
    } else if (a === "--interval") {
      intervalMs = Number(argv[++i] ?? POLL_INTERVAL_MS);
    } else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return { agent, once, intervalMs };
}

function printHelp(): void {
  console.error(
    "usage:\n" +
      "  run-agent-daemon.ts                                          # supervisor mode (poll DB for all active agents)\n" +
      "  run-agent-daemon.ts --agent <sns> [--once] [--interval ms]   # single-agent dev mode (one DB row)",
  );
}

/**
 * Accept both short ("alice.bundie") and full ("alice.bundie.sol") forms
 * for the --agent CLI flag.
 */
function normalizeAgentSns(input: string): string {
  return input.endsWith(".sol") ? input : `${input}.sol`;
}

// ─── Peer discovery ────────────────────────────────────────────────────────

function loadPeers(): PeerAgent[] {
  const subdomainsPath = join(CHAOS_DIR, "keys", "agent-subdomains.json");
  if (!existsSync(subdomainsPath)) return [];
  try {
    const j = JSON.parse(readFileSync(subdomainsPath, "utf8"));
    const out: PeerAgent[] = [];
    for (const [name, info] of Object.entries<{ vaultPubkey?: string }>(
      j.agents ?? {},
    )) {
      if (!info?.vaultPubkey) continue;
      try {
        out.push({ name, pubkey: new PublicKey(info.vaultPubkey) });
      } catch {
        // skip bad entries
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Keypair loading ──────────────────────────────────────────────────────

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ─── Tick descriptor (unified shape for legacy + Supabase agents) ──────────

interface TickTarget {
  sns: string;
  walletName: string;
  kp: Keypair;
  brainPath: string;
  policyPath: string;
  /** Vault PDA (devnet) — used to derive treasury_ata for the bUSD
   *  performance-sync after each commit_nav. Undefined for legacy
   *  hardcoded agents that pre-date the registry. */
  vaultPda?: PublicKey;
  /** User's bUSD seed in base units. Same caveat as vaultPda. */
  seedBaseUnits?: bigint;
}

/**
 * Resolve a Supabase agent to a TickTarget. Returns null if no local keypair
 * is available (the operator must seed `keys/<sns>-vault.json` separately —
 * Phase L's backend route should write it during provisioning).
 */
function resolveSupabaseAgent(agent: ActiveAgent): TickTarget | null {
  const shortName = agent.sns.split(".")[0];
  const keyPath = join(CHAOS_DIR, "keys", `${shortName}-vault.json`);
  if (!existsSync(keyPath)) {
    console.warn(
      `[supervisor] skipping ${agent.sns}: missing local keypair at ${keyPath}\n` +
        `  (Phase L backend route should write this file during provisioning)`,
    );
    logSkippedAgent({
      agentSns: agent.sns,
      actionType: "skipped_no_keypair",
      reasoning: `Daemon cannot tick: missing local keypair at ${keyPath}`,
    }).catch(() => {});
    return null;
  }
  let kp: Keypair;
  try {
    kp = loadKeypair(keyPath);
  } catch (e) {
    const msg = (e as Error).message;
    console.warn(
      `[supervisor] skipping ${agent.sns}: failed to load keypair: ${msg}`,
    );
    logSkippedAgent({
      agentSns: agent.sns,
      actionType: "skipped_no_keypair",
      reasoning: `Daemon cannot tick: failed to load keypair (${msg})`,
    }).catch(() => {});
    return null;
  }
  // Sanity check: the keypair pubkey must match Supabase's agent_pubkey.
  if (kp.publicKey.toBase58() !== agent.agentPubkey) {
    console.warn(
      `[supervisor] skipping ${agent.sns}: keypair pubkey ${kp.publicKey.toBase58()} ` +
        `does not match Supabase agent_pubkey ${agent.agentPubkey}`,
    );
    logSkippedAgent({
      agentSns: agent.sns,
      actionType: "skipped_pubkey_mismatch",
      reasoning:
        `Daemon cannot tick: local keypair pubkey ${kp.publicKey.toBase58()} ` +
        `does not match Supabase agent_pubkey ${agent.agentPubkey}`,
    }).catch(() => {});
    return null;
  }
  return {
    sns: agent.sns,
    walletName: `bundie/${shortName}`,
    kp,
    brainPath: agent.brainMdPath,
    policyPath: agent.policiesPath,
    vaultPda: new PublicKey(agent.vaultPda),
    seedBaseUnits: agent.seedAmountBaseUnits,
  };
}

// ─── Tick driver ───────────────────────────────────────────────────────────

interface TickContext {
  surfpool: Connection;
  /** Live mainnet RPC threaded into the NAV-pricing path so Pyth reads
   *  stay fresh. Surfpool's Pyth accounts are frozen at fork-creation
   *  time, so without a separate live RPC, NAV mis-prices SOL/mSOL by
   *  whatever mainnet has moved since the fork was spun up. Defaults to
   *  the surfpool connection when `MAINNET_RPC_URL` is unset (legacy
   *  behaviour — every other read still uses `surfpool`). */
  mainnet: Connection;
  devnet: Connection;
  peers: PeerAgent[];
  /** bUSD mint authority + mint pubkey, loaded once at supervisor
   *  startup. Used to mint additional bUSD into each agent's treasury
   *  after commit_nav so the on-chain treasury balance scales with the
   *  agent's NAV growth. Undefined when the daemon doesn't have access
   *  to the secret (local dev without env set) — the sync is then
   *  silently skipped. */
  busdMintAuthority?: Keypair;
  busdMintPubkey?: PublicKey;
}

const SURFPOOL_TARGET_SOL = 0.1;
const SURFPOOL_AIRDROP_LAMPORTS = SURFPOOL_TARGET_SOL * 1_000_000_000;

/**
 * Per-tick fee buffer maintenance — NOT a staking seed. Keeps the agent's
 * SOL above a tiny floor (~0.05 SOL) so transactions can pay their fees,
 * topping back up to ~0.1 SOL when needed. The staking principal (~5 SOL)
 * is seeded ONCE by the warmup loop (see warmup.ts), gated by
 * `agents.warmup_done_at`. Auto-refilling staking-amount SOL here would
 * mask deployed positions: an agent that staked 5 SOL into Marinade would
 * have its wallet topped back to 5 SOL every tick, and the brain — seeing
 * fresh SOL — would re-stake, in a loop. State persistence requires the
 * agent's surfpool SOL balance to genuinely deplete as capital is deployed.
 *
 * Implementation note: surfpool's signature-confirmation polling is slow
 * (~30s timeout from `confirmTransaction`) even though the airdrop lands
 * within ~1s. So we send the airdrop, poll balance directly for up to 10s,
 * and bail out as soon as it lands. No tx confirmation required.
 *
 * Fork-reset recovery: if surfpool's state is wiped (Railway redeploy,
 * etc.), agents need their staking principal re-seeded. That is an
 * explicit operator action: `UPDATE agents SET warmup_done_at = NULL`
 * re-triggers the warmup loop's full SOL+USDC seed pass.
 *
 * No-op if balance ≥ 0.05 SOL (cheap re-runs across daemon restarts).
 */
async function ensureSurfpoolFunded(
  surfpool: Connection,
  kp: Keypair,
): Promise<void> {
  const initial = await surfpool.getBalance(kp.publicKey, "confirmed");
  if (initial >= 50_000_000) {
    console.log(`[daemon] surfpool fee buffer: ${(initial / 1e9).toFixed(3)} SOL — sufficient`);
    return;
  }
  console.log(`[daemon] surfpool fee buffer ${(initial / 1e9).toFixed(3)} SOL < 0.05 — topping up to ${SURFPOOL_TARGET_SOL} SOL`);
  await surfpool.requestAirdrop(kp.publicKey, SURFPOOL_AIRDROP_LAMPORTS);
  // Poll balance directly — the airdrop lands fast, but signature confirmation
  // can take >30s on a fresh surfpool fork.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const after = await surfpool.getBalance(kp.publicKey, "confirmed");
    if (after > initial) {
      console.log(`[daemon] surfpool balance now ${(after / 1e9).toFixed(3)} SOL (after ${i + 1}s)`);
      return;
    }
  }
  console.warn(`[daemon] surfpool airdrop did not land within 10s — will retry next tick`);
}

async function runTickForAgent(
  target: TickTarget,
  ctx: TickContext,
  cyclePeers?: PeerAgent[],
): Promise<void> {
  // Per-tick fee-buffer check ONLY. Cheap when balance ≥ 0.05 SOL (single
  // getBalance call → early return). Tops up to ~0.1 SOL so the agent can
  // pay tx fees — staking principal is NOT refilled here (see warmup.ts
  // for the one-shot 5 SOL seed). Auto-refilling staking-amount SOL would
  // mask deployed positions: an agent that staked 5 SOL into Marinade
  // would have its wallet topped back to 5 SOL every tick, and the brain
  // — seeing fresh SOL — would re-stake, in a loop.
  // ensureSurfpoolFunded swallows its own errors so a transient RPC blip
  // can't kill the tick.
  await ensureSurfpoolFunded(ctx.surfpool, target.kp).catch((e) => {
    console.warn(
      `[${target.sns}] ensureSurfpoolFunded skipped: ${(e as Error).message}`,
    );
  });

  // No per-tick USDC seed. Initial seeding is owned by the warmup loop
  // (see warmup.ts — one-shot per agent, gated by agents.warmup_done_at).
  // Auto-refilling here previously masked deployed positions: an agent
  // that lent its 50 USDC on Kamino would have its ATA topped back to 50
  // every tick, and the brain — seeing fresh USDC — would re-lend, in a
  // loop. State persistence requires the agent's surfpool USDC ATA to
  // genuinely deplete as capital is deployed.
  //
  // Fork-reset recovery: if surfpool's state is wiped (Railway redeploy,
  // etc.), agents need re-seeding. That is now an explicit operator
  // action: `UPDATE agents SET warmup_done_at = NULL` re-triggers the
  // warmup loop's seed + first-action pass. Surfacing fork resets as a
  // visible event is intentional — they are state loss, not noise.

  // Peer discovery: prefer the supervisor-provided cycle list (built from
  // `agents.status='active'` so wizard-created agents see each other), fall
  // back to the static loadPeers() snapshot for single-agent dev mode.
  // Always exclude self so the brain doesn't try to bet on its own NAV.
  const selfPubkey = target.kp.publicKey.toBase58();
  const peers = (cyclePeers ?? ctx.peers).filter(
    (p) => p.pubkey.toBase58() !== selfPubkey,
  );

  await runTick({
    agentName: target.sns,
    walletName: target.walletName,
    kp: target.kp,
    brainPromptPath: target.brainPath,
    policyPath: target.policyPath,
    surfpool: ctx.surfpool,
    mainnet: ctx.mainnet,
    devnet: ctx.devnet,
    peers,
    busdMintAuthority: ctx.busdMintAuthority,
    busdMintPubkey: ctx.busdMintPubkey,
    vaultPda: target.vaultPda,
    seedBaseUnits: target.seedBaseUnits,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Supervisor (Supabase-poll) loop ───────────────────────────────────────

async function supervisorLoop(ctx: TickContext, intervalMs: number): Promise<void> {
  let stop = false;
  const onSig = () => {
    console.log("\n[supervisor] received signal — stopping after current cycle");
    stop = true;
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  // Exponential backoff state for transient Supabase outages — caps at 10min
  // so the supervisor doesn't hammer Supabase during sustained downtime, and
  // recovers cleanly once the next call succeeds.
  let consecutiveFailures = 0;
  const BASE_INTERVAL_MS = intervalMs;
  const MAX_INTERVAL_MS = 10 * 60_000;

  while (!stop) {
    let supabaseAgents: ActiveAgent[];
    try {
      supabaseAgents = await loadActiveAgents();
      if (consecutiveFailures > 0) {
        console.log(
          `[supervisor] Supabase recovered after ${consecutiveFailures} failure(s)`,
        );
        consecutiveFailures = 0;
      }
    } catch (e) {
      consecutiveFailures++;
      const backoff = Math.min(
        BASE_INTERVAL_MS * Math.pow(2, consecutiveFailures - 1),
        MAX_INTERVAL_MS,
      );
      console.error(
        `[supervisor] loadActiveAgents failed (attempt ${consecutiveFailures}, backing off ${backoff}ms):`,
        (e as Error).message,
      );
      await sleep(backoff);
      continue;
    }

    // Resolve Postgres agents to TickTargets (skip those missing local keys).
    // The DB is the sole source of truth — including the alice/bob/charlie
    // demo agents.
    const targets = supabaseAgents
      .map(resolveSupabaseAgent)
      .filter((t): t is TickTarget => t !== null);

    if (targets.length === 0) {
      console.log(
        `[supervisor] no active agents — sleeping ${intervalMs / 1000}s`,
      );
      await sleep(intervalMs);
      continue;
    }

    console.log(`[supervisor] ticking ${targets.length} agent(s): ${targets.map((t) => t.sns).join(", ")}`);

    // Dynamic peer list: every active agent in the DB is a potential
    // counterparty for head-to-head markets. Built once per cycle and
    // passed to runTickForAgent which filters out the agent itself.
    // Without this, wizard-created agents only ever see the static
    // alice/bob/charlie peers from agent-subdomains.json — they can't
    // create_market against each other, which kills the demo loop where
    // a freshly-created agent gets challenged by an existing one.
    const cyclePeers: PeerAgent[] = [];
    for (const t of targets) {
      cyclePeers.push({ name: t.sns, pubkey: t.kp.publicKey });
    }

    await Promise.all(
      targets.map((target) =>
        runTickForAgent(target, ctx, cyclePeers)
          // Phase O: per-action logging now happens inside shared-tick.ts so
          // the agent profile timeline is action-grained (not tick-grained).
          // We drop the generic `tick_ok` row here to avoid duplicate noise.
          .catch((err: Error) => {
            console.error(`[${target.sns}] tick failed:`, err.message);
            logActivity({
              agent: target.sns,
              phase: "execute_error",
              stage: "tick",
              error: (err.message ?? String(err)).slice(0, 500),
            });
            // tick_error is still useful: it captures the case where the tick
            // itself crashed before any per-action log could fire.
            return logAgentAction({
              agentSns: target.sns,
              actionType: "tick_error",
              reasoning: String(err.message ?? err),
            }).catch(() => {});
          }),
      ),
    );

    // Auto-resolver keeper: once per cycle, resolve any v2 markets whose
    // resolution_slot has been reached. Cheap when there's nothing to
    // resolve (single getProgramAccounts read + filter). Uses the BUSD
    // mint authority as the resolver because it's already loaded and has
    // SOL on devnet — operator can override with RESOLVER_FUNDING_SECRET.
    if (ctx.busdMintAuthority) {
      try {
        const candidates = await fetchResolvableCandidates(ctx.devnet);
        const slot = await ctx.devnet.getSlot("confirmed");
        const due = candidates.filter((c) => slot >= c.resolutionSlot);
        if (due.length > 0) {
          console.log(
            `[auto-resolver] ${due.length} market(s) past resolution slot — resolving`,
          );
          await runResolverPass(
            { devnet: ctx.devnet, resolverKp: ctx.busdMintAuthority },
            due,
            slot,
          );
        }
      } catch (err) {
        console.warn(
          `[auto-resolver] pass failed: ${(err as Error).message}`,
        );
      }
    }

    // Markets indexer: once per cycle, mirror every on-chain Market into
    // the `markets` table so the home-page stats strip and the discovery
    // feed (`GET /api/markets`) can query Postgres instead of running
    // getProgramAccounts on every request. Best-effort — pass-level
    // errors are caught here, per-row errors are absorbed inside
    // runMarketsIndexerPass.
    try {
      const summary = await runMarketsIndexerPass(ctx.devnet);
      if (summary.fetched > 0) {
        console.log(
          `[markets-indexer] fetched=${summary.fetched} upserted=${summary.upserted} skipped=${summary.skipped} failed=${summary.failed}`,
        );
      }
    } catch (err) {
      console.warn(
        `[markets-indexer] pass failed: ${(err as Error).message}`,
      );
    }

    if (stop) break;
    await sleep(intervalMs);
  }
  console.log("=== supervisor stopped ===");
}

// ─── Single-agent dev mode (--agent <sns>) ─────────────────────────────────

async function singleAgentLoop(
  agentSns: string,
  ctx: TickContext,
  cli: CliArgs,
): Promise<void> {
  const wantSns = normalizeAgentSns(agentSns);
  let agents: ActiveAgent[];
  try {
    agents = await loadActiveAgents();
  } catch (e) {
    console.error(`[daemon] loadActiveAgents failed: ${(e as Error).message}`);
    process.exit(1);
  }
  const found = agents.find((a) => a.sns === wantSns);
  if (!found) {
    console.error(
      `unknown agent: ${agentSns}\n` +
        `active agents in DB: ${agents.map((a) => a.sns).join(", ") || "(none)"}`,
    );
    process.exit(1);
  }
  const target = resolveSupabaseAgent(found);
  if (!target) {
    console.error(`[daemon] cannot resolve agent ${wantSns} — see warnings above`);
    process.exit(1);
  }

  console.log("=== Bundie Agent Daemon — single-agent dev mode ===");
  console.log(`agent:        ${target.sns}`);
  console.log(`vault:        ${target.kp.publicKey.toBase58()}`);
  console.log(`brain:        ${target.brainPath}`);
  console.log(`policy:       ${target.policyPath}`);
  console.log(`peers:        ${ctx.peers.length > 0 ? ctx.peers.map((p) => p.name).join(", ") : "(none discovered)"}`);
  console.log(`mode:         ${cli.once ? "one-shot (--once)" : `loop every ${cli.intervalMs}ms`}`);
  console.log("");

  // Surfpool funding now happens per-tick inside runTickForAgent (so the
  // agent self-heals after a fork reset). The first tick will run the check
  // immediately, which subsumes the previous startup-only airdrop.

  logActivity({
    agent: target.sns,
    phase: "daemon",
    note: "daemon-start",
    mode: cli.once ? "once" : "loop",
    vault: target.kp.publicKey.toBase58(),
  });

  async function doOneTick(): Promise<void> {
    try {
      await runTickForAgent(target!, ctx);
    } catch (err) {
      const e = err as Error;
      console.error(`[daemon] tick failed: ${e.message}`);
      logActivity({
        agent: target!.sns,
        phase: "execute_error",
        stage: "tick",
        error: e.message.slice(0, 500),
      });
    }
  }

  if (cli.once) {
    await doOneTick();
    console.log("\n=== tick complete (--once) — exiting ===");
    return;
  }

  let stop = false;
  const onSig = () => {
    console.log("\n[daemon] received signal — stopping after current tick");
    stop = true;
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  while (!stop) {
    await doOneTick();
    if (stop) break;
    await sleep(cli.intervalMs);
  }
  console.log("=== daemon stopped ===");
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseArgs();

  // Required envs — fail fast with clear error pointing at .env.
  requireEnv("REDPILL_API_KEY");
  requireEnv("ZERION_API_KEY");

  // SURFPOOL_RPC_URL can point at a local fork OR at a mainnet RPC for rate
  // observation. MAINNET_RPC_URL is accepted as an alias (set on Railway).
  const surfpoolUrl =
    process.env.SURFPOOL_RPC_URL ??
    process.env.MAINNET_RPC_URL ??
    "http://127.0.0.1:8899";
  const devnetUrl = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
  const surfpool = new Connection(surfpoolUrl, "confirmed");
  const devnet = new Connection(devnetUrl, "confirmed");

  // Live mainnet RPC for NAV oracle pricing only. Surfpool's Pyth feed
  // accounts are frozen at fork-creation time, so reading them via the
  // fork makes NAV mis-price SOL/mSOL by whatever mainnet has moved
  // since the fork went up. We point Pyth reads at MAINNET_RPC_URL when
  // available; everything else (token balances, Kamino reserves, Solend
  // obligations) still hits the fork.
  //
  // Fallback: when MAINNET_RPC_URL is unset we reuse `surfpool` so the
  // daemon can still boot in local dev — staleness is the cost.
  const mainnetUrl = process.env.MAINNET_RPC_URL;
  let mainnet: Connection;
  if (mainnetUrl && mainnetUrl !== surfpoolUrl) {
    mainnet = new Connection(mainnetUrl, "confirmed");
    console.log(`[daemon] NAV oracle prices: live mainnet RPC ${mainnetUrl}`);
  } else {
    mainnet = surfpool;
    console.warn(
      "[daemon] MAINNET_RPC_URL not set (or matches SURFPOOL_RPC_URL) — " +
        "Pyth oracle reads will fall back to the surfpool fork; NAV may " +
        "drift from live prices.",
    );
  }

  const peers = loadPeers();

  // bUSD mint authority + mint pubkey for the per-tick treasury-sync.
  // Same envs the backend's faucet route uses. Both must be set together;
  // missing one logs a warning and disables sync (legacy alice/bob/charlie
  // ticks still work, just without the user-treasury bUSD growth).
  let busdMintAuthority: Keypair | undefined;
  let busdMintPubkey: PublicKey | undefined;
  if (process.env.BUSD_MINT_AUTHORITY_SECRET && process.env.BUSD_MINT) {
    try {
      busdMintAuthority = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(process.env.BUSD_MINT_AUTHORITY_SECRET)),
      );
      busdMintPubkey = new PublicKey(process.env.BUSD_MINT);
    } catch (e) {
      console.warn(
        `[supervisor] BUSD_MINT_AUTHORITY_SECRET / BUSD_MINT parse failed: ${(e as Error).message} — treasury-sync disabled`,
      );
    }
  } else {
    console.warn(
      `[supervisor] BUSD_MINT_AUTHORITY_SECRET / BUSD_MINT envs not set — treasury-sync disabled`,
    );
  }

  const ctx: TickContext = {
    surfpool,
    mainnet,
    devnet,
    peers,
    busdMintAuthority,
    busdMintPubkey,
  };

  // ─── Zeta Exchange prewarm ─────────────────────────────────────────────
  // Exchange.load() clones 30+ Zeta program / state / pricing / oracle /
  // perp-market accounts from mainnet on first call. If we leave that
  // lazily-triggered inside openZetaPerp on the FIRST agent's FIRST
  // perp_open, that tick can blow the per-tick budget (the clone storm has
  // been observed at 15-30s). We pull the cost forward here, before the
  // supervisor loop starts ticking agents, so every agent's first perp
  // call is cheap.
  //
  // Gated on `isSurfpoolReachable` so a startup with surfpool down does
  // not block the daemon. The lazy `ensureExchangeLoaded` path inside
  // openZetaPerp / closeZetaPerp will retry on demand once surfpool is
  // back — and after a fork reset that wipes the cloned state, the same
  // lazy path self-heals (the module-level `exchangeLoaded` flag is the
  // only thing that says "skip"; if `Exchange.load()` succeeded once and
  // then surfpool wiped the state, the next perp call will re-fail and
  // the operator can restart the daemon to re-prewarm). We tolerate that
  // operationally — fork resets are rare and the daemon already fails to
  // do useful work during them anyway.
  if (await isSurfpoolReachable(surfpool)) {
    console.log("[daemon] surfpool reachable — prewarming Zeta Exchange (60s budget)");
    try {
      await prewarmZetaExchange(surfpool, 60_000);
    } catch (e) {
      console.warn(
        `[daemon] Zeta prewarm load failed (continuing without prewarm): ${(e as Error).message}`,
      );
    }
  } else {
    console.warn(
      "[daemon] surfpool unreachable at startup — skipping Zeta prewarm; " +
        "lazy path will retry on first perp action",
    );
  }

  // ─── Solend prewarm ───────────────────────────────────────────────────
  // parseLendingMarket + parseReserve hydrate Solend pool/reserve state on
  // first call (~5-15s). Pull the cost forward so the first lend tick
  // doesn't exceed budget. Lazy bootstrap inside depositSolend /
  // withdrawSolend remains the safety net.
  //
  // (MarginFi removed — its SDK doesn't decode current mainnet
  // OracleSetup variants on the fork; see commit history for context.)
  if (await isSurfpoolReachable(surfpool)) {
    console.log("[daemon] surfpool reachable — prewarming Solend (60s budget)");
    try {
      const { prewarmSolendMarket } = await import("./lib/solend-execute.js");
      await prewarmSolendMarket(surfpool, 60_000);
    } catch (e) {
      console.warn(
        `[daemon] Solend prewarm failed (continuing without prewarm): ${(e as Error).message}`,
      );
    }
  } else {
    console.warn(
      "[daemon] surfpool unreachable at startup — skipping Solend prewarm; " +
        "lazy path will retry on first lend action",
    );
  }

  if (cli.agent) {
    await singleAgentLoop(cli.agent, ctx, cli);
    return;
  }

  console.log("=== Bundie Agent Daemon — supervisor mode ===");
  console.log(`poll interval: ${cli.intervalMs}ms`);
  console.log(`surfpool RPC:  ${surfpoolUrl}`);
  console.log(
    `mainnet RPC:   ${mainnetUrl && mainnetUrl !== surfpoolUrl ? mainnetUrl : "(falls back to surfpool — set MAINNET_RPC_URL for fresh Pyth)"}`,
  );
  console.log(`devnet RPC:    ${devnetUrl}`);
  console.log(`peers:         ${peers.length > 0 ? peers.map((p) => p.name).join(", ") : "(none discovered)"}`);
  console.log("");

  // Run the warmup loop in parallel with the supervisor. It polls every
  // 1s for newly-active agents (status='active' AND warmup_done_at IS NULL)
  // and runs a single deterministic action — picked from the agent's own
  // policies.yaml allowlist — so a freshly-created agent has visible
  // surfpool activity within seconds, before the supervisor's slower
  // LLM-driven cycle picks it up. Crash-safe: errors log, the loop never
  // exits.
  let warmupStop = false;
  const warmup = warmupLoop({ surfpool, devnet }, () => warmupStop, 1000);
  warmup.catch((err) =>
    console.error("[warmup] loop crashed:", (err as Error).stack || err),
  );

  try {
    await supervisorLoop(ctx, cli.intervalMs);
  } finally {
    warmupStop = true;
    await warmup.catch(() => {});
  }
}

main().catch((err) => {
  console.error("[daemon] fatal:", (err as Error).stack || err);
  process.exit(1);
});
