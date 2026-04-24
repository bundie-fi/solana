#!/usr/bin/env -S tsx
/**
 * run-agent-daemon.ts — Option X entrypoint.
 *
 * One binary, three agents. The same observe→reason→execute→log tick is
 * driven for alice.bundie / bob.bundie / charlie.bundie; personality is the
 * brain.md system prompt + per-agent policies.yaml allowlist.
 *
 * Usage:
 *   tsx scripts/chaos-sim/src/run-agent-daemon.ts --agent alice.bundie --once
 *   tsx scripts/chaos-sim/src/run-agent-daemon.ts --agent bob.bundie        # loop
 *
 * The daemon fails fast if REDPILL_API_KEY or ZERION_API_KEY is missing —
 * the error points at the chaos-sim .env. SURFPOOL_RPC_URL / DEVNET_RPC_URL
 * are optional overrides.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

import { runTick, type PeerAgent } from "./agents/shared-tick.js";
import { logActivity } from "./lib/activity-log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAOS_DIR = join(__dirname, "..");
const REPO_ROOT = resolve(CHAOS_DIR, "..", "..", "..", "..");

// ─── .env loading ──────────────────────────────────────────────────────────
// Load the chaos-sim .env first (required for REDPILL + ZERION keys). A
// missing file is fatal because the daemon can't reason without it.
const DOTENV_PATH = join(CHAOS_DIR, ".env");
loadDotEnv({ path: DOTENV_PATH });

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
  agent: string;
  once: boolean;
  intervalMs: number;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  let agent = "";
  let once = false;
  let intervalMs = 60_000;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agent") {
      agent = argv[++i] ?? "";
    } else if (a === "--once") {
      once = true;
    } else if (a === "--interval") {
      intervalMs = Number(argv[++i] ?? 60_000);
    } else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  if (!agent) {
    printHelp();
    process.exit(1);
  }
  return { agent, once, intervalMs };
}

function printHelp(): void {
  console.error(
    "usage: run-agent-daemon.ts --agent <alice.bundie|bob.bundie|charlie.bundie> [--once] [--interval ms]",
  );
}

// ─── Agent registry ────────────────────────────────────────────────────────

interface AgentConfig {
  sns: string; // "alice.bundie"
  shortName: string; // "alice"
  keyfile: string; // keys/alice-vault.json
  snsDir: string; // agents/alice.bundie.sol/
  walletName: string; // OWS name, e.g. "bundie/alice"
}

const AGENTS: Record<string, AgentConfig> = {
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

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseArgs();

  const cfg = AGENTS[cli.agent];
  if (!cfg) {
    console.error(
      `unknown agent: ${cli.agent}\n` +
        `known: ${Object.keys(AGENTS).join(", ")}`,
    );
    process.exit(1);
  }

  // Required envs — fail fast with clear error pointing at .env.
  requireEnv("REDPILL_API_KEY");
  requireEnv("ZERION_API_KEY");

  const surfpoolUrl = process.env.SURFPOOL_RPC_URL ?? "http://127.0.0.1:8899";
  const devnetUrl = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
  const surfpool = new Connection(surfpoolUrl, "confirmed");
  const devnet = new Connection(devnetUrl, "confirmed");

  const keyPath = join(CHAOS_DIR, cfg.keyfile);
  if (!existsSync(keyPath)) {
    console.error(`[daemon] missing agent keypair: ${keyPath}`);
    process.exit(1);
  }
  const kp = loadKeypair(keyPath);

  const policyPath = join(REPO_ROOT, cfg.snsDir, "policies.yaml");
  const brainPath = join(REPO_ROOT, cfg.snsDir, "brain.md");
  for (const p of [policyPath, brainPath]) {
    if (!existsSync(p)) {
      console.error(`[daemon] missing ${p}`);
      process.exit(1);
    }
  }

  const peers = loadPeers();

  // Header log — this is the first line of every daemon run.
  console.log("=== Bundie Agent Daemon — Option X ===");
  console.log(`agent:        ${cfg.sns}`);
  console.log(`vault:        ${kp.publicKey.toBase58()}`);
  console.log(`keyfile:      ${keyPath}`);
  console.log(`brain:        ${brainPath}`);
  console.log(`policy:       ${policyPath}`);
  console.log(`surfpool RPC: ${surfpoolUrl}`);
  console.log(`devnet RPC:   ${devnetUrl}`);
  console.log(`peers:        ${peers.length > 0 ? peers.map((p) => p.name).join(", ") : "(none discovered)"}`);
  console.log(`mode:         ${cli.once ? "one-shot (--once)" : `loop every ${cli.intervalMs}ms`}`);
  console.log("");

  logActivity({
    agent: cfg.sns,
    phase: "daemon",
    note: "daemon-start",
    mode: cli.once ? "once" : "loop",
    vault: kp.publicKey.toBase58(),
    surfpoolUrl,
    devnetUrl,
  });

  async function doOneTick(): Promise<void> {
    try {
      await runTick({
        agentName: cfg.sns,
        walletName: cfg.walletName,
        kp,
        brainPromptPath: brainPath,
        policyPath,
        surfpool,
        devnet,
        peers,
      });
    } catch (err) {
      const e = err as Error;
      console.error(`[daemon] tick failed: ${e.message}`);
      logActivity({
        agent: cfg.sns,
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

  // Loop forever. SIGINT / SIGTERM exit cleanly.
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
    await new Promise((r) => setTimeout(r, cli.intervalMs));
  }
  console.log("=== daemon stopped ===");
}

main().catch((err) => {
  console.error("[daemon] fatal:", (err as Error).stack || err);
  process.exit(1);
});
