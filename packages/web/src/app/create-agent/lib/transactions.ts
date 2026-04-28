/**
 * transactions.ts , wizard-side transaction builders for the
 * /create-agent flow.
 *
 * SIGNER MODEL FINDING (Phase J init_vault.rs):
 *   `init_vault.authority` is `Signer<'info>` AND the vault PDA is
 *   derived from `[BUNDIE_VAULT_SEED, authority.key().as_ref()]`. The
 *   authority is therefore the AGENT keypair (whose pubkey is the seed
 *   for the PDA), not the user's wallet. The wizard CANNOT build +
 *   sign init_vault client-side because it doesn't hold the agent's
 *   secret key.
 *
 *   Resolution (taken in this wizard): the backend owns the agent
 *   keypair (Zerion-managed) and is responsible for submitting
 *   init_vault server-side as part of `POST /api/agents`. By the
 *   time `confirmInit` is called, the vault PDA is already on-chain.
 *
 *   That leaves only `deposit_to_vault` for the wallet to sign , the
 *   user transfers $50 bUSD from their ATA into the vault's
 *   treasury_ata. The vault PDA + treasury_ata addresses come back in
 *   `nextSteps` from `POST /api/agents`.
 *
 *   If the backend can't co-sign (e.g. no SOL on the agent keypair to
 *   pay rent), it should ask the wizard to fund the agent first via a
 *   plain SystemProgram transfer , that path is not implemented yet.
 *
 * Encoding strategy mirrors `packages/web/src/lib/tx-builders.ts`:
 *   hand-encode the Anchor discriminator + u64 LE arg, no Anchor
 *   method-builder in the client bundle.
 */
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PROGRAM_IDS } from "@/lib/constants";
import type { LaunchStage } from "./wizard-state";
import type { CreateAgentResponse } from "./api";

// ── Anchor discriminator ────────────────────────────────────────────────────
// From packages/common/src/idl/prediction_market.json , depositToVault.
const DISC_DEPOSIT_TO_VAULT = Uint8Array.from([
  18, 62, 110, 8, 26, 106, 248, 151,
]);

// ── u64 LE helper ───────────────────────────────────────────────────────────
function encodeU64LE(value: number | bigint): Uint8Array {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n || v >= 1n << 64n) {
    throw new Error(`encodeU64LE: value ${v} out of u64 range`);
  }
  const buf = new Uint8Array(8);
  let n = v;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

// ── deposit_to_vault ────────────────────────────────────────────────────────

export interface BuildDepositArgs {
  /** User's wallet (becomes the depositor + signer). */
  ownerWallet: PublicKey;
  /** Vault PDA returned by `POST /api/agents`. */
  vaultPda: PublicKey;
  /** Treasury mint (bUSD) , used to derive the depositor + treasury ATAs. */
  treasuryMint: PublicKey;
  /** Amount in base units (50 bUSD = 50_000_000 with 6dp). */
  amountBase: number | bigint;
}

export function buildDepositToVaultIx({
  ownerWallet,
  vaultPda,
  treasuryMint,
  amountBase,
}: BuildDepositArgs): TransactionInstruction {
  const programId = PROGRAM_IDS.predictionMarket;

  const depositorAta = getAssociatedTokenAddressSync(
    treasuryMint,
    ownerWallet,
    false,
  );
  // The treasury ATA is owned by the vault PDA itself (off-curve).
  const treasuryAta = getAssociatedTokenAddressSync(
    treasuryMint,
    vaultPda,
    true,
  );

  const data = new Uint8Array(8 + 8);
  data.set(DISC_DEPOSIT_TO_VAULT, 0);
  data.set(encodeU64LE(amountBase), 8);

  const keys = [
    { pubkey: ownerWallet, isSigner: true, isWritable: true },
    { pubkey: depositorAta, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: false },
    { pubkey: treasuryAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.from(data),
  });
}

/**
 * Pick a priority fee (microLamports per CU) from the network's recent
 * prioritization-fee samples for the *exact* writable accounts our tx
 * touches. Falls back to a sane floor if the RPC doesn't honour the
 * lockedWritableAccounts filter or returns nothing.
 *
 * 75th percentile is the sweet spot: above the median noise, below the
 * desperation tail. Clamped to [50k, 1M] so we never under-bid during
 * congestion or over-pay during a single stuck slot.
 */
async function pickPriorityFeeMicroLamports(
  connection: Connection,
  writableAccounts: PublicKey[],
): Promise<number> {
  const FLOOR = 50_000;
  const CEIL = 1_000_000;
  try {
    const samples = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: writableAccounts,
    });
    if (!samples.length) return FLOOR;
    const fees = samples
      .map((s) => s.prioritizationFee)
      .filter((f) => f > 0)
      .sort((a, b) => a - b);
    if (!fees.length) return FLOOR;
    const p75 = fees[Math.floor(fees.length * 0.75)] ?? FLOOR;
    return Math.min(CEIL, Math.max(FLOOR, p75));
  } catch {
    return FLOOR;
  }
}

/**
 * Assemble the instruction list for deposit_to_vault. Returned without a
 * blockhash so the caller can attach the freshest possible one right
 * before asking the wallet to sign. (Stale blockhashes are the #1 reason
 * devnet wallet flows drop the tx , every second the user spends in the
 * wallet UI eats into the ~60s validity window.)
 */
export async function buildDepositToVaultIxs(
  connection: Connection,
  args: BuildDepositArgs,
): Promise<TransactionInstruction[]> {
  const ixs: TransactionInstruction[] = [];

  const depositorAta = getAssociatedTokenAddressSync(
    args.treasuryMint,
    args.ownerWallet,
    false,
  );
  const treasuryAta = getAssociatedTokenAddressSync(
    args.treasuryMint,
    args.vaultPda,
    true,
  );

  // Dynamic priority fee from recent samples on the writable accounts
  // this tx will lock. Cheap when the network is quiet, competitive
  // when it isn't.
  const microLamports = await pickPriorityFeeMicroLamports(connection, [
    args.ownerWallet,
    depositorAta,
    treasuryAta,
  ]);
  ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  // Tight CU limit , deposit_to_vault + optional ATA create stays well
  // under 80k. Tighter limits make the priority fee go further AND give
  // the scheduler a hint that we're cheap to include.
  ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }));

  // Defensive: if the user's bUSD ATA doesn't exist yet, create it
  // first. The faucet drip should have created it, but the user may
  // have skipped it. The init_vault path on the backend is responsible
  // for creating the *treasury* ATA , we never create that here.
  // No string commitment , rpcfast strict-mode rejects it.
  const ataInfo = await connection.getAccountInfo(depositorAta);
  if (!ataInfo) {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        args.ownerWallet, // payer
        depositorAta,
        args.ownerWallet, // owner
        args.treasuryMint,
      ),
    );
  }

  ixs.push(buildDepositToVaultIx(args));
  return ixs;
}

// ── Orchestrator: drive the user through deposit ────────────────────────────

/**
 * Subset of the wallet-adapter's interface we actually need.
 *
 * `signTransaction` is preferred , it lets us control broadcast +
 * rebroadcast on our side. Phantom + Solflare both expose it. We fall
 * back to `sendTransaction` for wallets that don't (rare on Solana).
 */
interface MinimalWallet {
  publicKey: PublicKey;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  sendTransaction: (
    tx: Transaction,
    connection: Connection,
  ) => Promise<string>;
}

export interface LaunchAgentArgs {
  connection: Connection;
  wallet: MinimalWallet;
  nextSteps: CreateAgentResponse["nextSteps"];
  onStage: (stage: LaunchStage) => void;
  // NOTE: `onInitTx` was removed , the backend now signs init_vault
  // server-side as part of `POST /api/agents` (see signer-model note at
  // top of this file). The wizard never sees that signature.
  onDepositTx?: (sig: string) => void;
}

/**
 * Orchestrate the on-chain steps after `createAgent` returns.
 *
 * Responsibilities:
 *   1. Surface that the backend has already submitted init_vault (we
 *      don't have a direct sig from the wizard, so the "Sign init"
 *      stage is mostly cosmetic , the backend signed before responding).
 *   2. Build + sign + send `deposit_to_vault` from the user's wallet
 *      via the wallet adapter's `sendTransaction` (matches the
 *      convention used by BuySharesPanel + market-buy-panel).
 *
 * Returns the deposit signature for the caller to surface.
 */
export async function launchAgent({
  connection,
  wallet,
  nextSteps,
  onStage,
  onDepositTx,
}: LaunchAgentArgs): Promise<{ depositSig: string }> {
  const vaultPda = new PublicKey(nextSteps.vaultPda);
  const treasuryMint = new PublicKey(nextSteps.treasuryMint);

  // init_vault is server-signed (see signer-model note at top of file).
  // Cosmetic stage marker so the timeline UI walks correctly.
  onStage("signing-init");
  onStage("building-tx");

  const ixs = await buildDepositToVaultIxs(connection, {
    ownerWallet: wallet.publicKey,
    vaultPda,
    treasuryMint,
    amountBase: nextSteps.seedAmountBase,
  });

  // Whole flow can need a retry-with-fresh-blockhash if the wallet
  // popup is left open long enough that the *first* blockhash expires
  // before the user even clicks Approve, OR if devnet leaders silently
  // drop the tx for a full validity window. Three attempts gives a
  // realistic margin without making the user wait forever.
  const MAX_ATTEMPTS = 3;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Fetch the freshest possible blockhash *right before* asking the
    // wallet to sign , every second the user spends reading the popup
    // eats the ~60s validity window. Doing this in the loop also
    // means the second attempt gets a fully fresh window if the first
    // expired.
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const tx = new Transaction();
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = blockhash;
    for (const ix of ixs) tx.add(ix);

    onStage("signing-deposit");

    // Prefer signTransaction so we control broadcast + rebroadcast.
    // Wallet-adapter's sendTransaction broadcasts exactly once and
    // gives up , that's why first attempts so often "vanish" on
    // congested devnet. Manual rebroadcast every 2s for the entire
    // validity window virtually eliminates the dropped-tx case.
    if (wallet.signTransaction) {
      let signed: Transaction;
      try {
        signed = await wallet.signTransaction(tx);
      } catch (err) {
        // User rejected / wallet error , surface verbatim, no retry.
        throw err;
      }
      const rawTx = signed.serialize();

      let depositSig: string;
      try {
        depositSig = await connection.sendRawTransaction(rawTx, {
          skipPreflight: true,
          maxRetries: 0,
        });
      } catch (err) {
        // Initial broadcast failure (RPC down, bad blockhash before
        // submit, etc.) , try once more with a fresh blockhash if
        // we have an attempt left.
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_ATTEMPTS) {
          lastErr = err instanceof Error ? err : new Error(msg);
          onStage("signing-init");
          continue;
        }
        throw err;
      }
      onDepositTx?.(depositSig);
      // Wallet popup closed, tx broadcast , the long pause that
      // follows is the chain landing it. Surface a distinct stage so
      // the UI can show a progress bar instead of looking frozen on
      // "signing-deposit".
      onStage("landing");

      // Aggressive rebroadcast in the background. Re-sending the same
      // signed tx is idempotent (validators dedupe by signature);
      // landing requires a leader to *include* it, which can take
      // several attempts on busy devnet. Loop ends as soon as confirm
      // resolves.
      let stopped = false;
      const rebroadcast = (async () => {
        while (!stopped) {
          await new Promise((r) => setTimeout(r, 1000));
          if (stopped) break;
          connection.sendRawTransaction(rawTx, {
            skipPreflight: true,
            maxRetries: 0,
          }).catch(() => {
            // Validators reject duplicates with "already processed"
            // once it lands , that's the success signal, ignore.
          });
        }
      })();

      try {
        const result = await connection.confirmTransaction(
          { signature: depositSig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        if (result.value.err) {
          throw new Error(
            `Deposit failed on-chain: ${JSON.stringify(result.value.err)}`,
          );
        }
        return { depositSig };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const expired =
          msg.includes("block height exceeded") ||
          msg.includes("TransactionExpired") ||
          msg.includes("was not confirmed");
        if (expired && attempt < MAX_ATTEMPTS) {
          lastErr = err instanceof Error ? err : new Error(msg);
          onStage("signing-init");
          continue;
        }
        throw err;
      } finally {
        stopped = true;
        await rebroadcast.catch(() => {});
      }
    } else {
      // Fallback: wallet doesn't expose signTransaction. Use the
      // legacy single-shot send path , same retry-on-expiry as
      // before, no aggressive rebroadcast.
      let depositSig: string;
      try {
        depositSig = await wallet.sendTransaction(tx, connection);
      } catch (err) {
        throw err;
      }
      onDepositTx?.(depositSig);
      onStage("landing");
      try {
        const result = await connection.confirmTransaction(
          { signature: depositSig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        if (result.value.err) {
          throw new Error(
            `Deposit failed on-chain: ${JSON.stringify(result.value.err)}`,
          );
        }
        return { depositSig };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const expired =
          msg.includes("block height exceeded") ||
          msg.includes("TransactionExpired") ||
          msg.includes("was not confirmed");
        if (expired && attempt < MAX_ATTEMPTS) {
          lastErr = err instanceof Error ? err : new Error(msg);
          onStage("signing-init");
          continue;
        }
        throw err;
      }
    }
  }
  throw lastErr ?? new Error("launchAgent: exhausted retries");
}
