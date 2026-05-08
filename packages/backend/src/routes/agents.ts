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
import { bodyLimit } from "hono/body-limit";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import {
  getOrCreateAssociatedTokenAccount as splGetOrCreateATA,
  mintTo as splMintTo,
} from "@solana/spl-token";

import { dbQuery, getPool } from "../lib/db.js";
import { resolveSnsOwner } from "../lib/sns-verify.js";
import { zerionAgentCreate, zerionAgentExecute } from "../lib/zerion-cli.js";

// `@bundie/common`'s root export uses TS-only directory imports that pure
// node ESM (used by tsx) can't resolve at runtime — same workaround as
// src/lib/solana.ts. We re-declare the small set of constants we need.
const BUSD_MINT: string =
  process.env.BUSD_MINT ?? process.env.NEXT_PUBLIC_BUSD_MINT ?? "REPLACE_AFTER_SETUP";
const BUSD_DECIMALS_MULT = 1_000_000; // 6 decimals
const INITIAL_NAV_BASE = BigInt(1_000_000); // $1.00 in 6-dec base units
const DEVNET_RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
// SNS only exists on mainnet — devnet has no NameRegistry data. Used by
// resolveSnsOwner below to verify ownership of `<sub>.bundie.sol`.
const MAINNET_RPC =
  process.env.MAINNET_RPC_URL ??
  process.env.MAINNET_RPC ??
  "https://api.mainnet-beta.solana.com";
const AGENT_FUND_LAMPORTS = Number(
  // 0.05 SOL covers init_vault (~0.005), repeated commit_nav fees, and
  // up to ~8 create_market_v2 calls (each rents 4 PDAs ≈ 0.0053 SOL).
  // Previous 0.01 SOL ran out after the first market attempt.
  process.env.AGENT_FUND_LAMPORTS ?? 50_000_000,
);

// Module-load assert: surface BUSD misconfig to operators immediately, but
// don't throw (would crash the backend; routes return 503 instead).
if (BUSD_MINT === "REPLACE_AFTER_SETUP") {
  // eslint-disable-next-line no-console
  console.error(
    "FATAL: BUSD_MINT not configured. Set BUSD_MINT or NEXT_PUBLIC_BUSD_MINT env. Agent creation routes will return 503.",
  );
}

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

// ── Hard caps + patterns ────────────────────────────────────────────────────
const SNS_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_DISPLAY_NAME = 100;
const MAX_TAGLINE = 200;
const MAX_BRAIN_BYTES = 8 * 1024;
const MAX_PROTOCOLS = 6;
const MAX_BODY_BYTES = 64 * 1024;

// ── Status transition guard ────────────────────────────────────────────────
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending_init: ["active", "retired"],
  active: ["paused", "retired"],
  paused: ["active", "retired"],
  retired: [],
};

function canTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

const VALID_PRESETS: ReadonlySet<AgentPreset> = new Set([
  "balanced",
  "aggressive",
  "conservative",
  "yield-hunter",
  "perp-trader",
]);

const VALID_PROTOCOLS: ReadonlySet<AllowedProtocol> = new Set([
  "kamino",
  "solend",
  "marinade",
  "jito",
  "jupiter-perps",
]);

/** Row shape for the `agents` table. Keep in sync with the migration. */
interface AgentRow {
  sns: string;
  display_name: string;
  tagline: string | null;
  emoji: string | null;
  owner_wallet: string;
  vault_pda: string;
  agent_pubkey: string;
  brain_md: string | null;
  policies_yaml: string | null;
  preset: string;
  status: string;
  seed_amount_busd: number | string;
  /** True iff `<sns>.bundie.sol` resolves on mainnet to `owner_wallet`.
   *  False covers "no SNS record" and "owner mismatch" — see the soft-
   *  verification block in POST /api/agents. */
  sns_verified?: boolean;
  created_at?: string;
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

/** Operating bUSD allocated to each new agent's own ATA on creation.
 *  This is SEPARATE from the user's seed deposit (which lives in the
 *  vault treasury). create_market_v2 requires the creator to seed each
 *  AMM with 1-10 bUSD from their own ATA — without this allocation
 *  every market attempt fails token-program "insufficient funds". */
const AGENT_OPERATING_BUSD_BASE = 100_000_000; // 100 bUSD (6dp)

async function mintBusdToAgent(
  conn: Connection,
  agentPubkey: PublicKey,
): Promise<void> {
  const mintEnv = process.env.BUSD_MINT;
  const authEnv = process.env.BUSD_MINT_AUTHORITY_SECRET;
  if (!mintEnv || !authEnv) {
    throw new Error(
      "BUSD_MINT and BUSD_MINT_AUTHORITY_SECRET must be set to mint operating bUSD",
    );
  }
  const mint = new PublicKey(mintEnv);
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(authEnv)),
  );
  const ata = await splGetOrCreateATA(conn, authority, mint, agentPubkey);
  await splMintTo(
    conn,
    authority,
    mint,
    ata.address,
    authority,
    AGENT_OPERATING_BUSD_BASE,
  );
}

// 64 KB body cap for every /api/agents route — guards against blob-sized brain.md.
agents.use("/api/agents/*", bodyLimit({ maxSize: MAX_BODY_BYTES }));
agents.use("/api/agents", bodyLimit({ maxSize: MAX_BODY_BYTES }));

agents.post("/api/agents", async (c) => {
  let body: CreateAgentBody;
  try {
    body = (await c.req.json()) as CreateAgentBody;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // ── Validation ────────────────────────────────────────────────────────
  if (BUSD_MINT === "REPLACE_AFTER_SETUP") {
    return c.json({ error: "Backend BUSD_MINT not configured" }, 503);
  }
  if (!body.sns || typeof body.sns !== "string") {
    return c.json({ error: "sns required (string)" }, 400);
  }
  // Strip the .bundie.sol suffix (if present) before pattern-checking — the
  // SNS column stores the FULL name, but the on-chain identifier is the
  // short form.
  const snsShortPattern = shortName(body.sns);
  if (!SNS_PATTERN.test(snsShortPattern)) {
    return c.json(
      {
        error:
          "sns must match [a-z0-9-]+ (max 64 chars, lowercase, no leading/trailing dash)",
      },
      400,
    );
  }
  if (!body.displayName || typeof body.displayName !== "string") {
    return c.json({ error: "displayName required (string)" }, 400);
  }
  if (body.displayName.length > MAX_DISPLAY_NAME) {
    return c.json(
      { error: `displayName must be ≤ ${MAX_DISPLAY_NAME} chars` },
      400,
    );
  }
  if (
    body.tagline !== undefined &&
    body.tagline !== null &&
    body.tagline.length > MAX_TAGLINE
  ) {
    return c.json({ error: `tagline must be ≤ ${MAX_TAGLINE} chars` }, 400);
  }
  if (
    body.customBrainMd !== undefined &&
    body.customBrainMd !== null &&
    Buffer.byteLength(body.customBrainMd, "utf8") > MAX_BRAIN_BYTES
  ) {
    return c.json(
      { error: `customBrainMd must be ≤ ${MAX_BRAIN_BYTES} bytes` },
      400,
    );
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
  if (body.allowedProtocols.length > MAX_PROTOCOLS) {
    return c.json(
      { error: `allowedProtocols must have ≤ ${MAX_PROTOCOLS} entries` },
      400,
    );
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

  if (!getPool()) {
    return c.json({ error: "Database not configured" }, 503);
  }

  // ── Uniqueness check ──────────────────────────────────────────────────
  let existingRows;
  try {
    const r = await dbQuery<{ sns: string }>(
      `SELECT sns FROM agents WHERE sns = $1 LIMIT 1`,
      [body.sns],
    );
    existingRows = r?.rows ?? [];
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
  if (existingRows.length > 0) {
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

  // ── Mint the agent operating-bUSD for create_market subsidies ─────────
  // create_market_v2 requires the creator to seed the AMM with 1-10 bUSD
  // from their OWN ATA (not the vault treasury). Without this, every
  // create_market simulation fails with token-program "insufficient funds"
  // after passing the SOL-rent check. Mint 100 bUSD to the agent so it
  // has runway for many markets across the demo. Best-effort: failure
  // logs but doesn't block agent creation — operator can top up later.
  try {
    await mintBusdToAgent(conn, agentPubkey);
  } catch (err) {
    console.warn(
      `[agents] best-effort agent-bUSD mint failed: ${(err as Error).message}`,
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

  // ── Insert into Postgres (vault now exists on-chain) ──────────────────
  // Also persist the agent's secret-key bytes alongside brain_md /
  // policies_yaml so the chaos-sim daemon (a separate Railway service
  // with its own disk) can write the keypair file from the DB on first
  // sight. Without this, wizard-created agents stall at the daemon's
  // "missing local keypair" check forever — only hardcoded alice/bob/
  // charlie tick because their JSON keypairs are committed to git and
  // ship inside the daemon's Docker image.
  //
  // Storing a Solana secret key in Postgres is an additional plaintext
  // location on top of the OWS vault + the backend disk file. Acceptable
  // for hackathon / devnet; revisit with Railway shared volumes or
  // OWS-from-daemon access for production.
  let agentSecretKeyJson: string | null = null;
  try {
    agentSecretKeyJson = readFileSync(mirrorPath, "utf8").trim();
  } catch (err) {
    return c.json(
      { error: `Failed to read mirror keypair: ${(err as Error).message}` },
      500,
    );
  }

  // ── SNS ownership verification (soft) ─────────────────────────────────
  // Resolve `<short>.bundie.sol` against MAINNET (SNS doesn't exist on
  // devnet) and check whether the on-chain owner matches the wallet that
  // initiated registration. A match flips `sns_verified = true`; anything
  // else (no record, wrong owner, RPC failure) leaves it false. This is
  // intentional — the bootstrap-agent script registers identifiers like
  // "kamino-stacker" that aren't real SNS subdomains, and we don't want
  // to block those flows. Verification is a passport stamp, not a gate.
  let snsVerified = false;
  try {
    const mainnetConn = new Connection(MAINNET_RPC, "confirmed");
    const onChainOwner = await resolveSnsOwner(mainnetConn, snsShort);
    if (onChainOwner && onChainOwner === body.ownerWallet) {
      snsVerified = true;
    }
  } catch {
    // Network blip / SDK throw — leave snsVerified = false.
  }
  let agentRow: AgentRow;
  try {
    const insertRes = await dbQuery<AgentRow>(
      `INSERT INTO agents (
         sns, display_name, tagline, emoji, owner_wallet, vault_pda,
         agent_pubkey, brain_md, policies_yaml, preset, status, seed_amount_busd,
         agent_secret_key, sns_verified
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        body.sns,
        body.displayName,
        body.tagline ?? null,
        body.emoji ?? null,
        body.ownerWallet,
        vaultPda.toBase58(),
        agentPubkey.toBase58(),
        brainMd,
        policiesYaml,
        body.preset,
        "pending_init",
        seedAmountBase,
        agentSecretKeyJson,
        snsVerified,
      ],
    );
    if (!insertRes || insertRes.rows.length === 0) {
      return c.json({ error: "Insert returned no rows" }, 500);
    }
    agentRow = insertRes.rows[0];
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

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
  if (!getPool()) return c.json({ error: "Database not configured" }, 503);

  let agent: AgentRow;
  try {
    const fetchRes = await dbQuery<AgentRow>(
      `SELECT * FROM agents WHERE sns = $1 LIMIT 1`,
      [sns],
    );
    if (!fetchRes || fetchRes.rows.length === 0) {
      return c.json({ error: "Not found" }, 404);
    }
    agent = fetchRes.rows[0];
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
  if (agent.status === "active") return c.json({ ok: true, agent });
  if (!canTransition(agent.status, "active")) {
    return c.json(
      {
        error: `Cannot transition from ${agent.status} to active`,
      },
      409,
    );
  }

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

  try {
    await dbQuery(
      `UPDATE agents SET status = $1 WHERE sns = $2`,
      ["active", sns],
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  return c.json({ ok: true, agent: { ...agent, status: "active" } });
});

/**
 * Decode NAV fields out of a BundieVault account.
 *
 * Layout (Anchor 8-byte discriminator + struct):
 *   8   bytes  discriminator
 *   32  bytes  authority
 *   32  bytes  owner_wallet
 *   32  bytes  treasury_mint
 *   32  bytes  treasury_ata
 *   8   bytes  nav_lamports   (u64 LE)  ← offset 136
 *   8   bytes  nav_epoch      (u64 LE)  ← offset 144
 *   8   bytes  nav_slot       (u64 LE)  ← offset 152
 *   32  bytes  commit_digest
 *   1   byte   bump
 *
 * Returns nulls if the account doesn't exist or the buffer is too short.
 * `Number()` on bigints is fine here — NAV fits in u53 (1e15 lamports is
 * way bigger than anything we'd ever see).
 */
function decodeBundieVaultNav(
  data: Buffer | null,
): { navLamports: number; navEpoch: number; navSlot: number } | null {
  if (!data || data.length < 160) return null;
  return {
    navLamports: Number(data.readBigUInt64LE(136)),
    navEpoch: Number(data.readBigUInt64LE(144)),
    navSlot: Number(data.readBigUInt64LE(152)),
  };
}

agents.get("/api/agents", async (c) => {
  const status = c.req.query("status");
  const ownerWallet = c.req.query("ownerWallet");
  const sns = c.req.query("sns");
  if (!getPool()) return c.json({ agents: [] });

  // Build a parameterized WHERE clause from optional filters.
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    wheres.push(`status = $${params.length}`);
  }
  if (ownerWallet) {
    params.push(ownerWallet);
    wheres.push(`owner_wallet = $${params.length}`);
  }
  if (sns) {
    params.push(sns);
    wheres.push(`sns = $${params.length}`);
  }
  const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

  let rows: AgentRow[];
  try {
    const r = await dbQuery<AgentRow>(
      `SELECT * FROM agents ${whereClause} ORDER BY created_at DESC`,
      params,
    );
    rows = r?.rows ?? [];
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  // Augment each row with on-chain NAV data so the landing page surfaces
  // live numbers instead of falling back to static copy. Done in parallel
  // and best-effort — if the RPC fails for one vault, the others still
  // return.
  const conn = new Connection(DEVNET_RPC, "confirmed");
  const augmented = await Promise.all(
    rows.map(async (row) => {
      try {
        const info = await conn.getAccountInfo(
          new PublicKey(row.vault_pda),
          "confirmed",
        );
        const nav = decodeBundieVaultNav(info?.data ?? null);
        return {
          ...row,
          navLamports: nav?.navLamports ?? null,
          navEpoch: nav?.navEpoch ?? null,
          navSlot: nav?.navSlot ?? null,
        };
      } catch {
        return {
          ...row,
          navLamports: null,
          navEpoch: null,
          navSlot: null,
        };
      }
    }),
  );

  return c.json({ agents: augmented });
});

// ── Live activity feed ─────────────────────────────────────────────────────
//
// GET /api/activity?limit=N
//
// Returns the most recent agent_action_log rows joined with agents so the
// landing page can render an "agents are doing things right now" feed. Only
// surfaces real on-chain actions — skipped/error rows are filtered out.
//
// Cap `limit` at 50 to keep the response cheap; the landing page asks for 8.
const ACTIVITY_DISPLAY_TYPES: ReadonlySet<string> = new Set([
  "commit_nav",
  "lend_deposit",
  "lend_withdraw",
  "lst_stake",
  "lst_unstake",
  "create_market",
  "swap",
  // Jupiter Perps actions — were silently filtered out of the feed
  // even though funding-shorter routes through perp_open every few
  // ticks. Without these, the UI undercounted real on-chain activity
  // and the bettor-facing live feed felt sparser than the agents
  // actually were.
  "perp_open",
  "perp_close",
]);

// Periodic system actions like commit_nav are dropped from BOTH the
// per-agent and global feeds by default. They fire on every tick for
// every agent (every ~30s × N agents), so at the landing-page default
// of limit=8 they completely drown out the rarer strategy verbs
// (lend_deposit, lst_stake, swap, create_market) that the feed exists
// to surface. Pulse-only views can opt in via ?includeHeartbeats=1.
const HEARTBEAT_TYPES: ReadonlySet<string> = new Set([
  "commit_nav",
]);

interface ActivityRow {
  agent_sns: string;
  agent_emoji: string | null;
  action_type: string;
  reasoning: string | null;
  tick_at: string;
}

agents.get("/api/activity", async (c) => {
  if (!getPool()) return c.json({ activity: [] });

  const limitParam = Number(c.req.query("limit") ?? 8);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), 50)
      : 8;
  // Optional per-agent scope. Used by the bet page's agent insight panel
  // to surface "what is THIS agent thinking right now". Empty / missing
  // returns the global feed (default behaviour).
  const agentSnsFilter = c.req.query("agent")?.trim() || null;
  // Heartbeats (commit_nav) are dropped by default for both global and
  // per-agent feeds. Pass `?includeHeartbeats=1` to opt back in (for
  // platform-pulse dashboards that explicitly want to count NAV ticks).
  const includeHeartbeats =
    c.req.query("includeHeartbeats") === "1" ||
    c.req.query("includeHeartbeats") === "true";

  const allowedTypes = Array.from(ACTIVITY_DISPLAY_TYPES).filter(
    (t) => includeHeartbeats || !HEARTBEAT_TYPES.has(t),
  );
  try {
    const params: unknown[] = [allowedTypes];
    let agentClause = "";
    if (agentSnsFilter) {
      params.push(agentSnsFilter);
      agentClause = `AND al.agent_sns = $${params.length}`;
    }
    params.push(limit);
    const r = await dbQuery<ActivityRow>(
      `SELECT al.agent_sns,
              a.emoji        AS agent_emoji,
              al.action_type,
              al.reasoning,
              al.tick_at
         FROM agent_action_log al
         JOIN agents a ON a.sns = al.agent_sns
         WHERE al.action_type = ANY($1::text[])
         ${agentClause}
         ORDER BY al.tick_at DESC
         LIMIT $${params.length}`,
      params,
    );
    const rows = r?.rows ?? [];
    return c.json({
      activity: rows.map((row) => ({
        agentSns: row.agent_sns,
        agentEmoji: row.agent_emoji,
        actionType: row.action_type,
        reasoning: row.reasoning,
        tickAt: row.tick_at,
      })),
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Auth helpers for close routes ──────────────────────────────────────────
//
// Owner must prove control of the wallet by signing a structured message:
//   "close-vault:<sns>:<unix-ms-timestamp>"
// We verify ed25519 sig against agent.owner_wallet and reject claims older
// than 5 minutes (replay protection).
const SIGNED_CLAIM_TTL_MS = 5 * 60 * 1000;
const CLOSE_MSG_PATTERN = /^close-vault:([^:]+):(\d+)$/;

interface SignedClaim {
  ownerWallet: string;
  signature: string; // base58 or base64
  message: string;
}

function verifyCloseClaim(
  claim: SignedClaim | undefined,
  expectedSns: string,
  expectedOwner: string,
): { ok: true } | { ok: false; reason: string } {
  if (!claim || typeof claim !== "object") {
    return { ok: false, reason: "signedClaim required" };
  }
  if (!claim.ownerWallet || claim.ownerWallet !== expectedOwner) {
    return { ok: false, reason: "ownerWallet mismatch" };
  }
  if (!claim.message || !claim.signature) {
    return { ok: false, reason: "message + signature required" };
  }
  const m = claim.message.match(CLOSE_MSG_PATTERN);
  if (!m) {
    return {
      ok: false,
      reason: "message must be 'close-vault:<sns>:<timestamp>'",
    };
  }
  if (m[1] !== expectedSns) {
    return { ok: false, reason: "message sns mismatch" };
  }
  const ts = Number(m[2]);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > SIGNED_CLAIM_TTL_MS) {
    return { ok: false, reason: "message timestamp expired (>5m)" };
  }
  // Decode signature: try base64 then base58.
  let sigBytes: Uint8Array;
  try {
    sigBytes = Buffer.from(claim.signature, "base64");
    if (sigBytes.length !== 64) {
      // Fall back to base58 (Solana wallet adapters return base58 by default).
      // PublicKey can decode base58 — repurpose it.
      sigBytes = new PublicKey(claim.signature).toBytes();
    }
  } catch {
    return { ok: false, reason: "signature must be base64 or base58" };
  }
  if (sigBytes.length !== 64) {
    return { ok: false, reason: "signature must be 64 bytes" };
  }
  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = new PublicKey(expectedOwner).toBytes();
  } catch {
    return { ok: false, reason: "owner_wallet not a valid pubkey" };
  }
  const msgBytes = Buffer.from(claim.message, "utf8");
  const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  if (!valid) return { ok: false, reason: "invalid signature" };
  return { ok: true };
}

interface CloseBody {
  signedClaim?: SignedClaim;
  /** Hackathon fallback: if no signedClaim, accept a plain claim (TODO: remove). */
  callerWallet?: string;
}

agents.post("/api/agents/:sns/close", async (c) => {
  const sns = c.req.param("sns");
  if (!getPool()) return c.json({ error: "Database not configured" }, 503);

  let body: CloseBody = {};
  try {
    body = ((await c.req.json()) as CloseBody) ?? {};
  } catch {
    // Empty bodies allowed for the legacy fallback path; non-JSON is not.
    return c.json({ error: "Invalid JSON" }, 400);
  }

  let agent: AgentRow;
  try {
    const fetchRes = await dbQuery<AgentRow>(
      `SELECT * FROM agents WHERE sns = $1 LIMIT 1`,
      [sns],
    );
    if (!fetchRes || fetchRes.rows.length === 0) {
      return c.json({ error: "Not found" }, 404);
    }
    agent = fetchRes.rows[0];
  } catch {
    return c.json({ error: "Not found" }, 404);
  }

  // Auth check: prefer signed claim. Fall back to plain callerWallet for the
  // hackathon (TODO: remove the fallback before mainnet — taking the caller's
  // word for it is no real auth).
  if (body.signedClaim) {
    const verdict = verifyCloseClaim(body.signedClaim, sns, agent.owner_wallet);
    if (!verdict.ok) {
      return c.json({ error: `auth: ${verdict.reason}` }, 403);
    }
  } else if (body.callerWallet) {
    if (body.callerWallet !== agent.owner_wallet) {
      return c.json({ error: "auth: callerWallet ≠ owner_wallet" }, 403);
    }
  } else {
    return c.json(
      {
        error:
          "auth: signedClaim {ownerWallet, message: 'close-vault:<sns>:<ts>', signature} required (or, hackathon fallback, callerWallet)",
      },
      403,
    );
  }

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
  if (!getPool()) return c.json({ error: "Database not configured" }, 503);

  let body: CloseBody = {};
  try {
    body = ((await c.req.json()) as CloseBody) ?? {};
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  let agent: AgentRow;
  try {
    const fetchRes = await dbQuery<AgentRow>(
      `SELECT * FROM agents WHERE sns = $1 LIMIT 1`,
      [sns],
    );
    if (!fetchRes || fetchRes.rows.length === 0) {
      return c.json({ error: "Not found" }, 404);
    }
    agent = fetchRes.rows[0];
  } catch {
    return c.json({ error: "Not found" }, 404);
  }

  // Same auth check as /close.
  if (body.signedClaim) {
    const verdict = verifyCloseClaim(body.signedClaim, sns, agent.owner_wallet);
    if (!verdict.ok) {
      return c.json({ error: `auth: ${verdict.reason}` }, 403);
    }
  } else if (body.callerWallet) {
    if (body.callerWallet !== agent.owner_wallet) {
      return c.json({ error: "auth: callerWallet ≠ owner_wallet" }, 403);
    }
  } else {
    return c.json(
      {
        error:
          "auth: signedClaim required (or, hackathon fallback, callerWallet)",
      },
      403,
    );
  }

  if (!canTransition(agent.status, "retired")) {
    return c.json(
      { error: `Cannot transition from ${agent.status} to retired` },
      409,
    );
  }

  try {
    await dbQuery(
      `UPDATE agents SET status = $1 WHERE sns = $2`,
      ["retired", sns],
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  return c.json({ ok: true });
});
