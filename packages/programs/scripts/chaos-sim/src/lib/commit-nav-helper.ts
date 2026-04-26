/**
 * commit-nav-helper.ts — submit a `commit_nav` ix to the prediction-market
 * program on devnet, signed by the agent vault keypair.
 *
 * The chaos-sim agents loaded via `run-agent-daemon.ts` keep their secret
 * key in `keys/<agent>-vault.json`, so we use that Keypair directly here.
 * If a future migration moves these wallets into the Zerion vault, swap
 * this for the build-tx + `signWithVault` flow used by the SNS scripts.
 *
 * Wire layout after the 8-byte discriminator (`sha256("global:commit_nav")[..8]`):
 *   new_nav:       u64 LE
 *   new_epoch:     u64 LE
 *   commit_digest: [u8; 32]
 *
 * The on-chain handler enforces `new_epoch == prev_epoch + 1` so we read
 * the current vault state to compute `nextEpoch`. A monotonic violation
 * surfaces as `MarketError::StaleNavEpoch` (code 6019).
 *
 * `commit_digest` is sha256(epoch || nav || sortedTxSigs.join(',')). The
 * program records it verbatim — it is an off-chain audit commitment, not
 * a verifiable proof. See `state::BundieVault.commit_digest` docs.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";

import { PREDICTION_MARKET_PROGRAM_ID, bundieVaultPda } from "../actions/create-nav-market.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function anchorDiscriminator(fnName: string): Buffer {
  return createHash("sha256")
    .update(`global:${fnName}`)
    .digest()
    .subarray(0, 8);
}

function u64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}

/**
 * Read the current `nav_epoch` from a BundieVault account. Returns 0 if
 * the account is missing — callers can use this to detect un-initialised
 * vaults and trigger `init_vault` instead.
 *
 * BundieVault layout (sequential, after the 8-byte Anchor discriminator):
 *   authority:     Pubkey       32 bytes  (offset 8)
 *   nav_lamports:  u64 LE        8 bytes  (offset 40)
 *   nav_epoch:     u64 LE        8 bytes  (offset 48)
 *   nav_slot:      u64 LE        8 bytes  (offset 56)
 *   commit_digest: [u8; 32]     32 bytes  (offset 64)
 *   bump:          u8            1 byte   (offset 96)
 */
async function readVaultEpoch(
  conn: Connection,
  vaultPda: PublicKey,
): Promise<{ exists: boolean; epoch: bigint }> {
  const info = await conn.getAccountInfo(vaultPda, "confirmed");
  if (!info || info.data.length < 56) return { exists: false, epoch: 0n };
  const epoch = info.data.readBigUInt64LE(48);
  return { exists: true, epoch };
}

export interface CommitNavResult {
  txSig: string;
  vaultPda: string;
  epoch: number;
  digestHex: string;
}

/**
 * Submit a `commit_nav` ix signed by `agentKp` to record `navLamports`
 * for the given vault. Returns the tx signature, the new epoch, and the
 * computed commit digest (hex) so callers can persist the audit trail.
 *
 * Throws if the vault does not exist (operator must run `init-vaults`
 * first) or if the on-chain monotonic check fails.
 */
export async function commitNavToDevnet(opts: {
  connection: Connection;
  agentKp: Keypair;
  navLamports: bigint;
  surfpoolTxSigs: string[];
}): Promise<CommitNavResult> {
  const { connection, agentKp, navLamports, surfpoolTxSigs } = opts;

  const vaultPda = bundieVaultPda(agentKp.publicKey);
  const { exists, epoch: prevEpoch } = await readVaultEpoch(connection, vaultPda);
  if (!exists) {
    throw new Error(
      `commit_nav: BundieVault not initialised for ${agentKp.publicKey.toBase58()} ` +
        `(run \`pnpm --filter @bundie/programs init-vaults\` first)`,
    );
  }
  const nextEpoch = prevEpoch + 1n;

  // Stable digest: sorted tx sigs make the result independent of tx
  // submission order on the surfpool side.
  const sortedSigs = [...surfpoolTxSigs].sort();
  const h = createHash("sha256");
  h.update(u64LE(nextEpoch));
  h.update(u64LE(navLamports));
  h.update(Buffer.from(sortedSigs.join(","), "utf8"));
  const digest = h.digest();

  const data = Buffer.concat([
    anchorDiscriminator("commit_nav"),
    u64LE(navLamports),
    u64LE(nextEpoch),
    digest,
  ]);

  // Authority is also the fee-payer, so it MUST be writable (Solana
  // runtime requires the fee-payer slot to be writable for lamport
  // deduction). Anchor's `Signer<'info>` does not enforce writability
  // at the program level, so this is purely a transaction-message
  // requirement.
  const keys = [
    { pubkey: agentKp.publicKey, isSigner: true, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
  ];

  const ix = new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = agentKp.publicKey;

  const txSig = await sendAndConfirmTransaction(connection, tx, [agentKp], {
    commitment: "confirmed",
  });

  return {
    txSig,
    vaultPda: vaultPda.toBase58(),
    epoch: Number(nextEpoch),
    digestHex: digest.toString("hex"),
  };
}

// ─── NAV computation (initial implementation) ─────────────────────────────

/**
 * Stub mainnet-style prices used to convert surfpool token balances into
 * a single bUSD-denominated NAV figure. TODO: replace with live Pyth /
 * SwitchboardOn-Demand prices once the pull-oracle wiring lands (Phase G+).
 */
const STUB_PRICE_USD: Record<string, number> = {
  bUSD: 1,
  USDC: 1, // pre-rebrand alias
  SOL: 150,
  mSOL: 158,
  jitoSOL: 157,
};

/** Lamports-per-bUSD scaling: bUSD has 6 decimals so 1 bUSD = 1e6. */
const BUSD_DECIMALS = 6;

/**
 * Compute the agent's NAV (in bUSD lamports) by summing token balances on
 * the surfpool execution chain priced at `STUB_PRICE_USD`. Falls back to
 * SOL-only valuation if no SPL accounts are observed yet.
 *
 * This is an MVP stand-in. Phase G+ will replace it with on-chain Pyth
 * lookups so the NAV digest is independently auditable.
 */
export async function computeNavFromSurfpoolBalances(
  surfpool: Connection,
  authority: PublicKey,
): Promise<bigint> {
  // SOL balance is always observable.
  let totalUsd = 0;
  try {
    const lamports = await surfpool.getBalance(authority, "confirmed");
    totalUsd += (lamports / 1e9) * STUB_PRICE_USD.SOL;
  } catch {
    // Surfpool unreachable — fall through and return 0 NAV.
  }

  // Optionally enumerate SPL token balances. We attempt this best-effort
  // — surfpool may be a stripped fork without the token program loaded,
  // in which case we silently skip.
  try {
    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    const accs = await surfpool.getParsedTokenAccountsByOwner(
      authority,
      { programId: TOKEN_PROGRAM_ID },
      "confirmed",
    );
    for (const { account } of accs.value) {
      const parsed = account.data.parsed?.info;
      if (!parsed) continue;
      const symbol = parsed.tokenSymbol || parsed.mint;
      const ui = Number(parsed.tokenAmount?.uiAmount ?? 0);
      const px = STUB_PRICE_USD[symbol] ?? 0;
      if (px > 0 && Number.isFinite(ui)) totalUsd += ui * px;
    }
  } catch {
    // Token-account enumeration optional — ignore failures.
  }

  // Convert USD → bUSD lamports (6 decimals).
  const navLamports = BigInt(Math.max(0, Math.round(totalUsd * 10 ** BUSD_DECIMALS)));
  return navLamports;
}

// Re-export the PDA helper so callers in init-vaults / shared-tick can
// import everything from one module.
export { bundieVaultPda };
// `SystemProgram` import kept available for downstream consumers wiring
// `init_vault` from this same file family.
export { SystemProgram };
