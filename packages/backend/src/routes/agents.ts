/**
 * Agent CRUD routes for the Bundie marketplace wizard.
 *
 * Backend is intentionally stateless re: tx construction — the wizard builds
 * init_vault / deposit_to_vault / close_vault txs client-side using the
 * @bundie/common IDL + the connected wallet. We just:
 *   1. Validate input + uniqueness.
 *   2. Generate brain.md + policies.yaml from a preset.
 *   3. Provision the OWS-vault keypair (via the zerion-bundie CLI).
 *   4. Derive the BundieVault PDA so the wizard knows where to send funds.
 *   5. Insert a row in the registry with status='pending_init'.
 *   6. After the wizard broadcasts the on-chain init, /confirm-init verifies
 *      the vault account exists and flips status to 'active'.
 */
import { Hono } from "hono";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Connection, PublicKey } from "@solana/web3.js";

import { zerionAgentCreate } from "../lib/zerion-cli.js";

// `@bundie/common`'s root export uses TS-only directory imports that pure
// node ESM (used by tsx) can't resolve at runtime — same workaround as
// src/lib/solana.ts. We re-declare the small set of constants we need.
const BUSD_MINT: string =
  process.env.BUSD_MINT ?? process.env.NEXT_PUBLIC_BUSD_MINT ?? "REPLACE_AFTER_SETUP";
const BUSD_DECIMALS_MULT = 1_000_000; // 6 decimals
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
  try {
    new PublicKey(body.ownerWallet);
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

  // ── Provision Zerion-managed keypair ──────────────────────────────────
  let agentPubkey: PublicKey;
  let zerionVaultName: string;
  try {
    const zerionResult = zerionAgentCreate(body.sns);
    agentPubkey = new PublicKey(zerionResult.pubkey);
    zerionVaultName = zerionResult.vaultName;
  } catch (err) {
    return c.json(
      { error: `Failed to provision agent keypair: ${(err as Error).message}` },
      500,
    );
  }

  // ── Derive BundieVault PDA ────────────────────────────────────────────
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [BUNDIE_VAULT_SEED, agentPubkey.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );

  const seedAmountBase = Math.floor(body.seedAmountBusd * BUSD_DECIMALS_MULT);

  // ── Insert into Supabase ──────────────────────────────────────────────
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
  return c.json({
    agent: agentRow,
    nextSteps: {
      ownerWallet: body.ownerWallet,
      vaultPda: vaultPda.toBase58(),
      agentPubkey: agentPubkey.toBase58(),
      treasuryMint: BUSD_MINT,
      seedAmountBase,
      zerionVaultName,
      instructions: [
        "Build init_vault tx: program.methods.initVault(initialNav, ownerWallet, treasuryMint).accounts(...).transaction()",
        "Build deposit_to_vault tx: program.methods.depositToVault(seedAmountBase).accounts(...).transaction()",
        "Sign + send both as the owner wallet",
        "POST /api/agents/:sns/confirm-init when both confirmed",
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

  // Verify on-chain that the BundieVault PDA exists.
  const conn = new Connection(
    process.env.DEVNET_RPC ?? "https://api.devnet.solana.com",
    "confirmed",
  );
  const vaultInfo = await conn.getAccountInfo(new PublicKey(agent.vault_pda));
  if (!vaultInfo) {
    return c.json({ error: "Vault not initialized on-chain" }, 400);
  }

  // (Optional) verify treasury_ata balance ≥ seed_amount_busd. Skipped in v1
  // — the wizard already ensures this before calling confirm-init.

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
