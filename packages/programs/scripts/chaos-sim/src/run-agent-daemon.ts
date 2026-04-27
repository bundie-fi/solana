#!/usr/bin/env -S tsx
/**
 * run-agent-daemon.ts — Phase N supervisor entrypoint.
 *
 * Two operating modes:
 *
 *   1. **Single-agent dev mode** (`--agent <sns> [--once]`): legacy behaviour.
 *      One process drives one agent's tick loop using the local keypair file.
 *      Used for hand-running ticks against alice/bob/charlie during dev.
 *
 *   2. **Supervisor mode** (no `--agent` flag): polls Supabase for active
 *      agents every POLL_INTERVAL_MS and ticks each one in parallel. This is
 *      the Railway-deployed worker that picks up user-launched agents
 *      provisioned via the Phase L backend route.
 *
 * The daemon fails fast if REDPILL_API_KEY or ZERION_API_KEY is missing —
 * the error points at the chaos-sim .env. SURFPOOL_RPC_URL / DEVNET_RPC_URL
 * are optional overrides.
 *
 * Backward-compat strategy
 * ────────────────────────
 * Each tick still requires a local Keypair (the existing `commit_nav` and
 * action-executor code signs directly — refactoring to Zerion-CLI signing
 * is out of scope for Phase N). For Supabase-loaded agents, we attempt to
 * load `keys/<sns>-vault.json` next to the legacy alice/bob/charlie files;
 * if absent, the agent is skipped with a clear warning. The Phase L backend
 * route is expected to write that key file as part of provisioning.
 *
 * Supervisor mode is **Supabase-only**. If `loadActiveAgents()` returns 0
 * the supervisor logs and idles — there is no hardcoded fallback (the
 * alice/bob/charlie agents have been migrated into the Supabase registry
 * via `seed-legacy-agents`). Single-agent `--agent <sns> --once` dev mode
 * still uses the legacy in-process map for hand-running ticks.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAOS_DIR = join(__dirname, "..");
const REPO_ROOT = resolve(CHAOS_DIR, "..", "..", "..", "..");

// ─── .env loading ──────────────────────────────────────────────────────────
// Load the chaos-sim .env first (required for REDPILL + ZERION keys). A
// missing file is fatal because the daemon can't reason without it.
const DOTENV_PATH = join(CHAOS_DIR, ".env");
loadDotEnv({ path: DOTENV_PATH });

const POLL_INTERVAL_MS = Number(process.env.CHAOS_SIM_POLL_INTERVAL_MS ?? 30_000);

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
      "  run-agent-daemon.ts                                  # supervisor mode (Supabase poll)\n" +
      "  run-agent-daemon.ts --agent <sns> [--once] [--interval ms]   # single-agent dev mode",
  );
}

// ─── Legacy agent registry (fallback when Supabase is empty) ───────────────

interface AgentConfig {
  sns: string; // "alice.bundie"
  shortName: string; // "alice"
  keyfile: string; // keys/alice-vault.json
  snsDir: string; // agents/alice.bundie.sol/
  walletName: string; // OWS name, e.g. "bundie/alice"
}

// Use full .bundie.sol form for `sns` so it matches the Supabase agents.sns
// FK in agent_action_log writes. The CLI accepts both short ("alice.bundie")
// and full ("alice.bundie.sol") forms via `normalizeAgentKey`.
const LEGACY_AGENTS: Record<string, AgentConfig> = {
  "alice.bundie.sol": {
    sns: "alice.bundie.sol",
    shortName: "alice",
    keyfile: "keys/alice-vault.json",
    snsDir: "agents/alice.bundie.sol",
    walletName: "bundie/alice",
  },
  "bob.bundie.sol": {
    sns: "bob.bundie.sol",
    shortName: "bob",
    keyfile: "keys/bob-vault.json",
    snsDir: "agents/bob.bundie.sol",
    walletName: "bundie/bob",
  },
  "charlie.bundie.sol": {
    sns: "charlie.bundie.sol",
    shortName: "charlie",
    keyfile: "keys/charlie-vault.json",
    snsDir: "agents/charlie.bundie.sol",
    walletName: "bundie/charlie",
  },
};

/**
 * Accept both short ("alice.bundie") and full ("alice.bundie.sol") forms on
 * the CLI. Returns the canonical key used by LEGACY_AGENTS (full form).
 */
function normalizeAgentKey(input: string): string {
  if (input in LEGACY_AGENTS) return input;
  const withSuffix = `${input}.sol`;
  if (withSuffix in LEGACY_AGENTS) return withSuffix;
  return input; // unknown — caller will surface the error
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
  };
}

/**
 * Resolve a legacy hardcoded agent to a TickTarget.
 */
function resolveLegacyAgent(cfg: AgentConfig): TickTarget | null {
  const keyPath = join(CHAOS_DIR, cfg.keyfile);
  if (!existsSync(keyPath)) {
    console.warn(`[supervisor] skipping legacy ${cfg.sns}: missing ${keyPath}`);
    return null;
  }
  const policyPath = join(REPO_ROOT, cfg.snsDir, "policies.yaml");
  const brainPath = join(REPO_ROOT, cfg.snsDir, "brain.md");
  for (const p of [policyPath, brainPath]) {
    if (!existsSync(p)) {
      console.warn(`[supervisor] skipping legacy ${cfg.sns}: missing ${p}`);
      return null;
    }
  }
  return {
    sns: cfg.sns,
    walletName: cfg.walletName,
    kp: loadKeypair(keyPath),
    brainPath,
    policyPath,
  };
}

// ─── Tick driver ───────────────────────────────────────────────────────────

interface TickContext {
  surfpool: Connection;
  devnet: Connection;
  peers: PeerAgent[];
}

const SURFPOOL_TARGET_SOL = 5;
const SURFPOOL_AIRDROP_LAMPORTS = SURFPOOL_TARGET_SOL * 1_000_000_000;

/**
 * Ensure the agent's keypair has at least 5 SOL on the surfpool fork. New
 * forks (every Railway redeploy of bundie-surfpool) start with zero state,
 * so the keypair has no SOL until we airdrop. surfpool implements the
 * standard `requestAirdrop` RPC method, which takes effect immediately.
 *
 * Implementation note: surfpool's signature-confirmation polling is slow
 * (~30s timeout from `confirmTransaction`) even though the airdrop lands
 * within ~1s. So we send the airdrop, poll balance directly for up to 10s,
 * and bail out as soon as it lands. No tx confirmation required.
 *
 * No-op if balance ≥ 1 SOL (cheap re-runs across daemon restarts).
 */
async function ensureSurfpoolFunded(
  surfpool: Connection,
  kp: Keypair,
): Promise<void> {
  const initial = await surfpool.getBalance(kp.publicKey, "confirmed");
  if (initial >= 1_000_000_000) {
    console.log(`[daemon] surfpool balance: ${(initial / 1e9).toFixed(3)} SOL — sufficient`);
    return;
  }
  console.log(`[daemon] surfpool balance ${(initial / 1e9).toFixed(3)} SOL < 1 — airdropping ${SURFPOOL_TARGET_SOL} SOL`);
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
): Promise<void> {
  // Per-tick surfpool funding check. Cheap when balance ≥ 1 SOL (single
  // getBalance call → early return). When the surfpool fork resets mid-loop
  // — e.g. on a Railway redeploy of bundie-surfpool — the agent's keypair
  // drops to 0 SOL; this call self-heals on the very next tick instead of
  // waiting for a daemon container restart. ensureSurfpoolFunded swallows
  // its own errors so a transient RPC blip can't kill the tick.
  await ensureSurfpoolFunded(ctx.surfpool, target.kp).catch((e) => {
    console.warn(
      `[${target.sns}] ensureSurfpoolFunded skipped: ${(e as Error).message}`,
    );
  });

  await runTick({
    agentName: target.sns,
    walletName: target.walletName,
    kp: target.kp,
    brainPromptPath: target.brainPath,
    policyPath: target.policyPath,
    surfpool: ctx.surfpool,
    devnet: ctx.devnet,
    peers: ctx.peers,
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

    // Resolve Supabase agents to TickTargets (skip those missing local keys).
    // Supabase is the sole source of truth: there is no hardcoded fallback —
    // the alice/bob/charlie demo agents have been migrated into the registry
    // via the seed-legacy-agents script.
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

    await Promise.all(
      targets.map((target) =>
        runTickForAgent(target, ctx)
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

    if (stop) break;
    await sleep(intervalMs);
  }
  console.log("=== supervisor stopped ===");
}

// ─── Single-agent dev mode (legacy --agent path) ───────────────────────────

async function singleAgentLoop(
  agentSns: string,
  ctx: TickContext,
  cli: CliArgs,
): Promise<void> {
  const key = normalizeAgentKey(agentSns);
  const cfg = LEGACY_AGENTS[key];
  if (!cfg) {
    console.error(
      `unknown agent: ${agentSns}\n` +
        `known: ${Object.keys(LEGACY_AGENTS).join(", ")}`,
    );
    process.exit(1);
  }
  const target = resolveLegacyAgent(cfg);
  if (!target) {
    console.error(`[daemon] cannot resolve legacy agent ${agentSns} — see warnings above`);
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
  const peers = loadPeers();

  const ctx: TickContext = { surfpool, devnet, peers };

  if (cli.agent) {
    await singleAgentLoop(cli.agent, ctx, cli);
    return;
  }

  console.log("=== Bundie Agent Daemon — supervisor mode ===");
  console.log(`poll interval: ${cli.intervalMs}ms`);
  console.log(`surfpool RPC:  ${surfpoolUrl}`);
  console.log(`devnet RPC:    ${devnetUrl}`);
  console.log(`peers:         ${peers.length > 0 ? peers.map((p) => p.name).join(", ") : "(none discovered)"}`);
  console.log("");
  await supervisorLoop(ctx, cli.intervalMs);
}

main().catch((err) => {
  console.error("[daemon] fatal:", (err as Error).stack || err);
  process.exit(1);
});
