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
  type Commitment,
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

  // Priority fee , gives our tx better leader inclusion priority on a
  // congested devnet. 50k microLamports * 200k CU ≈ 10k lamports
  // (≈ 0.00001 SOL), negligible cost, big difference in landing
  // reliability on busy slots.
  ixs.push(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
  );
  ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));

  // Defensive: if the user's bUSD ATA doesn't exist yet, create it
  // first. The faucet drip should have created it, but the user may
  // have skipped it. The init_vault path on the backend is responsible
  // for creating the *treasury* ATA , we never create that here.
  const depositorAta = getAssociatedTokenAddressSync(
    args.treasuryMint,
    args.ownerWallet,
    false,
  );
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
    options?: { skipPreflight?: boolean; preflightCommitment?: Commitment },
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

    // Devnet wallets routinely have 0 SOL — Phantom doesn't gate signing
    // on balance, so the deposit gets signed but dies at the validator
    // with the unhelpful "AccountNotFound" preflight error (Solana's way
    // of saying the fee payer has no on-chain account = 0 lamports).
    // Catch it here with a clear, actionable message instead.
    if (attempt === 1) {
      const lamports = await connection.getBalance(wallet.publicKey);
      if (lamports < 5_000) {
        throw new Error(
          "You need devnet SOL to pay transaction fees. " +
            "Get some at https://faucet.solana.com (paste your wallet, " +
            "select Devnet, request 1 SOL), then click Deposit again.",
        );
      }
    }

    // DIAGNOSTIC: simulate ourselves first so any program revert /
    // account-state error surfaces verbatim. Phantom's WalletSendTransactionError
    // wrapper swallows preflight detail ("Unexpected error"), making it
    // impossible to distinguish a real validation bug from a routing
    // failure. Running connection.simulateTransaction here gives us the
    // raw RPC error message, including instruction logs.
    if (wallet.signTransaction) {
      try {
        const presigned = await wallet.signTransaction(tx);
        const sim = await connection.simulateTransaction(presigned);
        if (sim.value.err) {
          // AccountNotFound at preflight, with no instruction logs, almost
          // always means the fee payer has 0 lamports. Solana's error name
          // is misleading — surface the real cause.
          const errStr = JSON.stringify(sim.value.err);
          if (errStr.includes("AccountNotFound")) {
            throw new Error(
              "You need devnet SOL to pay transaction fees. " +
                "Get some at https://faucet.solana.com (paste your wallet, " +
                "select Devnet, request 1 SOL), then click Deposit again.",
            );
          }
          // Otherwise: surface the err code + last few logs so the user can
          // see exactly which instruction reverted and why.
          const logs = (sim.value.logs ?? []).slice(-8).join("\n  ");
          throw new Error(
            `Preflight failed: ${errStr}\n  ${logs}`,
          );
        }
        // Simulation passed; broadcast the same already-signed tx via
        // sendRawTransaction so we don't ask the wallet to sign twice.
        // skipPreflight: true is safe here because we just simulated.
        // maxRetries unset → rpcfast retries server-side every block.
        var depositSig: string = await connection.sendRawTransaction(
          presigned.serialize(),
          { skipPreflight: true },
        );
      } catch (err) {
        throw err;
      }
    } else {
      try {
        var depositSig: string = await wallet.sendTransaction(
          tx,
          connection,
          { skipPreflight: false, preflightCommitment: "processed" },
        );
      } catch (err) {
        throw err;
      }
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
  throw lastErr ?? new Error("launchAgent: exhausted retries");
}
