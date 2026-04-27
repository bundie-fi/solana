/**
 * kamino-execute.ts — real Kamino lend deposit on the surfpool mainnet fork.
 *
 * Wraps `@kamino-finance/klend-sdk` (which is built on `@solana/kit`) and
 * exposes a thin shim that submits the resulting deposit tx via the existing
 * web3.js `Connection` the chaos-sim already passes around. Same pattern as
 * `beethoven-execute.ts`: build a tx, send with `skipPreflight: true` and a
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

// ─── Surfpool / mainnet constants ────────────────────────────────────────

/** Kamino mainnet program id (also valid on the surfpool mainnet fork). */
export const KLEND_MAINNET_PROGRAM_ID =
  "KLend2g3cP87ber8p32LuJLuLPzCvXN4KcKr2S8MQek";

/** Kamino "Main Market" on mainnet (the deepest USDC reserve sits here). */
export const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs9JGqRzvShV4P";

/** Real mainnet USDC mint — surfpool fork inherits the state. */
export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Avg mainnet slot duration (used by klend for staleness math). */
const MAINNET_SLOT_DURATION_MS = 450;

// ─── Result type ────────────────────────────────────────────────────────

export interface KaminoDepositResult {
  protocol: "kamino";
  action: "lend_deposit";
  txSig: string;
  reserveAddress: string;
  reserveLiquidityMint: string;
  /** USDC base units (6dp) actually deposited. */
  amountBaseUnits: number;
  /** Number of ix's bundled into the deposit tx (setup + lending + cleanup). */
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

// ─── USDC funding (surfpool-only RPC) ────────────────────────────────────

/**
 * Ensure the agent has at least `requiredBaseUnits` USDC on the surfpool
 * fork. Uses surfpool's `surfnet_setTokenAccount` cheat-code RPC, which
 * lets us mint arbitrary token-account state on a forked chain (surfpool
 * docs: https://docs.surfpool.run/cheatcodes#surfnet_settokenaccount).
 *
 * The agent's USDC ATA is created on-the-fly inside the deposit tx via
 * `createAssociatedTokenAccountIdempotentInstruction`, so we only need
 * to seed the balance here.
 *
 * No-op when the existing balance already covers the deposit. Logs and
 * swallows errors — surfpool deployments without the cheat-code RPC
 * patched in just fall through to the deposit attempt, which will fail
 * cleanly with InsufficientFunds if the USDC isn't there.
 */
async function ensureSurfpoolUsdc(
  surfpool: Connection,
  owner: PublicKey,
  requiredBaseUnits: number,
  rpcUrl: string,
): Promise<{ funded: boolean; balanceBaseUnits: number; method: string }> {
  const usdcMint = new PublicKey(MAINNET_USDC_MINT);
  const ata = getAssociatedTokenAddressSync(usdcMint, owner);

  // Check current balance. Missing ATA → 0 balance, treat as needs-funding.
  let currentBalance = 0;
  try {
    const resp = await surfpool.getTokenAccountBalance(ata, "confirmed");
    currentBalance = Number(resp.value.amount);
  } catch {
    currentBalance = 0;
  }
  if (currentBalance >= requiredBaseUnits) {
    return { funded: true, balanceBaseUnits: currentBalance, method: "noop" };
  }

  // Top up to 100 USDC (well over any single deposit the brain emits) so we
  // don't ping the cheat-code RPC every tick.
  const targetBaseUnits = Math.max(requiredBaseUnits, 100_000_000); // 100 USDC
  const params = {
    owner: owner.toBase58(),
    mint: MAINNET_USDC_MINT,
    amount: String(targetBaseUnits),
  };

  try {
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "surfnet_setTokenAccount",
        params: [params],
      }),
    });
    const body = (await resp.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (body.error) {
      console.warn(
        `[kamino] surfnet_setTokenAccount failed: ${body.error.message ?? "unknown"} — proceeding anyway`,
      );
      return { funded: false, balanceBaseUnits: currentBalance, method: "rpc_error" };
    }
    return {
      funded: true,
      balanceBaseUnits: targetBaseUnits,
      method: "surfnet_setTokenAccount",
    };
  } catch (e) {
    console.warn(
      `[kamino] surfnet_setTokenAccount unreachable: ${(e as Error).message} — proceeding anyway`,
    );
    return { funded: false, balanceBaseUnits: currentBalance, method: "rpc_unreachable" };
  }
}

// ─── Main entry ────────────────────────────────────────────────────────

export interface DepositKaminoArgs {
  /** web3.js Connection pointed at surfpool. */
  surfpool: Connection;
  /** Agent keypair. */
  vault: Keypair;
  /** USDC amount (UI units, e.g. 0.5 = 0.5 USDC). */
  amountUsdcUi: number;
  /**
   * RPC URL string — separate arg because @solana/kit needs the URL
   * directly to construct its own RPC client. Defaults to the surfpool
   * Connection's `rpcEndpoint`.
   */
  rpcUrl?: string;
  /** Optional reserve override; defaults to USDC reserve in the main market. */
  reserveAddress?: string;
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
 *      Marinade uses (see beethoven-execute.ts).
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
  if (amountUsdcUi <= 0) {
    throw new Error(`depositKamino: amountUsdcUi must be > 0 (got ${amountUsdcUi})`);
  }
  const rpcUrl = args.rpcUrl ?? surfpool.rpcEndpoint;
  const amountBaseUnits = Math.round(amountUsdcUi * 1_000_000);

  // 1. Make sure USDC is sittable in the agent's ATA. Idempotent.
  const usdcResult = await ensureSurfpoolUsdc(
    surfpool,
    vault.publicKey,
    amountBaseUnits,
    rpcUrl,
  );

  // 2. Build a kit Rpc + signer for the SDK to chew on. We're not actually
  //    using the kit signer to sign — we shim ix's back to web3.js and sign
  //    with the web3.js Keypair — but KaminoAction needs *something* that
  //    quacks like a TransactionSigner so it can attach the owner address.
  const kitRpc = createSolanaRpc(rpcUrl);
  const kitPayer = await createKeyPairSignerFromBytes(vault.secretKey);

  // 3. Load the market with the mainnet program id (NOT the SDK's default
  //    devnet PROGRAM_ID).
  const market = await KaminoMarket.load(
    kitRpc,
    KAMINO_MAIN_MARKET as Address,
    MAINNET_SLOT_DURATION_MS,
    KLEND_MAINNET_PROGRAM_ID as Address,
    true,
  );
  if (!market) {
    throw new Error(
      `KaminoMarket.load returned null for ${KAMINO_MAIN_MARKET} — surfpool fork may not have the market state`,
    );
  }

  // 4. Resolve reserve. Default = USDC reserve via mint lookup.
  let reserve;
  if (args.reserveAddress) {
    reserve = market.reserves.get(args.reserveAddress as Address);
    if (!reserve) {
      throw new Error(
        `reserve ${args.reserveAddress} not in market ${KAMINO_MAIN_MARKET}`,
      );
    }
  } else {
    reserve = market.getReserveByMint(MAINNET_USDC_MINT as Address);
    if (!reserve) {
      throw new Error(
        `no USDC reserve found in market ${KAMINO_MAIN_MARKET} (mint ${MAINNET_USDC_MINT})`,
      );
    }
  }
  const reserveAddress = reserve.address as string;

  // 5. Have the SDK assemble the full deposit ix list (setup includes
  //    obligation init / refresh-reserve / refresh-obligation, etc).
  const action = await KaminoAction.buildDepositTxns(
    market,
    new BN(amountBaseUnits),
    MAINNET_USDC_MINT as Address,
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

  // 7. Belt-and-braces: prepend an idempotent ATA-create for the USDC ATA.
  //    The SDK *should* include this in setupIxs already, but we add it
  //    defensively — idempotent ix is a no-op when the ATA already exists.
  const usdcAta = getAssociatedTokenAddressSync(
    new PublicKey(MAINNET_USDC_MINT),
    vault.publicKey,
  );
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    vault.publicKey,
    usdcAta,
    vault.publicKey,
    new PublicKey(MAINNET_USDC_MINT),
  );

  const tx = new Transaction();
  tx.add(ataIx, ...web3Ixs);
  tx.feePayer = vault.publicKey;
  // Same surfpool-specific blockhash treatment as Marinade — see
  // beethoven-execute.ts for the rationale.
  const { blockhash, lastValidBlockHeight } =
    await surfpool.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight + 300;

  console.log(
    `[kamino] deposit ${amountUsdcUi} USDC → reserve ${reserveAddress.slice(0, 8)}…  ixs=${web3Ixs.length + 1}  usdcFunding=${usdcResult.method}`,
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
    reserveLiquidityMint: MAINNET_USDC_MINT,
    amountBaseUnits,
    ixCount: web3Ixs.length + 1,
  };
}
