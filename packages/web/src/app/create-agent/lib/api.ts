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
  | "solend"
  | "marinade"
  | "jito"
  | "zeta";

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
  opts: { maxRetries?: number } = {},
): Promise<{ ok: boolean }> {
  const maxRetries = opts.maxRetries ?? 3;
  let lastErr: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const r = await fetch(
        `${BACKEND_URL}/api/agents/${encodeURIComponent(sns)}/confirm-init`,
        { method: "POST" },
      );
      if (r.ok) return r.json();
      if (r.status >= 500) {
        // Server error — retry with exponential backoff.
        lastErr = new Error(
          `confirmInit ${r.status}: ${await r.text().catch(() => "")}`,
        );
        await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, i)));
        continue;
      }
      // 4xx — don't retry, surface so the caller can show recovery UI
      // (the user has already paid for + broadcast deposit_to_vault).
      throw new Error(
        `confirmInit failed: ${r.status} ${await r.text().catch(() => "")}`,
      );
    } catch (e) {
      lastErr = e as Error;
      // If the throw above was the 4xx branch, don't retry — re-throw now.
      if (lastErr.message.startsWith("confirmInit failed:")) throw lastErr;
      await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, i)));
    }
  }
  throw lastErr ?? new Error("confirmInit failed after retries");
}

export async function snsAvailable(sns: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${BACKEND_URL}/api/agents?sns=${encodeURIComponent(sns)}`,
    );
    if (!r.ok) {
      // Production: fail-closed (block Next click) so two users can't
      // race the same SNS. Dev: fail-open so local backend hiccups don't
      // make the wizard unusable.
      if (process.env.NODE_ENV === "production") return false;
      return true;
    }
    const data = (await r.json()) as { agents?: unknown[] };
    return (data.agents ?? []).length === 0;
  } catch {
    if (process.env.NODE_ENV === "production") return false;
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
