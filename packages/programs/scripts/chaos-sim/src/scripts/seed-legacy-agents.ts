#!/usr/bin/env -S tsx
/**
 * seed-legacy-agents.ts — one-time bootstrap that migrates the alice / bob /
 * charlie demo agents into the Supabase `agents` registry as proper rows so
 * they look indistinguishable from user-launched agents in the web UI.
 *
 * For each demo agent the script will (idempotently):
 *   1. Mint $50 bUSD (50_000_000 base units, 6dp) to the agent's wallet ATA
 *      using the local bUSD mint authority.
 *   2. Broadcast `deposit_to_vault(50_000_000)` from the agent (depositor)
 *      into its existing BundieVault treasury_ata. Skipped if the vault
 *      treasury already holds ≥ 50_000_000 base units.
 *   3. INSERT a row into Supabase `agents` describing the agent (sns,
 *      display_name, tagline, emoji, owner_wallet, vault_pda, agent_pubkey,
 *      brain_md, policies_yaml, preset, status='active', seed_amount_busd).
 *      Skipped if a row already exists for the SNS handle.
 *
 * Prerequisites:
 *   - Supabase migrations applied (`agents` table exists). The script does
 *     NOT run migrations.
 *   - bUSD mint exists on devnet (`busd-mint.json` at the repo root, or set
 *     BUSD_MINT + BUSD_MINT_AUTHORITY_SECRET).
 *   - Vaults already initialised via `init-vaults` (see same dir).
 *
 * Run:
 *   pnpm --filter @bundie/programs seed-legacy-agents
 *
 * Idempotent — safe to re-run.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { config as loadDotEnv } from "dotenv";

import {
  PREDICTION_MARKET_PROGRAM_ID,
  bundieVaultPda,
} from "../actions/create-nav-market.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAOS_DIR = join(__dirname, "..", "..");
const REPO_ROOT = join(CHAOS_DIR, "..", "..", "..", "..");

// Load both the chaos-sim .env and the repo-root .env (if present) so this
// script works whether the operator runs it via pnpm from the repo root or
// from the package dir.
loadDotEnv({ path: join(CHAOS_DIR, ".env") });
loadDotEnv({ path: join(REPO_ROOT, ".env") });

// ─── Constants ────────────────────────────────────────────────────────────

const SEED_AMOUNT_BUSD: bigint = 50_000_000n; // $50 in 6-dp base units

interface DemoAgent {
  short: string; // "alice"
  sns: string; // "alice.bundie.sol"
  displayName: string; // "Alice"
  tagline: string;
  emoji: string;
  preset: "balanced" | "aggressive" | "conservative";
  // Filename short-name used by chaos-sim/keys/<short>-vault.json and the
  // off-chain agents/<short>.bundie.sol/ directory.
}

// Personalities derived directly from each agent's brain.md (read in main()).
//   alice   — yield-maximiser / LST rotation       → balanced 🎯
//   bob     — basis trader, risk-averse, patient   → aggressive 🚀
//   charlie — 60/40 conservative balanced          → conservative 🛡️
//
// These map onto the create-agent wizard's preset enum; the daemon does NOT
// vary behaviour by preset (the brain.md is the source of truth) — preset is
// purely a UI hint surfaced on the agent profile / leaderboard.
const DEMO_AGENTS: DemoAgent[] = [
  {
    short: "alice",
    sns: "alice.bundie.sol",
    displayName: "Alice",
    tagline: "LST rotation specialist — chases the better mSOL/SOL rate.",
    emoji: "🎯",
    preset: "balanced",
  },
  {
    short: "bob",
    sns: "bob.bundie.sol",
    displayName: "Bob",
    tagline: "Basis trader — perp funding minus spot lending, patiently.",
    emoji: "🚀",
    preset: "aggressive",
  },
  {
    short: "charlie",
    sns: "charlie.bundie.sol",
    displayName: "Charlie",
    tagline: "Balanced 60/40 allocator — slow-moving, drift-rebalanced.",
    emoji: "🛡️",
    preset: "conservative",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function anchorDiscriminator(fnName: string): Buffer {
  return createHash("sha256")
    .update(`global:${fnName}`)
    .digest()
    .subarray(0, 8);
}

function u64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}

interface BusdMintFile {
  mint: string;
  authority: string;
  /** 64-byte ed25519 secret as a JSON number array. */
  secret: number[];
}

function loadBusdMintInfo(): { mint: PublicKey; authority: Keypair } {
  // Resolution order:
  //   1. BUSD_MINT + BUSD_MINT_AUTHORITY_SECRET env vars (CI / Railway)
  //   2. busd-mint.json at the repo root (developer machines)
  if (process.env.BUSD_MINT && process.env.BUSD_MINT_AUTHORITY_SECRET) {
    const secretRaw = JSON.parse(
      process.env.BUSD_MINT_AUTHORITY_SECRET,
    ) as number[];
    return {
      mint: new PublicKey(process.env.BUSD_MINT),
      authority: Keypair.fromSecretKey(Uint8Array.from(secretRaw)),
    };
  }
  const busdJson = join(REPO_ROOT, "busd-mint.json");
  if (!existsSync(busdJson)) {
    throw new Error(
      `bUSD mint not found. Set BUSD_MINT + BUSD_MINT_AUTHORITY_SECRET, or ` +
        `create ${busdJson} via setup-busd first.`,
    );
  }
  const parsed = JSON.parse(readFileSync(busdJson, "utf8")) as BusdMintFile;
  return {
    mint: new PublicKey(parsed.mint),
    authority: Keypair.fromSecretKey(Uint8Array.from(parsed.secret)),
  };
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) — " +
        "this script requires a service-role key to insert into `agents`.",
    );
  }
  return createClient(url, key);
}

// ─── Per-agent ops ────────────────────────────────────────────────────────

interface SeedResult {
  sns: string;
  mintStatus: "minted" | "skipped" | "failed";
  depositStatus: "deposited" | "skipped" | "failed";
  rowStatus: "inserted" | "skipped" | "failed";
  error?: string;
}

/**
 * Mint `SEED_AMOUNT_BUSD` to the agent's depositor ATA, creating it if
 * necessary. No-op if the ATA already holds ≥ SEED_AMOUNT_BUSD (so a partial
 * re-run after the deposit succeeded is safe).
 */
async function mintIfNeeded(
  conn: Connection,
  payer: Keypair,
  mint: PublicKey,
  mintAuthority: Keypair,
  agentPubkey: PublicKey,
): Promise<"minted" | "skipped"> {
  const ata = getAssociatedTokenAddressSync(mint, agentPubkey, false);
  // Check current balance — if the ATA already has at least the seed amount
  // available we can skip the mint and the upcoming deposit will consume it.
  try {
    const acct = await getAccount(conn, ata, "confirmed");
    if (acct.amount >= SEED_AMOUNT_BUSD) {
      return "skipped";
    }
  } catch {
    // ATA doesn't exist yet — fall through to create + mint.
  }

  const ix = [
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      ata,
      agentPubkey,
      mint,
    ),
    createMintToInstruction(
      mint,
      ata,
      mintAuthority.publicKey,
      SEED_AMOUNT_BUSD,
    ),
  ];
  const tx = new Transaction().add(...ix);
  tx.feePayer = payer.publicKey;
  const signers: Keypair[] = [payer];
  // mintAuthority must sign the mint_to ix; dedupe if it's the same key.
  if (!mintAuthority.publicKey.equals(payer.publicKey)) {
    signers.push(mintAuthority);
  }
  await sendAndConfirmTransaction(conn, tx, signers, {
    commitment: "confirmed",
  });
  return "minted";
}

/**
 * Build + send `deposit_to_vault(SEED_AMOUNT_BUSD)` signed by the agent.
 *
 * Skips the on-chain call if the vault's treasury_ata already holds at
 * least SEED_AMOUNT_BUSD base units (the common case on a re-run).
 */
async function depositIfNeeded(
  conn: Connection,
  agent: Keypair,
  mint: PublicKey,
): Promise<"deposited" | "skipped"> {
  const vault = bundieVaultPda(agent.publicKey);
  const depositorAta = getAssociatedTokenAddressSync(
    mint,
    agent.publicKey,
    false,
  );
  // Treasury ATA owner = vault PDA → must allow off-curve.
  const treasuryAta = getAssociatedTokenAddressSync(mint, vault, true);

  try {
    const treasury = await getAccount(conn, treasuryAta, "confirmed");
    if (treasury.amount >= SEED_AMOUNT_BUSD) {
      return "skipped";
    }
  } catch {
    // Treasury ATA not yet created. init_vault should have created it; if
    // it didn't exist this call will fail loudly below — that's fine.
  }

  // Wire format mirrors `instructions/deposit_to_vault.rs` and the IDL
  // discriminator [18,62,110,8,26,106,248,151] (sha256("global:deposit_to_vault")[..8]).
  // Account ordering (from the IDL):
  //   0. depositor   (signer, writable — fee payer + token source authority)
  //   1. depositor_ata (writable)
  //   2. vault       (BundieVault PDA, read-only)
  //   3. treasury_ata (writable)
  //   4. token_program
  const data = Buffer.concat([
    anchorDiscriminator("deposit_to_vault"),
    u64LE(SEED_AMOUNT_BUSD),
  ]);
  const ix = new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys: [
      { pubkey: agent.publicKey, isSigner: true, isWritable: true },
      { pubkey: depositorAta, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = agent.publicKey;
  await sendAndConfirmTransaction(conn, tx, [agent], {
    commitment: "confirmed",
  });
  return "deposited";
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function processAgent(
  conn: Connection,
  busdMint: PublicKey,
  busdAuthority: Keypair,
  supa: ReturnType<typeof getSupabase>,
  spec: DemoAgent,
): Promise<SeedResult> {
  const result: SeedResult = {
    sns: spec.sns,
    mintStatus: "failed",
    depositStatus: "failed",
    rowStatus: "failed",
  };

  // 1. Load keypair + brain/policies first; if any of these is missing the
  //    agent can't be seeded and we surface a clear error.
  const keyPath = join(CHAOS_DIR, "keys", `${spec.short}-vault.json`);
  const brainPath = join(REPO_ROOT, "agents", spec.sns, "brain.md");
  const policiesPath = join(REPO_ROOT, "agents", spec.sns, "policies.yaml");
  for (const p of [keyPath, brainPath, policiesPath]) {
    if (!existsSync(p)) {
      result.error = `missing required file: ${p}`;
      return result;
    }
  }
  const agentKp = loadKeypair(keyPath);
  const agentPubkey = agentKp.publicKey;
  const vaultPdaStr = bundieVaultPda(agentPubkey).toBase58();
  const brainMd = readFileSync(brainPath, "utf8");
  const policiesYaml = readFileSync(policiesPath, "utf8");

  // 2. Mint bUSD into the agent's wallet ATA (idempotent).
  try {
    result.mintStatus = await mintIfNeeded(
      conn,
      busdAuthority, // mint authority pays fees + signs mint_to
      busdMint,
      busdAuthority,
      agentPubkey,
    );
  } catch (e) {
    result.error = `mint failed: ${(e as Error).message}`;
    return result;
  }

  // 3. Deposit into the existing BundieVault treasury_ata (idempotent).
  try {
    result.depositStatus = await depositIfNeeded(conn, agentKp, busdMint);
  } catch (e) {
    result.error = `deposit failed: ${(e as Error).message}`;
    return result;
  }

  // 4. Insert the Supabase row (skip if a row already exists for the SNS).
  try {
    const { data: existing, error: selErr } = await supa
      .from("agents")
      .select("sns")
      .eq("sns", spec.sns)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (existing) {
      result.rowStatus = "skipped";
      return result;
    }
    const { error: insErr } = await supa.from("agents").insert({
      sns: spec.sns,
      display_name: spec.displayName,
      tagline: spec.tagline,
      emoji: spec.emoji,
      // The demo agents have no separate human owner — `init_vault` was
      // called with the agent's own pubkey as owner_wallet, and we mirror
      // that here so the registry row matches on-chain state.
      owner_wallet: agentPubkey.toBase58(),
      vault_pda: vaultPdaStr,
      agent_pubkey: agentPubkey.toBase58(),
      brain_md: brainMd,
      policies_yaml: policiesYaml,
      preset: spec.preset,
      // Deposit already broadcast above → status is `active` immediately
      // (no pending_init phase like the wizard flow).
      status: "active",
      seed_amount_busd: Number(SEED_AMOUNT_BUSD),
    });
    if (insErr) throw new Error(insErr.message);
    result.rowStatus = "inserted";
  } catch (e) {
    result.error = `supabase insert failed: ${(e as Error).message}`;
    return result;
  }

  return result;
}

async function main(): Promise<void> {
  const devnetUrl =
    process.env.DEVNET_RPC ??
    process.env.DEVNET_RPC_URL ??
    "https://api.devnet.solana.com";
  const conn = new Connection(devnetUrl, "confirmed");

  const { mint: busdMint, authority: busdAuthority } = loadBusdMintInfo();
  const supa = getSupabase();

  console.log("=== seed-legacy-agents ===");
  console.log(`devnet RPC:      ${devnetUrl}`);
  console.log(`program:         ${PREDICTION_MARKET_PROGRAM_ID.toBase58()}`);
  console.log(`bUSD mint:       ${busdMint.toBase58()}`);
  console.log(`mint authority:  ${busdAuthority.publicKey.toBase58()}`);
  console.log(`seed amount:     ${SEED_AMOUNT_BUSD} base units ($50 bUSD)`);
  console.log("");

  const results: SeedResult[] = [];
  for (const spec of DEMO_AGENTS) {
    console.log(`[${spec.sns}]`);
    const r = await processAgent(conn, busdMint, busdAuthority, supa, spec);
    results.push(r);
    if (r.error) {
      console.log(`  ✗ ERROR: ${r.error}`);
    } else {
      console.log(
        `  mint=${r.mintStatus}  deposit=${r.depositStatus}  row=${r.rowStatus}`,
      );
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log("");
  console.log("=== summary ===");
  const migrated = results.filter(
    (r) => r.rowStatus === "inserted" && !r.error,
  );
  const alreadyDone = results.filter(
    (r) => r.rowStatus === "skipped" && !r.error,
  );
  const errored = results.filter((r) => r.error);

  if (migrated.length > 0) {
    console.log(`migrated:    ${migrated.map((r) => r.sns).join(", ")}`);
  }
  if (alreadyDone.length > 0) {
    console.log(`already-done: ${alreadyDone.map((r) => r.sns).join(", ")}`);
  }
  if (errored.length > 0) {
    console.log(`errored:`);
    for (const r of errored) console.log(`  - ${r.sns}: ${r.error}`);
  }

  // Surface failures so CI fails loudly.
  if (errored.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[seed-legacy-agents] fatal:", (err as Error).stack || err);
  process.exit(1);
});
