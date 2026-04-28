/**
 * auto-resolver.ts — daemon-side keeper for prediction-market resolution.
 *
 * The on-chain resolve_market_v2 instruction is permissionless once
 * `Clock.slot >= market.resolution_slot`, but no one calls it
 * automatically. Without a keeper, every market sits at status='active'
 * past its resolution slot and bettors can't redeem their winnings.
 *
 * This module scans every market visible to fetchAllMarkets, filters to
 * "active and resolution slot reached", and submits resolve_market_v2
 * for each, signing with the same AGENT_FUNDING_SECRET keypair the
 * backend uses for fee funding (any wallet with SOL works — the resolver
 * doesn't need to be the creator).
 *
 * Crash-safe: errors per market log + continue. The supervisor loop
 * calls runResolverPass once per cycle. A market that fails to resolve
 * (e.g. stale RPC view, target_vault PDA mismatch) is just retried next
 * cycle — the on-chain ix is idempotent w.r.t. its own outcome (it
 * checks status === Active before mutating).
 *
 * Account layout for resolve_market_v2 (mirrors create_market_v2):
 *   resolver        : Signer
 *   market          : mut, the Market PDA
 *   data_a          : placeholder, pass program-id sentinel
 *   data_b          : placeholder, pass program-id sentinel
 *   target_vault_a  : optional, BundieVault PDA — required for kinds 1/2/3
 *   target_vault_b  : optional, BundieVault PDA — required for kind 2 only
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
import {
  AnchorProvider,
  Program,
  Wallet,
  type Idl,
} from "@coral-xyz/anchor";
import { predictionMarketIdl } from "@bundie/common";
import { createHash } from "node:crypto";

const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);
const BUNDIE_VAULT_SEED = Buffer.from("bundie_vault");

interface ResolvableMarketRow {
  /** Market PDA (base58). */
  address: string;
  /** kind 1/2/3. */
  kind: number;
  /** Slot at which the market becomes resolvable. */
  resolutionSlot: number;
  /** Authority (agent_pubkey) for vault A — pinned at create-time. */
  targetAuthorityA: string | null;
  /** Authority for vault B — kind=2 only. */
  targetAuthorityB: string | null;
}

/**
 * Read-only Anchor wallet wrapper. We never sign reads — `payer` only
 * needs to satisfy the Wallet interface for AnchorProvider to construct.
 */
function makeReadonlyWallet(): Wallet {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey,
    payer: kp,
    async signTransaction<T>(_tx: T): Promise<T> {
      throw new Error("auto-resolver wallet is read-only");
    },
    async signAllTransactions<T>(_txs: T[]): Promise<T[]> {
      throw new Error("auto-resolver wallet is read-only");
    },
  } as unknown as Wallet;
}

/**
 * Scan all v2 markets on devnet and return rows ready for resolve_market_v2.
 * Filters: status === Active (kind === 1, 2, or 3). Caller compares
 * resolution_slot to the current slot before submitting.
 */
export async function fetchResolvableCandidates(
  devnet: Connection,
): Promise<ResolvableMarketRow[]> {
  const provider = new AnchorProvider(devnet, makeReadonlyWallet(), {
    commitment: "confirmed",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new Program(predictionMarketIdl as Idl, provider) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: Array<{ publicKey: PublicKey; account: any }> =
    await program.account.market.all();
  return rows.flatMap((row) => {
    const a = row.account;
    // Anchor decodes MarketStatus as `{ active: {} }` / `{ resolved: {} }`.
    if (!a.status || typeof a.status !== "object" || !("active" in a.status)) {
      return [];
    }
    const kind = Number(a.kind ?? 0);
    if (![1, 2, 3].includes(kind)) return [];
    const resolutionSlot = Number(a.resolutionSlot ?? a.resolution_slot ?? 0);
    if (resolutionSlot <= 0) return [];
    const authA: PublicKey | null =
      a.targetAuthorityA ?? a.target_authority_a ?? null;
    const authB: PublicKey | null =
      a.targetAuthorityB ?? a.target_authority_b ?? null;
    return [
      {
        address: row.publicKey.toBase58(),
        kind,
        resolutionSlot,
        targetAuthorityA: authA ? authA.toBase58() : null,
        targetAuthorityB: authB ? authB.toBase58() : null,
      },
    ];
  });
}

interface ResolverCtx {
  /** Devnet RPC connection. Markets live on devnet. */
  devnet: Connection;
  /** Funded wallet that pays tx fees. */
  resolverKp: Keypair;
}

/** Anchor 8-byte discriminator for the named instruction. */
function disc(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

function deriveBundieVault(authority: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [BUNDIE_VAULT_SEED, authority.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID,
  );
  return pda;
}

/**
 * Build + send resolve_market_v2 for one market. Returns the tx sig on
 * success. Throws on simulate / send failure — caller wraps.
 */
async function resolveOne(
  ctx: ResolverCtx,
  m: ResolvableMarketRow,
): Promise<string> {
  if (!m.targetAuthorityA) {
    throw new Error(
      `market ${m.address.slice(0, 8)} has no targetAuthorityA — cannot resolve`,
    );
  }
  if (m.kind === 2 && !m.targetAuthorityB) {
    throw new Error(
      `market ${m.address.slice(0, 8)} is head-to-head but missing targetAuthorityB`,
    );
  }
  const market = new PublicKey(m.address);
  const authA = new PublicKey(m.targetAuthorityA);
  const vaultA = deriveBundieVault(authA);

  let vaultB: PublicKey | null = null;
  if (m.kind === 2 && m.targetAuthorityB) {
    const authB = new PublicKey(m.targetAuthorityB);
    vaultB = deriveBundieVault(authB);
  }

  // data_a / data_b are unused by the current resolver — the create-time
  // tx layout passes SystemProgram as the placeholder; we keep that.
  const placeholder = SystemProgram.programId;

  const keys: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }> = [
    { pubkey: ctx.resolverKp.publicKey, isSigner: true, isWritable: true },
    { pubkey: market, isSigner: false, isWritable: true },
    { pubkey: placeholder, isSigner: false, isWritable: false },
    { pubkey: placeholder, isSigner: false, isWritable: false },
    { pubkey: vaultA, isSigner: false, isWritable: false },
  ];
  if (vaultB) {
    keys.push({ pubkey: vaultB, isSigner: false, isWritable: false });
  }

  const ix = new TransactionInstruction({
    programId: PREDICTION_MARKET_PROGRAM_ID,
    keys,
    data: disc("resolve_market_v2"),
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = ctx.resolverKp.publicKey;
  const { blockhash } = await ctx.devnet.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  return await sendAndConfirmTransaction(ctx.devnet, tx, [ctx.resolverKp], {
    commitment: "confirmed",
    skipPreflight: false,
  });
}

/**
 * One pass over all known markets. Caller is the supervisor loop.
 * Markets are fed in by the supervisor (it already fetches them for the
 * peer-list build) so this module doesn't need its own program client.
 */
export async function runResolverPass(
  ctx: ResolverCtx,
  candidates: ResolvableMarketRow[],
  currentSlot: number,
): Promise<{ resolved: number; failed: number }> {
  let resolved = 0;
  let failed = 0;
  for (const m of candidates) {
    if (currentSlot < m.resolutionSlot) continue;
    try {
      const sig = await resolveOne(ctx, m);
      console.log(
        `[auto-resolver] resolved ${m.address.slice(0, 12)}… (kind ${m.kind}) tx=${sig.slice(0, 12)}…`,
      );
      resolved++;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // 'MarketNotActive' means it's already resolved (race); not really
      // a failure. Same for 'ResolutionNotReached' if our slot read was
      // ahead of the validator's view.
      if (
        msg.includes("MarketNotActive") ||
        msg.includes("ResolutionNotReached")
      ) {
        // Suppress — benign races
        continue;
      }
      console.warn(
        `[auto-resolver] ${m.address.slice(0, 12)}… failed: ${msg.slice(0, 200)}`,
      );
      failed++;
    }
  }
  return { resolved, failed };
}
