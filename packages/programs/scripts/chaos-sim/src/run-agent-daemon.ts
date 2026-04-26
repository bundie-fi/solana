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
 * If `loadActiveAgents()` returns 0 (Supabase creds missing or empty list),
 * supervisor mode falls back to the legacy hardcoded alice/bob/charlie list
 * so local development keeps working without Supabase.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

import { runTick, type PeerAgent } from "./agents/shared-tick.js";
import { logActivity } from "./lib/activity-log.js";
import { loadActiveAgents, logAgentAction, type ActiveAgent } from "./lib/agents-source.js";

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

const LEGACY_AGENTS: Record<string, AgentConfig> = {
  "alice.bundie": {
    sns: "alice.bundie",
    shortName: "alice",
    keyfile: "keys/alice-vault.json",
    snsDir: "agents/alice.bundie.sol",
    walletName: "bundie/alice",
  },
  "bob.bundie": {
    sns: "bob.bundie",
    shortName: "bob",
    keyfile: "keys/bob-vault.json",
    snsDir: "agents/bob.bundie.sol",
    walletName: "bundie/bob",
  },
  "charlie.bundie": {
    sns: "charlie.bundie",
    shortName: "charlie",
    keyfile: "keys/charlie-vault.json",
    snsDir: "agents/charlie.bundie.sol",
    walletName: "bundie/charlie",
  },
};

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
    return null;
  }
  let kp: Keypair;
  try {
    kp = loadKeypair(keyPath);
  } catch (e) {
    console.warn(
      `[supervisor] skipping ${agent.sns}: failed to load keypair: ${(e as Error).message}`,
    );
    return null;
  }
  // Sanity check: the keypair pubkey must match Supabase's agent_pubkey.
  if (kp.publicKey.toBase58() !== agent.agentPubkey) {
    console.warn(
      `[supervisor] skipping ${agent.sns}: keypair pubkey ${kp.publicKey.toBase58()} ` +
        `does not match Supabase agent_pubkey ${agent.agentPubkey}`,
    );
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

async function runTickForAgent(
  target: TickTarget,
  ctx: TickContext,
): Promise<void> {
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

  while (!stop) {
    let supabaseAgents: ActiveAgent[];
    try {
      supabaseAgents = await loadActiveAgents();
    } catch (e) {
      console.error("[supervisor] failed to load agents:", (e as Error).message);
      await sleep(intervalMs);
      continue;
    }

    // Resolve Supabase agents to TickTargets (skip those missing local keys).
    let targets = supabaseAgents
      .map(resolveSupabaseAgent)
      .filter((t): t is TickTarget => t !== null);

    // Backward-compat fallback: if Supabase returned nothing usable, run the
    // legacy hardcoded list so local dev keeps working without Supabase.
    if (targets.length === 0) {
      console.log(
        "[supervisor] no usable Supabase agents — falling back to legacy alice/bob/charlie",
      );
      targets = Object.values(LEGACY_AGENTS)
        .map(resolveLegacyAgent)
        .filter((t): t is TickTarget => t !== null);
    }

    if (targets.length === 0) {
      console.log(
        `[supervisor] no agents available — waiting ${intervalMs / 1000}s`,
      );
      await sleep(intervalMs);
      continue;
    }

    console.log(`[supervisor] ticking ${targets.length} agent(s): ${targets.map((t) => t.sns).join(", ")}`);

    await Promise.all(
      targets.map((target) =>
        runTickForAgent(target, ctx).catch((err: Error) => {
          console.error(`[${target.sns}] tick failed:`, err.message);
          logActivity({
            agent: target.sns,
            phase: "execute_error",
            stage: "tick",
            error: (err.message ?? String(err)).slice(0, 500),
          });
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
  const cfg = LEGACY_AGENTS[agentSns];
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
