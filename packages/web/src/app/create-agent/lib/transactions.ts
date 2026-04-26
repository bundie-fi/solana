/**
 * transactions.ts — wizard-side transaction builders for the
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
 *   That leaves only `deposit_to_vault` for the wallet to sign — the
 *   user transfers $50 bUSD from their ATA into the vault's
 *   treasury_ata. The vault PDA + treasury_ata addresses come back in
 *   `nextSteps` from `POST /api/agents`.
 *
 *   If the backend can't co-sign (e.g. no SOL on the agent keypair to
 *   pay rent), it should ask the wizard to fund the agent first via a
 *   plain SystemProgram transfer — that path is not implemented yet.
 *
 * Encoding strategy mirrors `packages/web/src/lib/tx-builders.ts`:
 *   hand-encode the Anchor discriminator + u64 LE arg, no Anchor
 *   method-builder in the client bundle.
 */
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PROGRAM_IDS } from "@/lib/constants";
import type { LaunchStage } from "./wizard-state";
import type { CreateAgentResponse } from "./api";

// ── Anchor discriminator ────────────────────────────────────────────────────
// From packages/common/src/idl/prediction_market.json — depositToVault.
const DISC_DEPOSIT_TO_VAULT = Uint8Array.from([
  18, 62, 110, 8, 26, 106, 248, 151,
]);

// ── u64 LE helper ───────────────────────────────────────────────────────────
function encodeU64LE(value: number | bigint): Uint8Array {
  const v = typeof value === "bigint" ? value : BigInt(value);
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
  /** Treasury mint (bUSD) — used to derive the depositor + treasury ATAs. */
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

export async function buildDepositToVaultTx(
  connection: Connection,
  args: BuildDepositArgs,
): Promise<Transaction> {
  const tx = new Transaction();

  // Defensive: if the user's bUSD ATA doesn't exist yet, create it
  // first. The faucet drip should have created it, but the user may
  // have skipped it. The init_vault path on the backend is responsible
  // for creating the *treasury* ATA — we never create that here.
  const depositorAta = getAssociatedTokenAddressSync(
    args.treasuryMint,
    args.ownerWallet,
    false,
  );
  const ataInfo = await connection.getAccountInfo(depositorAta, "confirmed");
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        args.ownerWallet, // payer
        depositorAta,
        args.ownerWallet, // owner
        args.treasuryMint,
      ),
    );
  }

  tx.add(buildDepositToVaultIx(args));
  tx.feePayer = args.ownerWallet;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  return tx;
}

// ── Orchestrator: drive the user through deposit ────────────────────────────

/** Subset of the wallet-adapter's interface we actually need. */
interface MinimalWallet {
  publicKey: PublicKey;
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
  onInitTx?: (sig: string) => void;
  onDepositTx?: (sig: string) => void;
}

/**
 * Orchestrate the on-chain steps after `createAgent` returns.
 *
 * Responsibilities:
 *   1. Surface that the backend has already submitted init_vault (we
 *      don't have a direct sig from the wizard, so the "Sign init"
 *      stage is mostly cosmetic — the backend signed before responding).
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
  onStage("building-tx");

  const vaultPda = new PublicKey(nextSteps.vaultPda);
  const treasuryMint = new PublicKey(nextSteps.treasuryMint);

  // init_vault is server-signed (see signer-model note at top of file).
  // We surface this stage so the user sees the timeline, but we don't
  // collect a signature here.
  onStage("signing-init");

  const tx = await buildDepositToVaultTx(connection, {
    ownerWallet: wallet.publicKey,
    vaultPda,
    treasuryMint,
    amountBase: nextSteps.seedAmountBase,
  });

  onStage("signing-deposit");
  const depositSig = await wallet.sendTransaction(tx, connection);
  onDepositTx?.(depositSig);

  await connection.confirmTransaction(depositSig, "confirmed");
  return { depositSig };
}
