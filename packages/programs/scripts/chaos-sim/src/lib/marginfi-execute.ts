/**
 * marginfi-execute.ts — MarginFi v2 lend executor against the surfpool
 * mainnet fork. Mirrors zeta-execute.ts in shape:
 *
 *   - lazy-load a `MarginfiClient` once per process,
 *   - cache one `MarginfiAccountWrapper` per agent pubkey,
 *   - in-flight load promise dedup so concurrent ticks share the wait.
 *
 * Bootstrap on the FIRST lend call for an agent:
 *   1. Lazy-load MarginfiClient targeting `Environment.MAINNET` — surfpool
 *      is a mainnet fork so the global Group + bank accounts are inherited
 *      verbatim.
 *   2. Resolve the USDC bank inside the MAIN GROUP (MarginFi has no
 *      "main pool" abstraction — the global Group account is
 *      `4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8`).
 *   3. If the agent has no MarginfiAccount yet, create one. Otherwise
 *      fetch the first one in their account list.
 *   4. Issue `account.deposit(amount, bank)` (deposit) or
 *      `account.withdraw(amount, bank, withdrawAll?)` (withdraw).
 *
 * RUNTIME CAVEATS:
 *   - `@mrgnlabs/marginfi-client-v2` is NOT currently in
 *     packages/programs/package.json. Until it is, this module exports
 *     STUB functions that throw a clear error explaining the missing
 *     dependency. The action-executor catches the throw and bubbles it
 *     up to the daemon's per-action try/catch as `phase=execute_error`.
 *   - The agent's USDC ATA must hold enough USDC for deposit. The daemon
 *     calls `ensureSurfpoolUsdc` per-tick (see surfpool-seed.ts) so this
 *     is normally already-funded by the time we land here.
 *   - Surfpool tx hygiene: blockhash @ "processed", lastValidBlockHeight
 *     + 300 slots, skipPreflight: true. Same pattern as
 *     beethoven-execute.ts and kamino-execute.ts.
 *
 * NAMED PUBKEYS (mainnet, inherited by the fork):
 *   - Program  MFv2hWf31Z9kbCa1snEPdcgp7X3wCuuRcuDNmq1H5NE
 *   - Group    4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8
 *   - USDC bank 2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB
 *
 * The bank pubkey is left configurable via the optional `bankAddress` arg
 * so the brain (or a future operator) can target SOL / mSOL / etc. Default
 * is the USDC bank.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

import { ensureSurfpoolUsdc, MAINNET_USDC_MINT } from "./surfpool-seed.js";

// ─── Mainnet constants ────────────────────────────────────────────────────

/** MarginFi v2 program (mainnet — same id on the surfpool fork). */
export const MARGINFI_PROGRAM_ID =
  "MFv2hWf31Z9kbCa1snEPdcgp7X3wCuuRcuDNmq1H5NE";

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

// ─── Module-level caches (matches zeta-execute.ts pattern) ────────────────
//
// The MarginfiClient is loaded lazily once per process; per-agent
// MarginfiAccountWrapper instances are cached by base58 pubkey. The
// in-flight promise maps prevent duplicate loads when two ticks fire
// against a fresh process simultaneously.
//
// NOTE: types are `unknown` because `@mrgnlabs/marginfi-client-v2` is not
// installed yet. When the SDK is added the imports + types should be
// switched over (see the TODO at the bottom of this file).

let mfiClient: unknown = null;
let mfiClientLoadPromise: Promise<unknown> | null = null;

const accountCache = new Map<string, unknown>();
const accountLoadPromises = new Map<string, Promise<unknown>>();

// ─── Public API (stubbed until SDK lands) ─────────────────────────────────

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
 * Throw a structured "SDK missing" error so callers know exactly what's
 * unwired. The daemon's try/catch surfaces this as a phase=execute_error
 * row in the action log.
 */
function sdkMissingError(direction: "deposit" | "withdraw"): never {
  throw new Error(
    `marginfi-execute: cannot ${direction} — @mrgnlabs/marginfi-client-v2 is not installed. ` +
      `Add it to packages/programs/package.json devDependencies (latest stable: ^2.x), ` +
      `then replace the stub bodies in lib/marginfi-execute.ts with the real SDK calls ` +
      `(MarginfiClient.fetch + MarginfiAccountWrapper.deposit/withdraw).`,
  );
}

/**
 * Deposit `amountUi` of `bankAddress`'s liquidity mint into MarginFi.
 *
 * STUB: throws `sdkMissingError` until @mrgnlabs/marginfi-client-v2 is
 * added to devDependencies. The bootstrap flow once the SDK is present:
 *
 *   1. Ensure agent has USDC on the fork (calls ensureSurfpoolUsdc).
 *   2. Boot or reuse the cached MarginfiClient.
 *   3. Resolve the bank from `bankAddress ?? MARGINFI_USDC_BANK`.
 *   4. Find or create a MarginfiAccount for the agent (cached per pubkey).
 *   5. Build an ATA-create-idempotent + bank.deposit ix bundle and submit
 *      with the standard surfpool tx hygiene.
 *
 * Caller contract: this function HARD-FAILS on any error (including the
 * SDK-missing stub). Do not let action-executor swallow the throw and
 * fall through to a self-transfer placeholder — the failure mode IS the
 * signal.
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
  await ensureSurfpoolUsdc(surfpool, vault.publicKey, Math.max(amountUi, 1000));

  // Touch the cache maps so the linter doesn't flag them as unused while
  // the SDK is missing — the real implementation will hydrate them.
  void mfiClient;
  void mfiClientLoadPromise;
  void accountCache;
  void accountLoadPromises;

  // TODO(marginfi): replace this stub once @mrgnlabs/marginfi-client-v2 is
  // added. Shape of the real call (against MAINNET config):
  //
  //   import { MarginfiClient, getConfig } from "@mrgnlabs/marginfi-client-v2";
  //   import { NodeWallet } from "@mrgnlabs/mrgn-common";
  //   const config = getConfig("production");
  //   const client = await MarginfiClient.fetch(
  //     config, new NodeWallet(vault), surfpool,
  //   );
  //   const bank = client.getBankByPk(new PublicKey(bankAddress));
  //   const accounts = await client.getMarginfiAccountsForAuthority(vault.publicKey);
  //   const account = accounts[0] ?? await client.createMarginfiAccount();
  //   const txSig = await account.deposit(amountUi, bank.address);
  sdkMissingError("deposit");

  // Unreachable — sdkMissingError throws. The block below documents the
  // intended return shape for the real implementation.
  // eslint-disable-next-line @typescript-eslint/no-unreachable
  return {
    protocol: "marginfi",
    action: "lend_deposit",
    txSig: "",
    bankAddress,
    bankMint: MAINNET_USDC_MINT,
    amountBaseUnits: Math.round(amountUi * 1_000_000),
    marginfiAccount: "",
    ixCount: 0,
  };
}

/**
 * Withdraw `amountUi` (or all) of the bank's liquidity mint from MarginFi.
 *
 * STUB: throws `sdkMissingError` until @mrgnlabs/marginfi-client-v2 is
 * added. Real implementation will:
 *   1. Boot or reuse the cached MarginfiClient.
 *   2. Resolve the agent's MarginfiAccount (must already exist — withdraw
 *      from a non-existent account hard-fails, mirroring Kamino).
 *   3. Resolve the bank.
 *   4. Submit `account.withdraw(amountUi, bank, withdrawAll)`. The SDK
 *      clamps to deposited collateral when `withdrawAll=true`.
 */
export async function withdrawMarginfi(
  args: WithdrawMarginfiArgs,
): Promise<MarginfiWithdrawResult> {
  const { amountUi } = args;
  if (amountUi <= 0 && !args.withdrawAll) {
    throw new Error(
      `withdrawMarginfi: amountUi must be > 0 unless withdrawAll=true (got ${amountUi})`,
    );
  }
  const bankAddress = args.bankAddress ?? MARGINFI_USDC_BANK;

  // TODO(marginfi): replace stub. See depositMarginfi for the full SDK
  // shape — withdraw uses `account.withdraw(amountUi, bank.address, withdrawAll)`.
  sdkMissingError("withdraw");

  // eslint-disable-next-line @typescript-eslint/no-unreachable
  return {
    protocol: "marginfi",
    action: "lend_withdraw",
    txSig: "",
    bankAddress,
    bankMint: MAINNET_USDC_MINT,
    amountBaseUnits: Math.round(amountUi * 1_000_000),
    marginfiAccount: "",
    ixCount: 0,
  };
}

// ─── TODOs (Phase Q follow-up) ────────────────────────────────────────────
//
// 1. Add `@mrgnlabs/marginfi-client-v2` (and transitively
//    `@mrgnlabs/mrgn-common` for `NodeWallet`) to
//    packages/programs/package.json devDependencies.
//
// 2. Replace `sdkMissingError` calls with the real SDK paths sketched in
//    the TODO comments above. Both functions return shapes are already
//    defined; only the body needs swapping in.
//
// 3. The cache maps (mfiClient / accountCache / *LoadPromises) are wired
//    in shape but not populated — `void`-marked to satisfy the linter.
//    When the SDK lands, populate them on first call (singleton client +
//    per-agent account) following zeta-execute.ts's pattern.
//
// 4. Idempotent USDC ATA create: the SDK's `account.deposit` already
//    bundles the destination ATA setup, but for symmetry with Kamino we
//    may want to prepend a `createAssociatedTokenAccountIdempotentInstruction`
//    explicitly so the resulting tx works even on the very first call.
//    The boilerplate is imported above in anticipation:
void createAssociatedTokenAccountIdempotentInstruction;
void getAssociatedTokenAddressSync;
void sendAndConfirmTransaction;
void Transaction;
void PublicKey;
