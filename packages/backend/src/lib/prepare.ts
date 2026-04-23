/**
 * prepare.ts — backend mirror of the @bundie/sol-cli `Prepared` shape.
 *
 * The contract here MUST match the CLI's `PreparedTx` (see
 * /mnt/storage/bundie-fi/cli/solana/src/prepare.ts) so a webapp / agent can
 * consume txs from either surface using the same client logic.
 *
 * Backend never holds keys. We build the tx, set fee payer + recent blockhash,
 * partial-sign with any ephemeral signers (e.g. a fresh mint keypair), and
 * return the base64 of `tx.serialize({ requireAllSignatures: false })`. The
 * caller adds their wallet signature and sends the raw bytes.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

/** Role hints for human + agent inspection of the tx. */
export interface SignerSpec {
  pubkey: string;
  role: string;
  /** True if the secret for this signer is not the caller's main wallet
   *  (e.g. an ephemeral mint keypair that was partial-signed into the tx). */
  ephemeral?: boolean;
}

export interface AccountSpec {
  pubkey: string;
  role: string;
  writable: boolean;
  signer: boolean;
}

/** The JSON object every prepare-mode endpoint returns. */
export interface PreparedTx {
  description: string;
  /** Base64 of tx.serialize({ requireAllSignatures: false }). Any
   *  ephemeral signers (e.g. fresh mint keypair) are already partial-signed
   *  in — the caller only needs to add the payer signature before sending. */
  tx: string;
  signers: SignerSpec[];
  accounts: AccountSpec[];
  /** Command-specific metadata (derived PDAs, generated ids, etc.). */
  metadata?: Record<string, string | number>;
  blockhash: string;
  lastValidBlockHeight: number;
  /** ISO timestamp when the blockhash was fetched — callers can detect stale prepares. */
  preparedAt: string;
}

/**
 * Finalize a built Transaction into a PreparedTx.
 *
 * - Fetches a recent blockhash and sets feePayer.
 * - Optionally partial-signs with ephemeral keypairs (e.g. a fresh mint
 *   that must sign for create-strategy). Those signatures are embedded;
 *   the caller only provides the main payer signature.
 */
export async function finalizePrepared(
  conn: Connection,
  tx: Transaction,
  args: {
    description: string;
    feePayer: PublicKey;
    partialSigners?: Keypair[];
    signers: SignerSpec[];
    accounts: AccountSpec[];
    metadata?: Record<string, string | number>;
  }
): Promise<PreparedTx> {
  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("confirmed");
  tx.feePayer = args.feePayer;
  tx.recentBlockhash = blockhash;

  if (args.partialSigners && args.partialSigners.length > 0) {
    tx.partialSign(...args.partialSigners);
  }

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return {
    description: args.description,
    tx: serialized.toString("base64"),
    signers: args.signers,
    accounts: args.accounts,
    metadata: args.metadata,
    blockhash,
    lastValidBlockHeight,
    preparedAt: new Date().toISOString(),
  };
}
