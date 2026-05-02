/**
 * kamino-execute.ts — real Kamino lend deposit on the surfpool mainnet fork.
 *
 * Wraps `@kamino-finance/klend-sdk` (which is built on `@solana/kit`) and
 * exposes a thin shim that submits the resulting deposit tx via the existing
 * web3.js `Connection` the chaos-sim already passes around. Same pattern as
 * `marinade-execute.ts`: build a tx, send with `skipPreflight: true` and a
 * fat blockhash validity window so surfpool's slow confirmation polling
 * doesn't blow the window.
 *
 * Two pieces of glue that needed wiring:
 *   1. KaminoMarket.load needs an @solana/kit `Rpc<…>`, not a web3.js
 *      Connection. We construct one against the same RPC URL.
 *   2. KaminoAction.buildDepositTxns returns kit `Instruction[]`. The chaos
 *      sim is web3.js-based, so we shim each ix into a
 *      `TransactionInstruction` (programId + AccountMeta[] + Buffer).
 *
 * USDC funding: surfpool inherits the mainnet USDC mint state. The agent
 * keypair has no USDC ATA on a fresh fork though — we either airdrop USDC
 * via the surfpool-only `surfnet_setTokenAccount` RPC or hard-fail with a
 * helpful error. Idempotent: only acts when the agent's USDC balance is
 * below the deposit amount.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  AccountMeta,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  type Address,
  type Instruction,
  type AccountMeta as KitAccountMeta,
  type AccountLookupMeta as KitAccountLookupMeta,
} from "@solana/kit";
import {
  KaminoMarket,
  KaminoAction,
  VanillaObligation,
} from "@kamino-finance/klend-sdk";
import BN from "bn.js";

import { MAINNET_USDC_MINT } from "./surfpool-seed.js";

// Re-export so action-executor / other callers can keep importing from here.
export { MAINNET_USDC_MINT };

// ─── Surfpool / mainnet constants ────────────────────────────────────────

/** Kamino mainnet program id (also valid on the surfpool mainnet fork).
 *  Verified against mainnet RPC: this account exists and is executable.
 *  The earlier "…ber8p32L…" variant in this file was bogus (no such
 *  account on mainnet) and matches the on-chain owner used by
 *  commit-nav-helper.ts for reserve/obligation reads. */
export const KLEND_MAINNET_PROGRAM_ID =
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";

/** Kamino "Main Market" on mainnet (the deepest USDC reserve sits here). */
export const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";

/** Avg mainnet slot duration (used by klend for staleness math). */
const MAINNET_SLOT_DURATION_MS = 450;

// ─── Result type ────────────────────────────────────────────────────────

export interface KaminoDepositResult {
  protocol: "kamino";
  action: "lend_deposit";
  txSig: string;
  reserveAddress: string;
  reserveLiquidityMint: string;
  /** Base units (10^reserveDecimals) of the reserve's liquidity mint deposited. */
  amountBaseUnits: number;
  /** Number of ix's bundled into the deposit tx (setup + lending + cleanup). */
  ixCount: number;
}

export interface KaminoWithdrawResult {
  protocol: "kamino";
  action: "lend_withdraw";
  txSig: string;
  reserveAddress: string;
  reserveLiquidityMint: string;
  /** Base units (10^reserveDecimals) of the reserve's liquidity mint requested to withdraw. */
  amountBaseUnits: number;
  /** Number of ix's bundled into the withdraw tx (setup + lending + cleanup). */
  ixCount: number;
}

// ─── Kit ↔ web3.js shim ─────────────────────────────────────────────────

/**
 * Convert one @solana/kit Instruction into a web3.js TransactionInstruction.
 *
 * Kit's AccountRole is a 2-bit bitfield (see @solana/instructions/roles):
 *   bit 0 (value 1) = writable
 *   bit 1 (value 2) = signer
 * yielding READONLY=0, WRITABLE=1, READONLY_SIGNER=2, WRITABLE_SIGNER=3.
 *
 * AccountLookupMeta entries (used inside address-lookup tables) cannot be
 * expressed as a normal AccountMeta — we treat them as non-signer with the
 * resolved address. KaminoAction's deposit path doesn't emit lookup-table
 * entries today; this branch is a defensive fallback so a future SDK
 * upgrade can't silently corrupt the account list.
 */
function kitIxToWeb3Ix(ix: Instruction): TransactionInstruction {
  const programId = new PublicKey(ix.programAddress as string);
  const keys: AccountMeta[] = (ix.accounts ?? []).map((acc) => {
    if ((acc as KitAccountLookupMeta).addressIndex !== undefined) {
      const lookup = acc as KitAccountLookupMeta;
      return {
        pubkey: new PublicKey(lookup.address as string),
        isSigner: false,
        isWritable: !!(lookup.role & 1),
      };
    }
    const m = acc as KitAccountMeta;
    return {
      pubkey: new PublicKey(m.address as string),
      isSigner: !!(m.role & 2),
      isWritable: !!(m.role & 1),
    };
  });
  const data = Buffer.from(ix.data ?? new Uint8Array());
  return new TransactionInstruction({ programId, keys, data });
}

// ─── Main entry ────────────────────────────────────────────────────────

export interface DepositKaminoArgs {
  /** web3.js Connection pointed at surfpool. */
  surfpool: Connection;
  /** Agent keypair. */
  vault: Keypair;
  /**
   * Deposit amount in UI units of the reserve's liquidity mint (e.g. 0.5 =
   * 0.5 USDC for a USDC reserve, 0.5 mSOL for an mSOL reserve). Decimals
   * are read from the on-chain reserve, so any reserve the SDK can load is
   * supported.
   */
  amountUsdcUi: number;
  /**
   * RPC URL string — separate arg because @solana/kit needs the URL
   * directly to construct its own RPC client. Defaults to the surfpool
   * Connection's `rpcEndpoint`.
   */
  rpcUrl?: string;
  /** Optional reserve override; defaults to USDC reserve in the chosen market. */
  reserveAddress?: string;
  /** Optional Kamino market (lending-market) override. Defaults to
   *  KAMINO_MAIN_MARKET. Pass any market PDA the SDK can load — Multiply,
   *  JLP, isolated, etc. — to let the brain express strategies beyond
   *  main-pool USDC. */
  marketAddress?: string;
}

/**
 * Deposit USDC into Kamino's main-market USDC reserve on surfpool.
 *
 * Flow:
 *   1. Load KaminoMarket via @solana/kit RPC against the same URL the
 *      chaos-sim's web3.js Connection points at.
 *   2. Resolve the USDC reserve (caller can override; defaults to
 *      lookup-by-mint).
 *   3. Build setup + lending + cleanup ix's via KaminoAction.
 *   4. Shim them to web3.js TransactionInstructions.
 *   5. Submit via the existing surfpool Connection with the same
 *      `skipPreflight: true` + extended blockhash window pattern that
 *      Marinade uses (see marinade-execute.ts).
 *
 * If USDC funding via surfnet_setTokenAccount fails, we still attempt
 * the deposit — surfpool simulation will reject cleanly and the daemon's
 * try/catch will log it, rather than us deciding for the operator that
 * the deposit can't proceed.
 */
export async function depositKamino(
  args: DepositKaminoArgs,
): Promise<KaminoDepositResult> {
  const { surfpool, vault, amountUsdcUi } = args;
  // `amountUsdcUi` is the legacy field name; the value is now interpreted as
  // a UI amount in the reserve's liquidity-mint decimals (USDC-6, mSOL-9, …).
  const amountUi = amountUsdcUi;
  if (amountUi <= 0) {
    throw new Error(`depositKamino: amountUi must be > 0 (got ${amountUi})`);
  }
  const rpcUrl = args.rpcUrl ?? surfpool.rpcEndpoint;
  const marketAddress = args.marketAddress ?? KAMINO_MAIN_MARKET;

  // No per-action USDC topup. The agent's seed is established once by
  // the warmup loop (see warmup.ts — gated by agents.warmup_done_at).
  // Auto-refilling here would mask "agent already deployed its capital"
  // as "agent has fresh USDC to lend" and produce a re-lend loop. If
  // the agent's USDC ATA is empty, the SDK build below fails fast and
  // the brain learns it can't lend without first withdrawing.

  // 1. Build a kit Rpc + signer for the SDK to chew on. We're not actually
  //    using the kit signer to sign — we shim ix's back to web3.js and sign
  //    with the web3.js Keypair — but KaminoAction needs *something* that
  //    quacks like a TransactionSigner so it can attach the owner address.
  const kitRpc = createSolanaRpc(rpcUrl);
  const kitPayer = await createKeyPairSignerFromBytes(vault.secretKey);

  // 2. Load the market with the mainnet program id (NOT the SDK's default
  //    devnet PROGRAM_ID). Defaults to KAMINO_MAIN_MARKET; brain can
  //    target any other Kamino market via args.marketAddress.
  const market = await KaminoMarket.load(
    kitRpc,
    marketAddress as Address,
    MAINNET_SLOT_DURATION_MS,
    KLEND_MAINNET_PROGRAM_ID as Address,
    true,
  );
  if (!market) {
    throw new Error(
      `KaminoMarket.load returned null for ${marketAddress} — surfpool fork may not have the market state`,
    );
  }

  // 3. Resolve reserve. Default = USDC reserve via mint lookup.
  let reserve;
  if (args.reserveAddress) {
    reserve = market.reserves.get(args.reserveAddress as Address);
    if (!reserve) {
      throw new Error(
        `reserve ${args.reserveAddress} not in market ${marketAddress}`,
      );
    }
  } else {
    reserve = market.getReserveByMint(MAINNET_USDC_MINT as Address);
    if (!reserve) {
      throw new Error(
        `no USDC reserve found in market ${marketAddress} (mint ${MAINNET_USDC_MINT})`,
      );
    }
  }
  const reserveAddress = reserve.address as string;
  // Multi-asset deposits: read decimals from the reserve and scale the UI
  // amount accordingly. `getMintDecimals(): number` is the SDK's canonical
  // decimals accessor (see klend-sdk dist/classes/reserve.d.ts).
  const liquidityMint = String(reserve.getLiquidityMint());
  const reserveDecimals = reserve.getMintDecimals();
  const amountBaseUnits = Math.round(amountUi * 10 ** reserveDecimals);

  // 5. Have the SDK assemble the full deposit ix list (setup includes
  //    obligation init / refresh-reserve / refresh-obligation, etc).
  const action = await KaminoAction.buildDepositTxns(
    market,
    new BN(amountBaseUnits),
    liquidityMint as Address,
    kitPayer,
    new VanillaObligation(KLEND_MAINNET_PROGRAM_ID as Address),
    true, // useV2Ixs
    undefined, // scopeRefreshConfig — let SDK decide
  );

  // 6. Shim every kit ix into web3.js. The order matters: setup → lending → cleanup.
  const allKitIxs: Instruction[] = [
    ...action.computeBudgetIxs,
    ...action.setupIxs,
    ...action.lendingIxs,
    ...action.cleanupIxs,
  ];
  const web3Ixs = allKitIxs.map(kitIxToWeb3Ix);

  // 7. Belt-and-braces: prepend an idempotent ATA-create for the reserve's
  //    liquidity-mint ATA (whatever token that is). The SDK *should*
  //    include this in setupIxs already, but we add it defensively — the
  //    idempotent ix is a no-op when the ATA already exists.
  const liquidityMintPk = new PublicKey(liquidityMint);
  const liquidityAta = getAssociatedTokenAddressSync(
    liquidityMintPk,
    vault.publicKey,
  );
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    vault.publicKey,
    liquidityAta,
    vault.publicKey,
    liquidityMintPk,
  );

  const tx = new Transaction();
  tx.add(ataIx, ...web3Ixs);
  tx.feePayer = vault.publicKey;
  // Same surfpool-specific blockhash treatment as Marinade — see
  // marinade-execute.ts for the rationale.
  const { blockhash, lastValidBlockHeight } =
    await surfpool.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight + 300;

  console.log(
    `[kamino] deposit ${amountUi} (mint ${liquidityMint.slice(0, 8)}…) → market ${marketAddress.slice(0, 8)}…/reserve ${reserveAddress.slice(0, 8)}…  ixs=${web3Ixs.length + 1}`,
  );

  const txSig = await sendAndConfirmTransaction(surfpool, tx, [vault], {
    commitment: "confirmed",
    skipPreflight: true,
  });

  return {
    protocol: "kamino",
    action: "lend_deposit",
    txSig,
    reserveAddress,
    reserveLiquidityMint: liquidityMint,
    amountBaseUnits,
    ixCount: web3Ixs.length + 1,
  };
}

// ─── Withdraw ─────────────────────────────────────────────────────────────

export interface WithdrawKaminoArgs {
  /** web3.js Connection pointed at surfpool. */
  surfpool: Connection;
  /** Agent keypair. */
  vault: Keypair;
  /**
   * UI amount to withdraw, in the reserve's liquidity-mint decimals (e.g.
   * 0.5 = 0.5 USDC for a USDC reserve, 0.5 mSOL for an mSOL reserve).
   * Pass a value larger than the agent's deposited balance to flatten the
   * position — the SDK clamps to the obligation's available collateral.
   */
  amountUsdcUi: number;
  /** Optional RPC override; defaults to surfpool.rpcEndpoint. */
  rpcUrl?: string;
  /** Optional reserve override; defaults to USDC reserve in the chosen market. */
  reserveAddress?: string;
  /** Optional Kamino market override (defaults to KAMINO_MAIN_MARKET). */
  marketAddress?: string;
}

/**
 * Withdraw USDC from Kamino's main-market USDC reserve on surfpool.
 *
 * Flow mirrors `depositKamino` but goes the other direction:
 *   1. Load KaminoMarket via @solana/kit RPC.
 *   2. Resolve the USDC reserve.
 *   3. KaminoAction.buildWithdrawTxns assembles refresh-reserve +
 *      refresh-obligation + redeem-collateral + withdraw-obligation-collateral
 *      ix's in the right order.
 *   4. Shim kit Instructions → web3.js TransactionInstructions.
 *   5. Submit through the existing surfpool Connection with the same fat
 *      blockhash window that the deposit path uses.
 *
 * No USDC seeding here — the agent already has a Kamino position to draw
 * down. We DO add an idempotent ATA-create for the destination USDC ATA in
 * case a fork reset wiped it between deposit and withdraw.
 *
 * Hard-fails if the SDK can't find an obligation (no prior deposit). The
 * daemon's per-action try/catch surfaces that as `phase=execute_error`,
 * which is the right signal — falling through to a placeholder would
 * imply a real withdraw landed when in fact nothing was withdrawn.
 */
export async function withdrawKamino(
  args: WithdrawKaminoArgs,
): Promise<KaminoWithdrawResult> {
  const { surfpool, vault, amountUsdcUi } = args;
  // `amountUsdcUi` is the legacy field name; the value is now interpreted as
  // a UI amount in the reserve's liquidity-mint decimals.
  const amountUi = amountUsdcUi;
  if (amountUi <= 0) {
    throw new Error(
      `withdrawKamino: amountUi must be > 0 (got ${amountUi})`,
    );
  }
  const rpcUrl = args.rpcUrl ?? surfpool.rpcEndpoint;
  const marketAddress = args.marketAddress ?? KAMINO_MAIN_MARKET;

  const kitRpc = createSolanaRpc(rpcUrl);
  const kitOwner = await createKeyPairSignerFromBytes(vault.secretKey);

  const market = await KaminoMarket.load(
    kitRpc,
    marketAddress as Address,
    MAINNET_SLOT_DURATION_MS,
    KLEND_MAINNET_PROGRAM_ID as Address,
    true,
  );
  if (!market) {
    throw new Error(
      `KaminoMarket.load returned null for ${marketAddress} — surfpool fork may not have the market state`,
    );
  }

  let reserve;
  if (args.reserveAddress) {
    reserve = market.reserves.get(args.reserveAddress as Address);
    if (!reserve) {
      throw new Error(
        `reserve ${args.reserveAddress} not in market ${marketAddress}`,
      );
    }
  } else {
    reserve = market.getReserveByMint(MAINNET_USDC_MINT as Address);
    if (!reserve) {
      throw new Error(
        `no USDC reserve found in market ${marketAddress} (mint ${MAINNET_USDC_MINT})`,
      );
    }
  }
  const reserveAddress = reserve.address as string;
  const liquidityMint = String(reserve.getLiquidityMint());
  const reserveDecimals = reserve.getMintDecimals();
  const amountBaseUnits = Math.round(amountUi * 10 ** reserveDecimals);

  // KaminoAction.buildWithdrawTxns(market, amount, mint, owner, obligation,
  //   useV2Ixs, scopeRefreshConfig, extraComputeBudget?, includeAtaIxs?, ...)
  // We pass `includeAtaIxs=true` so the SDK emits the create-destination-ATA
  // setup ix itself; we still belt-and-braces an idempotent ATA create below.
  const action = await KaminoAction.buildWithdrawTxns(
    market,
    new BN(amountBaseUnits),
    liquidityMint as Address,
    kitOwner,
    new VanillaObligation(KLEND_MAINNET_PROGRAM_ID as Address),
    true, // useV2Ixs
    undefined, // scopeRefreshConfig — let SDK decide
    0, // extraComputeBudget — SDK ships its own compute-budget ix
    true, // includeAtaIxs — create destination ATA on the fly if missing
  );

  const allKitIxs: Instruction[] = [
    ...action.computeBudgetIxs,
    ...action.setupIxs,
    ...action.lendingIxs,
    ...action.cleanupIxs,
  ];
  const web3Ixs = allKitIxs.map(kitIxToWeb3Ix);

  // Idempotent ATA create — defensive belt + braces, no-op when present.
  // Uses the reserve's liquidity mint (multi-asset).
  const liquidityMintPk = new PublicKey(liquidityMint);
  const liquidityAta = getAssociatedTokenAddressSync(
    liquidityMintPk,
    vault.publicKey,
  );
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    vault.publicKey,
    liquidityAta,
    vault.publicKey,
    liquidityMintPk,
  );

  const tx = new Transaction();
  tx.add(ataIx, ...web3Ixs);
  tx.feePayer = vault.publicKey;
  const { blockhash, lastValidBlockHeight } =
    await surfpool.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight + 300;

  console.log(
    `[kamino] withdraw ${amountUi} (mint ${liquidityMint.slice(0, 8)}…) ← market ${marketAddress.slice(0, 8)}…/reserve ${reserveAddress.slice(0, 8)}…  ixs=${web3Ixs.length + 1}`,
  );

  const txSig = await sendAndConfirmTransaction(surfpool, tx, [vault], {
    commitment: "confirmed",
    skipPreflight: true,
  });

  return {
    protocol: "kamino",
    action: "lend_withdraw",
    txSig,
    reserveAddress,
    reserveLiquidityMint: liquidityMint,
    amountBaseUnits,
    ixCount: web3Ixs.length + 1,
  };
}
