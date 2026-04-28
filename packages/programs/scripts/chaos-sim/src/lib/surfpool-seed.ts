/**
 * surfpool-seed.ts — single canonical USDC seeder for the surfpool fork.
 *
 * Surfpool exposes a custom JSON-RPC method `surfnet_setTokenAccount` that
 * lets us mint arbitrary token-account state on the forked chain without
 * ever submitting a transaction. The method is documented at
 * https://docs.surfpool.run/cheatcodes — the parameter shape it actually
 * accepts (verified live against bundie-surfpool-production.up.railway.app
 * on 2026-04-27) is THREE positional arguments:
 *
 *   1. owner pubkey (base58 string)
 *   2. mint pubkey  (base58 string)
 *   3. TokenAccountUpdate struct, e.g. { "amount": <integer base units> }
 *
 * Examples we tried during verification (and what each returned):
 *
 *   ✗ params: [{owner, mint, amount}]
 *     → -32602 "`params` should have at least 3 argument(s)"
 *   ✗ params: [owner, mint, "1000000000"]
 *     → -32602 invalid type: string ... expected struct TokenAccountUpdate
 *   ✓ params: [owner, mint, {amount: 1000000000}]
 *     → result: { context: {...}, value: null }
 *
 * The cheat-code creates the agent's USDC ATA on demand (we do not have to
 * pre-create it), and the resulting ATA reads back as `state: initialized`
 * via `getTokenAccountsByOwner`.
 *
 * This module is the single source of truth for USDC seeding on surfpool.
 * `kamino-execute.ts` and `zeta-execute.ts` both delegate here. The daemon
 * also calls it once per tick (after the SOL airdrop) so a fork reset
 * self-heals USDC balances on the next tick.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

/** Real mainnet USDC mint — surfpool fork inherits the state. */
export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * Default top-up amount when the caller doesn't specify. Used only by the
 * legacy hardcoded agents (alice/bob/charlie) where there's no per-agent
 * seed amount to reference. Wizard-created agents always pass through
 * their own `seedAmountBaseUnits` so the topup is sized to the user's
 * actual on-chain stake — never inflated to a hidden floor.
 */
const USDC_TOPUP_TARGET_UI = 50;

const USDC_DECIMALS = 6;

export interface SeedUsdcResult {
  /** True if the agent now has ≥ requiredUi USDC (post-call). */
  funded: boolean;
  /** USDC balance after the call, in base units. */
  balanceBaseUnits: number;
  /** How the balance was achieved this call. */
  method:
    | "noop_already_funded"
    | "surfnet_setTokenAccount"
    | "rpc_error"
    | "rpc_unreachable"
    | "skipped_unreachable";
  /** Optional human-readable note for logs. */
  note?: string;
}

/**
 * Ensure `agentPubkey` holds at least `amountUi` USDC on the surfpool fork.
 * Idempotent — when the existing balance already covers the floor we just
 * return without touching the cheat-code RPC.
 *
 * The default floor is `USDC_REFILL_FLOOR_UI` (500 USDC); pass a smaller
 * `amountUi` only if the caller specifically needs less and is willing to
 * pay the cheat-code RPC round-trip on every tick.
 *
 * Errors from `surfnet_setTokenAccount` are logged but never thrown —
 * surfpool deployments without the cheat-code patched in (or transient RPC
 * blips) fall through to the caller's normal error path. Returning a
 * descriptive `method` lets the caller surface the failure mode in logs.
 */
export async function ensureSurfpoolUsdc(
  connection: Connection,
  agentPubkey: PublicKey,
  amountUi: number = USDC_TOPUP_TARGET_UI,
): Promise<SeedUsdcResult> {
  const usdcMint = new PublicKey(MAINNET_USDC_MINT);
  const ata = getAssociatedTokenAddressSync(usdcMint, agentPubkey);

  // The cheat-code is per-mint absolute, not additive. We only re-seed if
  // the agent's balance has dipped below the requested target — this is
  // the cheap path that makes per-tick wiring viable.
  //
  // Caller-controlled, no hidden floor: passing amountUi=50 means "agent
  // should never have more than $50 from cheat-code seeding alone." Any
  // additional value comes from strategy receipts (Kamino reserve tokens,
  // mSOL, etc.) — those are real fork-state, not magic-minted.
  const targetBaseUnits = Math.max(
    1,
    Math.floor(amountUi * 10 ** USDC_DECIMALS),
  );

  let currentBalance = 0;
  try {
    const resp = await connection.getTokenAccountBalance(ata, "confirmed");
    currentBalance = Number(resp.value.amount);
  } catch {
    // Missing ATA → 0 balance, treat as needs-funding.
    currentBalance = 0;
  }
  if (currentBalance >= targetBaseUnits) {
    return {
      funded: true,
      balanceBaseUnits: currentBalance,
      method: "noop_already_funded",
    };
  }

  // surfnet_setTokenAccount takes 3 positional args:
  //   [ownerBase58, mintBase58, { amount: <integer base units> }]
  // The cheat-code creates the ATA on-demand if it doesn't exist yet.
  const rpcUrl = connection.rpcEndpoint;
  try {
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "surfnet_setTokenAccount",
        params: [
          agentPubkey.toBase58(),
          MAINNET_USDC_MINT,
          { amount: targetBaseUnits },
        ],
      }),
    });
    const body = (await resp.json()) as {
      result?: unknown;
      error?: { message?: string; code?: number };
    };
    if (body.error) {
      const note = `surfnet_setTokenAccount failed: ${body.error.message ?? "unknown"} (code=${body.error.code ?? "?"})`;
      console.warn(`[surfpool-seed] ${note}`);
      return {
        funded: false,
        balanceBaseUnits: currentBalance,
        method: "rpc_error",
        note,
      };
    }
    return {
      funded: true,
      balanceBaseUnits: targetBaseUnits,
      method: "surfnet_setTokenAccount",
    };
  } catch (e) {
    const note = `surfnet_setTokenAccount unreachable: ${(e as Error).message}`;
    console.warn(`[surfpool-seed] ${note}`);
    return {
      funded: false,
      balanceBaseUnits: currentBalance,
      method: "rpc_unreachable",
      note,
    };
  }
}
