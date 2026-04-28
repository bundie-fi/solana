/**
 * marginfi-execute.ts — MarginFi v2 lend executor against the surfpool
 * mainnet fork. Mirrors zeta-execute.ts in shape:
 *
 *   - lazy-load `@mrgnlabs/marginfi-client-v2` ONCE per process via
 *     dynamic import (NOT static `import`) so eagerly importing this
 *     module (e.g. from action-executor.ts) doesn't drag the SDK chain
 *     in at daemon startup. The SDK transitively pulls older
 *     @solana/web3.js variants which would re-trigger the rpc-websockets
 *     ESM crash that already cost us a session — same precaution as
 *     zeta-execute. Lazy-load is mandatory, not optional.
 *   - cache one `MarginfiClient` per process,
 *   - cache one `MarginfiAccountWrapper` per agent pubkey,
 *   - in-flight load promise dedup so concurrent ticks share the wait.
 *
 * Bootstrap on the FIRST lend call for an agent:
 *   1. Lazy-load MarginfiClient targeting `Environment.production` —
 *      surfpool is a mainnet fork so the global Group + bank accounts
 *      are inherited verbatim.
 *   2. Resolve the USDC bank inside the MAIN GROUP (MarginFi has no
 *      "main pool" abstraction — the global Group account is
 *      `4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8`).
 *   3. If the agent has no MarginfiAccount yet, create one. Otherwise
 *      fetch the first one in their account list.
 *   4. Issue `account.deposit(amount, bank)` (deposit) or
 *      `account.withdraw(amount, bank, withdrawAll?)` (withdraw).
 *
 * Withdraw paths HARD-FAIL when the agent has no MarginfiAccount —
 * trying to flatten a position that doesn't exist is operator error,
 * not a recoverable condition.
 *
 * NAMED PUBKEYS (mainnet, inherited by the fork):
 *   - Program  MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA
 *   - Group    4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8
 *   - USDC bank 2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB
 *
 * The bank pubkey is left configurable via the optional `bankAddress` arg
 * so the brain (or a future operator) can target SOL / mSOL / etc. Default
 * is the USDC bank.
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { ensureSurfpoolUsdc, MAINNET_USDC_MINT } from "./surfpool-seed.js";

// Re-export so callers can import the mint constant from a single place.
export { MAINNET_USDC_MINT };

// ─── Mainnet constants ────────────────────────────────────────────────────

/** MarginFi v2 program (mainnet — same id on the surfpool fork). */
export const MARGINFI_PROGRAM_ID =
  "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA";

/**
 * MarginFi's global Group account on mainnet. There is no "main pool"
 * concept in MarginFi v2 — every bank lives under this single Group, and
 * the brain reasons in terms of (group, bank) tuples.
 */
export const MARGINFI_MAIN_GROUP =
  "4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8";

/**
 * MarginFi USDC bank (mainnet). Sourced from the production
 * MarginFi UI's bank list. Leave the bank arg unset to default here.
 */
export const MARGINFI_USDC_BANK =
  "2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB";

// ─── Result types ─────────────────────────────────────────────────────────

export interface MarginfiDepositResult {
  protocol: "marginfi";
  action: "lend_deposit";
  txSig: string;
  /** Bank that received the deposit. */
  bankAddress: string;
  /** Liquidity mint of the bank (USDC by default). */
  bankMint: string;
  /** Base units of `bankMint` deposited. */
  amountBaseUnits: number;
  /** MarginfiAccount the deposit landed in. */
  marginfiAccount: string;
  /** Number of ix's bundled into the submitted tx (informational). */
  ixCount: number;
}

export interface MarginfiWithdrawResult {
  protocol: "marginfi";
  action: "lend_withdraw";
  txSig: string;
  bankAddress: string;
  bankMint: string;
  /** Base units requested. SDK clamps to deposited amount on withdraw_all. */
  amountBaseUnits: number;
  marginfiAccount: string;
  ixCount: number;
}

// ─── Module-level caches ──────────────────────────────────────────────────
//
// Types use SDK shapes resolved at runtime; we keep them as `unknown` at
// the type level so TS doesn't pull `@mrgnlabs/marginfi-client-v2` into
// the static import graph. The runtime cast inside the lazy-load
// boundary is the single source of truth.

let mfiClient: unknown = null;
let mfiClientLoadPromise: Promise<unknown> | null = null;

const accountCache = new Map<string, unknown>();
const accountLoadPromises = new Map<string, Promise<unknown>>();

// ─── Lazy SDK loader ─────────────────────────────────────────────────────

/**
 * Single dynamic-import wrapper. ALL access to `@mrgnlabs/marginfi-client-v2`
 * must go through this helper so the SDK is never pulled into a module
 * graph that gets eagerly resolved by the daemon's static-import scan.
 *
 * Returns the *namespace object* of the package — callers destructure the
 * symbols they need (MarginfiClient, getConfig, etc).
 */
async function loadMarginfiSdk(): Promise<typeof import("@mrgnlabs/marginfi-client-v2")> {
  return await import("@mrgnlabs/marginfi-client-v2");
}

async function loadMrgnCommon(): Promise<typeof import("@mrgnlabs/mrgn-common")> {
  return await import("@mrgnlabs/mrgn-common");
}

/**
 * Resolve (and cache) the per-process `MarginfiClient`. The wallet on the
 * client is whichever agent triggered the first load — this is fine
 * because client-level operations we use (getBankByPk,
 * getMarginfiAccountsForAuthority) don't depend on the wallet identity;
 * per-agent state is held inside MarginfiAccountWrapper instances.
 */
async function ensureMarginfiClient(
  surfpool: Connection,
  bootstrapKp: Keypair,
): Promise<unknown> {
  if (mfiClient) return mfiClient;
  if (mfiClientLoadPromise) return await mfiClientLoadPromise;
  mfiClientLoadPromise = (async () => {
    const sdk = await loadMarginfiSdk();
    const common = await loadMrgnCommon();
    const config = sdk.getConfig("production");
    const wallet = new common.NodeWallet(bootstrapKp);
    const client = await sdk.MarginfiClient.fetch(config, wallet, surfpool);
    mfiClient = client;
    return client;
  })();
  try {
    return await mfiClientLoadPromise;
  } finally {
    mfiClientLoadPromise = null;
  }
}

/**
 * Eagerly load the MarginFi v2 client + bank cache so the first agent's
 * first lend action isn't blocked by `MarginfiClient.fetch`'s
 * getProgramAccounts enumeration of every bank under the main group
 * (15-30s on a cold surfpool fork).
 *
 * Mirrors `prewarmZetaExchange` in zeta-execute.ts:
 *   - Idempotent: if `mfiClient` is already populated, returns true
 *     immediately. The cached client itself is the dedup signal — no
 *     parallel `marginfiPrewarmed` flag.
 *   - Fork-reset-safe: a clean `mfiClient = null` (e.g. after a fresh
 *     module load) makes prewarm retry the load. The lazy bootstrap in
 *     `depositMarginfi` / `withdrawMarginfi` is the safety net — if
 *     prewarm fails (timeout, transient RPC error, …) the lazy path
 *     retries on the first lend action.
 *   - Never throws: returns false on failure so daemon startup proceeds.
 *
 * Bootstrap keypair: a fresh ephemeral Keypair is fine here — the
 * client's wallet is a no-op for `MarginfiClient.fetch` itself
 * (which only uses the connection + program-id) and per-agent calls
 * rebind the wallet via `(client as any).wallet = …` inside
 * `ensureMarginfiAccount`. Using an ephemeral keypair avoids requiring
 * the daemon to surface an agent keypair at prewarm time.
 */
export async function prewarmMarginfiClient(
  surfpool: Connection,
  timeoutMs = 60_000,
): Promise<boolean> {
  if (mfiClient) {
    console.log("[marginfi-prewarm] client already cached — no-op");
    return true;
  }
  const start = Date.now();
  // Ephemeral bootstrap keypair — see jsdoc above.
  const bootstrapKp = Keypair.generate();
  try {
    await Promise.race([
      ensureMarginfiClient(surfpool, bootstrapKp),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `prewarmMarginfiClient timed out after ${timeoutMs}ms`,
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);
    const elapsedMs = Date.now() - start;
    console.log(
      `[marginfi-prewarm] MarginfiClient.fetch complete in ${elapsedMs}ms (lazy path now no-op)`,
    );
    return true;
  } catch (e) {
    const elapsedMs = Date.now() - start;
    console.warn(
      `[marginfi-prewarm] failed after ${elapsedMs}ms: ${(e as Error).message} — lazy load will retry on first lend action`,
    );
    return false;
  }
}

/**
 * Resolve the agent's MarginfiAccountWrapper, optionally creating one if
 * `createIfMissing` is true. The cache is keyed on the agent's base58
 * pubkey so concurrent ticks for the same agent reuse the wrapper.
 *
 * `createIfMissing=false` (used by withdraw) returns null when the agent
 * has never deposited — the caller hard-fails on this.
 */
async function ensureMarginfiAccount(
  surfpool: Connection,
  kp: Keypair,
  createIfMissing: boolean,
): Promise<unknown | null> {
  const key = kp.publicKey.toBase58();
  const cached = accountCache.get(key);
  if (cached) return cached;
  const inflight = accountLoadPromises.get(key);
  if (inflight) return await inflight;

  const promise = (async () => {
    const client = await ensureMarginfiClient(surfpool, kp);
    // Re-bind the wallet on the (already-cached) client to this agent so
    // subsequent deposit/withdraw signatures are produced by the right
    // keypair. The SDK exposes `wallet` as a writable readonly field —
    // we need it to be the agent's wallet at the moment of submission.
    // Doing this on every call is cheap (no RPC) and avoids us having to
    // rebuild the client for every agent.
    const common = await loadMrgnCommon();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).wallet = new common.NodeWallet(kp);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = await (client as any).getMarginfiAccountsForAuthority(
      kp.publicKey,
    );
    if (accounts.length > 0) {
      accountCache.set(key, accounts[0]);
      return accounts[0];
    }
    if (!createIfMissing) {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acct = await (client as any).createMarginfiAccount();
    accountCache.set(key, acct);
    return acct;
  })();
  accountLoadPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    accountLoadPromises.delete(key);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface DepositMarginfiArgs {
  /** web3.js Connection pointed at surfpool. */
  surfpool: Connection;
  /** Agent keypair. */
  vault: Keypair;
  /** Amount in UI units of the bank's liquidity mint (USDC: 1.0 = 1 USDC). */
  amountUi: number;
  /** Optional bank override; defaults to MARGINFI_USDC_BANK. */
  bankAddress?: string;
}

export interface WithdrawMarginfiArgs {
  surfpool: Connection;
  vault: Keypair;
  /** UI amount to withdraw. Pass a value larger than balance to flatten. */
  amountUi: number;
  bankAddress?: string;
  /** If true the SDK closes out the entire position regardless of `amountUi`. */
  withdrawAll?: boolean;
}

/**
 * Deposit `amountUi` of `bankAddress`'s liquidity mint into MarginFi.
 *
 * Flow (mirrors kamino-execute):
 *   1. Ensure agent has USDC on the fork (calls ensureSurfpoolUsdc).
 *   2. Boot or reuse the cached MarginfiClient.
 *   3. Resolve the bank from `bankAddress ?? MARGINFI_USDC_BANK`.
 *   4. Find or create a MarginfiAccount for the agent (cached per pubkey).
 *   5. Submit `account.deposit(amountUi, bankAddress)` — the SDK builds
 *      the deposit ix, submits it through the connection, and returns
 *      the tx signature. SDK handles ATA setup internally.
 *
 * Caller contract: hard-fails on any error. action-executor surfaces
 * the throw as `phase=execute_error` rather than falling through to a
 * placeholder self-transfer.
 */
export async function depositMarginfi(
  args: DepositMarginfiArgs,
): Promise<MarginfiDepositResult> {
  const { surfpool, vault, amountUi } = args;
  if (amountUi <= 0) {
    throw new Error(
      `depositMarginfi: amountUi must be > 0 (got ${amountUi})`,
    );
  }
  const bankAddress = args.bankAddress ?? MARGINFI_USDC_BANK;

  // Belt-and-braces USDC seeding before the deposit attempt. When the
  // daemon's per-tick seed has already topped the agent up this is a
  // single getTokenAccountBalance round-trip and a no-op.
  const usdcResult = await ensureSurfpoolUsdc(
    surfpool,
    vault.publicKey,
    amountUi,
  );

  const account = await ensureMarginfiAccount(surfpool, vault, true);
  if (!account) {
    // ensureMarginfiAccount with createIfMissing=true should never return
    // null — defensive guard so a future SDK change can't break us silently.
    throw new Error(
      "depositMarginfi: ensureMarginfiAccount returned null even with createIfMissing=true",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acctAny = account as any;
  const bankPubkey = new PublicKey(bankAddress);
  const txSig: string = await acctAny.deposit(amountUi, bankPubkey);

  const marginfiAccountPk: string =
    typeof acctAny.address?.toBase58 === "function"
      ? acctAny.address.toBase58()
      : String(acctAny.address ?? "unknown");

  console.log(
    `[marginfi] deposit ${amountUi} UI → bank ${bankAddress.slice(0, 8)}…  acct=${marginfiAccountPk.slice(0, 8)}…  usdcFunding=${usdcResult.method}`,
  );

  return {
    protocol: "marginfi",
    action: "lend_deposit",
    txSig,
    bankAddress,
    bankMint: MAINNET_USDC_MINT,
    amountBaseUnits: Math.round(amountUi * 1_000_000),
    marginfiAccount: marginfiAccountPk,
    // SDK builds & submits the tx internally; we don't see the ix list.
    // 1 is a placeholder for "real CPI submitted" — UI consumers only
    // use the existence/absence of txSig anyway.
    ixCount: 1,
  };
}

/**
 * Withdraw `amountUi` (or all) of the bank's liquidity mint from MarginFi.
 *
 * Flow:
 *   1. Boot or reuse the cached MarginfiClient.
 *   2. Resolve the agent's MarginfiAccount — HARD-FAIL if none exists.
 *      No fallback: a withdraw that quietly succeeds when nothing was
 *      deposited would corrupt the action log.
 *   3. Submit `account.withdraw(amountUi, bank, withdrawAll)`. SDK
 *      clamps to deposited collateral when `withdrawAll=true`.
 */
export async function withdrawMarginfi(
  args: WithdrawMarginfiArgs,
): Promise<MarginfiWithdrawResult> {
  const { surfpool, vault, amountUi } = args;
  if (amountUi <= 0 && !args.withdrawAll) {
    throw new Error(
      `withdrawMarginfi: amountUi must be > 0 unless withdrawAll=true (got ${amountUi})`,
    );
  }
  const bankAddress = args.bankAddress ?? MARGINFI_USDC_BANK;

  const account = await ensureMarginfiAccount(surfpool, vault, false);
  if (!account) {
    throw new Error(
      `withdrawMarginfi: agent ${vault.publicKey.toBase58()} has no MarginfiAccount under group ${MARGINFI_MAIN_GROUP} — nothing to withdraw`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acctAny = account as any;
  const bankPubkey = new PublicKey(bankAddress);
  const txSig: string = await acctAny.withdraw(
    amountUi,
    bankPubkey,
    args.withdrawAll ?? false,
  );

  const marginfiAccountPk: string =
    typeof acctAny.address?.toBase58 === "function"
      ? acctAny.address.toBase58()
      : String(acctAny.address ?? "unknown");

  console.log(
    `[marginfi] withdraw ${amountUi} UI ← bank ${bankAddress.slice(0, 8)}…  acct=${marginfiAccountPk.slice(0, 8)}…  withdrawAll=${args.withdrawAll ?? false}`,
  );

  return {
    protocol: "marginfi",
    action: "lend_withdraw",
    txSig,
    bankAddress,
    bankMint: MAINNET_USDC_MINT,
    amountBaseUnits: Math.round(amountUi * 1_000_000),
    marginfiAccount: marginfiAccountPk,
    ixCount: 1,
  };
}
