/**
 * api.ts — typed wrappers for the Phase K+L backend routes consumed by
 * the /create-agent wizard.
 *
 * The backend routes live in `packages/backend/src/routes/agents.ts` and
 * `packages/backend/src/routes/faucet.ts`. They're being built on a
 * parallel branch — this client matches the contract documented in the
 * Phase M plan so we can typecheck and ship the wizard ahead of merge.
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000";

// ── Types ───────────────────────────────────────────────────────────────────

export type AgentPreset =
  | "balanced"
  | "aggressive"
  | "conservative"
  | "yield-hunter"
  | "perp-trader";

export type AgentProtocol =
  | "kamino"
  | "marginfi"
  | "marinade"
  | "jito"
  | "drift"
  | "orca";

export interface CreateAgentRequest {
  sns: string;
  displayName: string;
  tagline?: string;
  emoji?: string;
  ownerWallet: string;
  preset: AgentPreset;
  allowedProtocols: AgentProtocol[];
  perProtocolLimits?: Record<string, { maxNotionalUsd: number }>;
  seedAmountBusd: number;
  customBrainMd?: string;
}

export interface CreateAgentAgent {
  id: number;
  sns: string;
  vault_pda: string;
  agent_pubkey: string;
  owner_wallet: string;
  seed_amount_busd: number;
  status: string;
}

export interface CreateAgentResponse {
  agent: CreateAgentAgent;
  nextSteps: {
    ownerWallet: string;
    vaultPda: string;
    agentPubkey: string;
    treasuryMint: string;
    seedAmountBase: number;
    instructions: string[];
  };
}

export interface FaucetClaimResponse {
  txSig: string;
  amount: number;
  amountBase: number;
}

// ── Calls ───────────────────────────────────────────────────────────────────

export async function createAgent(
  req: CreateAgentRequest,
): Promise<CreateAgentResponse> {
  const r = await fetch(`${BACKEND_URL}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`createAgent failed: ${r.status} ${body}`);
  }
  return r.json();
}

export async function confirmInit(
  sns: string,
): Promise<{ ok: boolean }> {
  const r = await fetch(
    `${BACKEND_URL}/api/agents/${encodeURIComponent(sns)}/confirm-init`,
    { method: "POST" },
  );
  if (!r.ok) throw new Error(`confirmInit failed: ${r.status}`);
  return r.json();
}

export async function snsAvailable(sns: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${BACKEND_URL}/api/agents?sns=${encodeURIComponent(sns)}`,
    );
    if (!r.ok) return true; // fail open — backend down means no uniqueness check
    const data = (await r.json()) as { agents?: unknown[] };
    return (data.agents ?? []).length === 0;
  } catch {
    return true;
  }
}

export async function claimFaucet(
  wallet: string,
): Promise<FaucetClaimResponse> {
  const r = await fetch(`${BACKEND_URL}/api/faucet/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`faucet claim failed: ${r.status} ${body}`);
  }
  return r.json();
}
