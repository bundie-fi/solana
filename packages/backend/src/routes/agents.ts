/**
 * Agent CRUD routes for the Bundie marketplace wizard.
 *
 * The Anchor program requires the agent keypair to sign init_vault (the
 * vault is derived from `["bundie_vault", authority]` and `authority` must
 * sign). The agent secret lives in the OWS vault — only the backend can
 * orchestrate it. So the backend now does the full init_vault flow itself:
 *
 *   1. Validate input + uniqueness.
 *   2. Generate brain.md + policies.yaml from a preset.
 *   3. Provision the OWS-vault keypair (via the @bundie/zerion-agent CLI),
 *      and mirror the 64-byte secret into chaos-sim/keys/<short>-vault.json
 *      so the chaos-sim daemon can find it.
 *   4. Fund the agent wallet from AGENT_FUNDING_SECRET (rent for the vault
 *      PDA + treasury ATA — about 0.005 SOL on devnet).
 *   5. Build init_vault tx server-side, sign + broadcast via the Zerion
 *      execute funnel (which runs the same DENY-by-default policy
 *      framework chaos-sim uses).
 *   6. Insert a row in the registry with status='pending_init'.
 *   7. /confirm-init verifies the treasury ATA balance ≥ seed amount
 *      (deposit completed by the wizard) before flipping to 'active'.
 *
 * close_vault is still wizard-driven (owner_wallet must sign) — the backend
 * just returns next-step params and flips status after broadcast.
 */
import { Hono } from "hono";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { zerionAgentCreate, zerionAgentExecute } from "../lib/zerion-cli.js";

// `@bundie/common`'s root export uses TS-only directory imports that pure
// node ESM (used by tsx) can't resolve at runtime — same workaround as
// src/lib/solana.ts. We re-declare the small set of constants we need.
const BUSD_MINT: string =
  process.env.BUSD_MINT ?? process.env.NEXT_PUBLIC_BUSD_MINT ?? "REPLACE_AFTER_SETUP";
const BUSD_DECIMALS_MULT = 1_000_000; // 6 decimals
const INITIAL_NAV_BASE = BigInt(1_000_000); // $1.00 in 6-dec base units
const DEVNET_RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const AGENT_FUND_LAMPORTS = Number(
  process.env.AGENT_FUND_LAMPORTS ?? 10_000_000, // 0.01 SOL — covers vault + ATA rent comfortably
);

import {
  generateBrainMd,
  generatePoliciesYaml,
  type AgentPreset,
  type AllowedProtocol,
  type PerProtocolLimits,
} from "../lib/agent-templates.js";

export const agents = new Hono();

const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);
const BUNDIE_VAULT_SEED = Buffer.from("bundie_vault");
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

const VALID_PRESETS: ReadonlySet<AgentPreset> = new Set([
  "balanced",
  "aggressive",
  "conservative",
  "yield-hunter",
  "perp-trader",
]);

const VALID_PROTOCOLS: ReadonlySet<AllowedProtocol> = new Set([
  "kamino",
  "marginfi",
  "marinade",
  "jito",
  "drift",
  "orca",
]);

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function anchorDisc(ixName: string): Buffer {
  return createHash("sha256")
    .update(`global:${ixName}`)
    .digest()
    .subarray(0, 8);
}

function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/** Strip ".bundie.sol" / ".bundie" / ".sol" suffix to get the short name. */
function shortName(sns: string): string {
  return sns
    .replace(/\.bundie\.sol$/i, "")
    .replace(/\.bundie$/i, "")
    .replace(/\.sol$/i, "");
}

/** Path the chaos-sim daemon expects keypairs at. */
function chaosSimKeyPath(sns: string): string {
  // packages/backend/src/routes → packages/programs/scripts/chaos-sim/keys
  const here = dirname(fileURLToPath(import.meta.url));
  return pathResolve(
    here,
    "../../../programs/scripts/chaos-sim/keys",
    `${shortName(sns)}-vault.json`,
  );
}

/** Resolve the funding keypair from AGENT_FUNDING_SECRET (JSON byte array). */
function resolveFundingKeypair(): Keypair | null {
  const raw = process.env.AGENT_FUNDING_SECRET;
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length !== 64) return null;
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    return null;
  }
}

/**
 * Build the init_vault Transaction. Fee payer + signer is the agent itself
 * (the program enforces `authority.is_signer` and the vault PDA is derived
 * from `["bundie_vault", authority]`).
 *
 * Args layout (Borsh):
 *   discriminator(8) | initial_nav: u64 LE | owner_wallet: Pubkey(32) | treasury_mint: Pubkey(32)
 */
async function buildInitVaultTx(
  conn: Connection,
  agentPubkey: PublicKey,
  ownerWallet: PublicKey,
  treasuryMint: PublicKey,
  vaultPda: PublicKey,
): Promise<{ txB64: string; treasuryAta: PublicKey }> {
  const treasuryAta = getAssociatedTokenAddress(treasuryMint, vaultPda);

  const disc = anchorDisc("init_vault");
  // 8 + 8 + 32 + 32 = 80 bytes
  const data = Buffer.alloc(80);
  disc.copy(data, 0);
  data.writeBigUInt64LE(INITIAL_NAV_BASE, 8);
  ownerWallet.toBuffer().copy(data, 16);
  treasuryMint.toBuffer().copy(data, 48);

  const ix = new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys: [
      { pubkey: agentPubkey, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: treasuryMint, isSigner: false, isWritable: false },
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = agentPubkey;
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  return { txB64: serialized.toString("base64"), treasuryAta };
}

/** Fund an agent wallet from AGENT_FUNDING_SECRET. Returns tx signature. */
async function fundAgentWallet(
  conn: Connection,
  agentPubkey: PublicKey,
  lamports: number,
): Promise<string> {
  const funder = resolveFundingKeypair();
  if (!funder) {
    throw new Error(
      "AGENT_FUNDING_SECRET not configured (need a funded devnet keypair as JSON byte array)",
    );
  }
  // Skip if the agent already has enough SOL — keeps re-runs cheap.
  const balance = await conn.getBalance(agentPubkey, "confirmed");
  if (balance >= lamports) return "skipped:already-funded";

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: agentPubkey,
      lamports: lamports - balance,
    }),
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
    "confirmed",
  );
  tx.recentBlockhash = blockhash;
  tx.feePayer = funder.publicKey;
  tx.sign(funder);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

interface CreateAgentBody {
  sns?: string;
  displayName?: string;
  tagline?: string;
  emoji?: string;
  ownerWallet?: string;
  preset?: AgentPreset;
  allowedProtocols?: AllowedProtocol[];
  perProtocolLimits?: Partial<Record<AllowedProtocol, PerProtocolLimits>>;
  seedAmountBusd?: number;
  customBrainMd?: string;
}

agents.post("/api/agents", async (c) => {
  let body: CreateAgentBody;
  try {
    body = (await c.req.json()) as CreateAgentBody;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // ── Validation ────────────────────────────────────────────────────────
  if (!body.sns || typeof body.sns !== "string") {
    return c.json({ error: "sns required (string)" }, 400);
  }
  if (!body.displayName || typeof body.displayName !== "string") {
    return c.json({ error: "displayName required (string)" }, 400);
  }
  if (!body.ownerWallet || typeof body.ownerWallet !== "string") {
    return c.json({ error: "ownerWallet required (string)" }, 400);
  }
  let ownerWalletKey: PublicKey;
  try {
    ownerWalletKey = new PublicKey(body.ownerWallet);
  } catch {
    return c.json({ error: "ownerWallet is not a valid pubkey" }, 400);
  }
  if (!body.preset || !VALID_PRESETS.has(body.preset)) {
    return c.json(
      {
        error: `preset must be one of: ${Array.from(VALID_PRESETS).join(", ")}`,
      },
      400,
    );
  }
  if (
    !Array.isArray(body.allowedProtocols) ||
    body.allowedProtocols.length === 0
  ) {
    return c.json({ error: "allowedProtocols must be a non-empty array" }, 400);
  }
  for (const p of body.allowedProtocols) {
    if (!VALID_PROTOCOLS.has(p)) {
      return c.json(
        {
          error: `Unknown protocol "${p}". Valid: ${Array.from(VALID_PROTOCOLS).join(", ")}`,
        },
        400,
      );
    }
  }
  if (
    typeof body.seedAmountBusd !== "number" ||
    !Number.isFinite(body.seedAmountBusd) ||
    body.seedAmountBusd <= 0
  ) {
    return c.json({ error: "seedAmountBusd must be a positive number" }, 400);
  }

  const supa = getSupabase();
  if (!supa) {
    return c.json({ error: "Supabase not configured" }, 503);
  }

  // ── Uniqueness check ──────────────────────────────────────────────────
  const { data: existing, error: existingErr } = await supa
    .from("agents")
    .select("sns")
    .eq("sns", body.sns)
    .limit(1);
  if (existingErr) return c.json({ error: existingErr.message }, 500);
  if (existing && existing.length > 0) {
    return c.json({ error: "sns taken" }, 409);
  }

  // ── Generate brain.md + policies.yaml ─────────────────────────────────
  const brainMd =
    body.customBrainMd ??
    generateBrainMd({
      preset: body.preset,
      displayName: body.displayName,
      allowedProtocols: body.allowedProtocols,
    });
  const policiesYaml = generatePoliciesYaml({
    allowedProtocols: body.allowedProtocols,
    perProtocolLimits: body.perProtocolLimits ?? {},
    busdMint: BUSD_MINT,
  });

  // ── Provision Zerion-managed keypair (+ mirror to chaos-sim/keys) ─────
  let agentPubkey: PublicKey;
  let zerionVaultName: string;
  const snsShort = shortName(body.sns);
  const mirrorPath = chaosSimKeyPath(body.sns);
  try {
    const zerionResult = zerionAgentCreate(snsShort, mirrorPath);
    agentPubkey = new PublicKey(zerionResult.pubkey);
    zerionVaultName = zerionResult.vaultName;
  } catch (err) {
    return c.json(
      { error: `Failed to provision agent keypair: ${(err as Error).message}` },
      500,
    );
  }

  // ── Derive BundieVault PDA + treasury ATA ─────────────────────────────
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [BUNDIE_VAULT_SEED, agentPubkey.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  const treasuryMintKey = new PublicKey(BUSD_MINT);
  const treasuryAta = getAssociatedTokenAddress(treasuryMintKey, vaultPda);
  const seedAmountBase = Math.floor(body.seedAmountBusd * BUSD_DECIMALS_MULT);

  const conn = new Connection(DEVNET_RPC, "confirmed");

  // ── Fund the agent wallet for vault + ATA rent ────────────────────────
  let fundingSig: string;
  try {
    fundingSig = await fundAgentWallet(conn, agentPubkey, AGENT_FUND_LAMPORTS);
  } catch (err) {
    return c.json(
      {
        error: `Failed to fund agent wallet: ${(err as Error).message}`,
      },
      500,
    );
  }

  // ── Build + sign + broadcast init_vault via the Zerion execute funnel ─
  let initVaultSig: string;
  try {
    const { txB64 } = await buildInitVaultTx(
      conn,
      agentPubkey,
      ownerWalletKey,
      treasuryMintKey,
      vaultPda,
    );
    const exec = zerionAgentExecute({
      name: snsShort,
      txB64,
      action: "init_vault",
      notionalUsd: 0,
      rpcUrl: DEVNET_RPC,
    });
    if (!exec.signature) {
      throw new Error(
        `init_vault execute returned no signature; deniedBy=${exec.deniedBy ?? "unknown"}`,
      );
    }
    initVaultSig = exec.signature;
  } catch (err) {
    return c.json(
      { error: `Failed to init_vault on-chain: ${(err as Error).message}` },
      500,
    );
  }

  // ── Insert into Supabase (vault now exists on-chain) ──────────────────
  const { data: agentRow, error: insertErr } = await supa
    .from("agents")
    .insert({
      sns: body.sns,
      display_name: body.displayName,
      tagline: body.tagline ?? null,
      emoji: body.emoji ?? null,
      owner_wallet: body.ownerWallet,
      vault_pda: vaultPda.toBase58(),
      agent_pubkey: agentPubkey.toBase58(),
      brain_md: brainMd,
      policies_yaml: policiesYaml,
      preset: body.preset,
      status: "pending_init",
      seed_amount_busd: seedAmountBase,
    })
    .select()
    .single();
  if (insertErr) return c.json({ error: insertErr.message }, 500);

  // ── Return next-step instructions for the wizard ──────────────────────
  // The vault is already initialized; the wizard just needs to deposit the
  // seed amount as the owner_wallet, then call /confirm-init.
  return c.json({
    agent: agentRow,
    initVaultSignature: initVaultSig,
    fundingSignature: fundingSig,
    nextSteps: {
      vaultPda: vaultPda.toBase58(),
      treasuryAta: treasuryAta.toBase58(),
      treasuryMint: BUSD_MINT,
      seedAmountBase,
      zerionVaultName,
      instructions: [
        "Build deposit_to_vault tx and sign as owner_wallet",
        "POST /api/agents/:sns/confirm-init when the deposit confirms",
      ],
    },
  });
});

agents.post("/api/agents/:sns/confirm-init", async (c) => {
  const sns = c.req.param("sns");
  const supa = getSupabase();
  if (!supa) return c.json({ error: "Supabase not configured" }, 503);

  const { data: agent, error: fetchErr } = await supa
    .from("agents")
    .select("*")
    .eq("sns", sns)
    .single();
  if (fetchErr || !agent) return c.json({ error: "Not found" }, 404);
  if (agent.status === "active") return c.json({ ok: true, agent });

  // Verify on-chain that the BundieVault PDA exists AND the treasury ATA
  // has at least the seed amount (i.e. the deposit completed).
  const conn = new Connection(DEVNET_RPC, "confirmed");
  const vaultPubkey = new PublicKey(agent.vault_pda);
  const vaultInfo = await conn.getAccountInfo(vaultPubkey);
  if (!vaultInfo) {
    return c.json({ error: "Vault not initialized on-chain" }, 400);
  }
  const treasuryAta = getAssociatedTokenAddress(
    new PublicKey(BUSD_MINT),
    vaultPubkey,
  );
  const ataInfo = await conn.getAccountInfo(treasuryAta);
  if (!ataInfo) {
    return c.json({ error: "Treasury ATA missing on-chain" }, 400);
  }
  // SPL token account: amount is u64LE at offset 64.
  const amount = ataInfo.data.readBigUInt64LE(64);
  if (amount < BigInt(agent.seed_amount_busd)) {
    return c.json(
      {
        error: `Treasury balance ${amount.toString()} < seed_amount_busd ${agent.seed_amount_busd}`,
      },
      400,
    );
  }

  const { error: updateErr } = await supa
    .from("agents")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("sns", sns);
  if (updateErr) return c.json({ error: updateErr.message }, 500);

  return c.json({ ok: true, agent: { ...agent, status: "active" } });
});

agents.get("/api/agents", async (c) => {
  const status = c.req.query("status");
  const ownerWallet = c.req.query("ownerWallet");
  const supa = getSupabase();
  if (!supa) return c.json({ agents: [] });

  let q = supa.from("agents").select("*").order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  if (ownerWallet) q = q.eq("owner_wallet", ownerWallet);

  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ agents: data ?? [] });
});

agents.post("/api/agents/:sns/close", async (c) => {
  const sns = c.req.param("sns");
  const supa = getSupabase();
  if (!supa) return c.json({ error: "Supabase not configured" }, 503);

  const { data: agent, error: fetchErr } = await supa
    .from("agents")
    .select("*")
    .eq("sns", sns)
    .single();
  if (fetchErr || !agent) return c.json({ error: "Not found" }, 404);

  // Backend doesn't build close_vault tx — wizard builds + signs (owner_wallet
  // is the signer). Backend just returns the params + flips status='retired'
  // after the wizard confirms broadcast via /confirm-close.
  return c.json({
    agent,
    nextSteps: {
      ownerWallet: agent.owner_wallet,
      vaultPda: agent.vault_pda,
      treasuryMint: BUSD_MINT,
      instructions: [
        "Build close_vault tx with owner wallet as signer",
        "POST /api/agents/:sns/confirm-close after broadcast",
      ],
    },
  });
});

agents.post("/api/agents/:sns/confirm-close", async (c) => {
  const sns = c.req.param("sns");
  const supa = getSupabase();
  if (!supa) return c.json({ error: "Supabase not configured" }, 503);

  const { error: updateErr } = await supa
    .from("agents")
    .update({ status: "retired", updated_at: new Date().toISOString() })
    .eq("sns", sns);
  if (updateErr) return c.json({ error: updateErr.message }, 500);

  return c.json({ ok: true });
});
