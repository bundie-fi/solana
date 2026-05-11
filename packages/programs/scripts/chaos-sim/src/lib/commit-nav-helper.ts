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
import {
  createBurnInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  KaminoMarket,
  KaminoObligation,
} from "@kamino-finance/klend-sdk";
import { createSolanaRpc } from "@solana/kit";
import type { Address } from "@solana/kit";
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
 *   owner_wallet:  Pubkey       32 bytes  (offset 40)
 *   treasury_mint: Pubkey       32 bytes  (offset 72)
 *   treasury_ata:  Pubkey       32 bytes  (offset 104)
 *   nav_lamports:  u64 LE        8 bytes  (offset 136)
 *   nav_epoch:     u64 LE        8 bytes  (offset 144)
 *   nav_slot:      u64 LE        8 bytes  (offset 152)
 *   commit_digest: [u8; 32]     32 bytes  (offset 160)
 *   bump:          u8            1 byte   (offset 192)
 *
 * Total: 193 bytes. Earlier comment in this file referenced an obsolete
 * pre-Phase-J layout (offset 48) that pre-dated the owner_wallet /
 * treasury_mint / treasury_ata fields — that read silently produced a
 * garbage epoch from the middle of owner_wallet, which then failed the
 * `new_epoch == prev + 1` check in commit_nav with StaleNavEpoch on every
 * tick. The error was swallowed by the daemon's per-action try/catch so
 * the rest of the tick still ran, masking the bug until the agent logs
 * were grepped.
 */
async function readVaultEpoch(
  conn: Connection,
  vaultPda: PublicKey,
): Promise<{ exists: boolean; epoch: bigint }> {
  const info = await conn.getAccountInfo(vaultPda, "confirmed");
  if (!info || info.data.length < 152) return { exists: false, epoch: 0n };
  const epoch = info.data.readBigUInt64LE(144);
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

// ─── bUSD treasury performance-sync ──────────────────────────────────────

export interface SyncTreasuryArgs {
  /** Devnet connection — same one used for commit_nav. */
  connection: Connection;
  /** Keypair holding bUSD mint authority. Same secret the backend faucet
   *  uses (env: BUSD_MINT_AUTHORITY_SECRET). */
  busdMintAuthority: Keypair;
  busdMintPubkey: PublicKey;
  vaultPda: PublicKey;
  agentPubkey: PublicKey;
  /** Latest committed NAV in bUSD base units. */
  currentNavLamports: bigint;
}

/**
 * Mint extra bUSD into the agent's treasury_ata so the on-chain treasury
 * mirrors the agent's surfpool position value 1:1:
 *
 *   target_treasury_busd = current_nav_lamports
 *
 * That's safe because `computeNavFromSurfpoolBalances` reads ONLY from
 * surfpool — the devnet treasury balance isn't part of NAV, so there's
 * no feedback loop where setting treasury to NAV inflates next tick's
 * NAV.
 *
 * Conceptually: surfpool seeds the agent with `seed` USDC (matching the
 * user's bUSD deposit). The agent trades that USDC into LSTs / lend
 * positions / perp equity / etc. NAV is the live USD-equivalent of
 * those holdings (plus any leftover gas SOL — minor over short windows).
 * Mirroring NAV to bUSD gives the user `close_vault` payouts that
 * reflect actual trading performance.
 *
 * MINT-ONLY: no burn path because that needs the vault PDA to sign the
 * SPL Token Burn ix, requiring a new on-chain instruction. Down-side
 * moves are absorbed by the prior peak; minting resumes once NAV
 * recovers.
 *
 * Returns the mint tx signature + delta when minting happens, or null.
 */
export async function syncTreasuryToPerformance(
  args: SyncTreasuryArgs,
): Promise<{ txSig: string; minted: bigint } | null> {
  // 1:1 NAV mirror: surfpool seed = user's bUSD seed (see
  // ensureSurfpoolUsdc plumbing in the daemon), so NAV directly
  // represents what the user's $X has become.
  const target = args.currentNavLamports;

  // Read current treasury balance.
  const treasuryAta = getAssociatedTokenAddressSync(
    args.busdMintPubkey,
    args.vaultPda,
    true, // off-curve — treasury is owned by vault PDA
  );
  let current: bigint;
  try {
    const info = await args.connection.getTokenAccountBalance(treasuryAta);
    current = BigInt(info.value.amount);
  } catch {
    // Treasury ATA missing or unreadable — skip the sync this tick;
    // commit_nav already succeeded so we don't want to error the whole
    // pipeline over a sync miss.
    return null;
  }

  // Mint-only: skip if treasury is already at or above target.
  if (target <= current) return null;

  const delta = target - current;
  const ix = createMintToInstruction(
    args.busdMintPubkey,
    treasuryAta,
    args.busdMintAuthority.publicKey,
    delta,
  );
  const tx = new Transaction().add(ix);
  tx.feePayer = args.busdMintAuthority.publicKey;
  const txSig = await sendAndConfirmTransaction(
    args.connection,
    tx,
    [args.busdMintAuthority],
    { commitment: "confirmed" },
  );

  return { txSig, minted: delta };
}

// ─── NAV computation (initial implementation) ─────────────────────────────

/**
 * Last-resort fallback prices, used **only** when the surfpool Pyth read
 * fails (e.g. the fork was redeployed and the oracle account is empty, or
 * the RPC is flapping). Live prices come from `readPythPriceUsd` against
 * the mainnet feed accounts forwarded into the surfpool fork — see the
 * `PYTH_PRICE_ACCOUNTS` map below.
 *
 * Keep these somewhat reasonable so that a Pyth outage does not freeze
 * `commit_nav` (which would block the entire daemon's prediction-market
 * loop). The daemon logs a warning each time the fallback is hit so the
 * operator can spot prolonged degradation.
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
 * How long (ms) a Kamino reserve / Zeta equity reading is considered fresh
 * enough to reuse. Capped at 60s by spec — agents' positions can change
 * fast (a perp_open mid-tick must be visible by the next NAV commit).
 */
const PROTOCOL_POSITION_TTL_MS = 60_000;

// ─── Pyth pull-oracle reader ──────────────────────────────────────────────

/**
 * Mainnet Pyth price-feed account pubkeys for the symbols the chaos-sim
 * NAV pricer cares about. Surfpool is a mainnet fork, so these accounts
 * exist on the fork verbatim — no remapping needed.
 *
 * - SOL/USD: legacy Pyth aggregate account.
 * - mSOL/USD: legacy Pyth aggregate account.
 *
 * USDC and bUSD are intentionally pinned to $1 in the in-process cache
 * below: USDC has a Pyth feed but a depeg would be a strictly upside
 * surprise for the chaos-sim's NAV (and the precision noise of reading
 * the oracle outweighs the realism gain), and bUSD is our internal
 * stablecoin that has no oracle at all.
 */
const PYTH_PRICE_ACCOUNTS: Partial<Record<string, string>> = {
  SOL: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG",
  mSOL: "E4v1BBgoso9s64TQvmyownAVJbhbEPGyzA3qn4n46qj9",
  // USDC and bUSD are pinned via FORCED_PRICES_USD below.
};

/** Symbols whose price is hard-pinned and never read from Pyth. */
const FORCED_PRICES_USD: Partial<Record<string, number>> = {
  USDC: 1,
  bUSD: 1,
};

/** Pyth Solana Receiver program (used by V2 priceUpdateV2 accounts). */
const PYTH_RECEIVER_PROGRAM_ID = new PublicKey(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
);

/** Magic constant prefixing legacy Pyth price accounts. */
const PYTH_LEGACY_MAGIC = 0xa1b2c3d4;

/** How long (ms) a Pyth price reading is considered fresh enough to reuse. */
const PRICE_CACHE_TTL_MS = 60_000;

/** Reject readings whose `conf / |price|` exceeds this fraction. */
const MAX_CONFIDENCE_FRACTION = 0.05;

interface CachedPrice {
  priceUsd: number;
  fetchedAt: number;
  source: "pyth-legacy" | "pyth-v2" | "pinned" | "fallback";
}

const priceCache: Map<string, CachedPrice> = new Map();
let priceLogEmitted = false;

/**
 * Decode a Pyth price account (legacy or V2 Solana Receiver) into a
 * `{ price, conf, expo }` triple. Throws on unrecognised layouts.
 *
 * Legacy Pyth aggregate price layout (only the fields we need):
 *   offset 0   : u32 LE  magic (0xa1b2c3d4)
 *   offset 20  : i32 LE  exponent
 *   offset 208 : i64 LE  agg.price
 *   offset 216 : u64 LE  agg.conf
 *
 * Pyth V2 priceUpdateV2 layout: see comments on `parsePyth` in
 * scripts/mango-probe-oracles.mjs — the trailing 92 bytes hold the price
 * fields at fixed negative offsets.
 */
function decodePythAccount(
  data: Buffer,
  owner: PublicKey,
): { price: number; conf: number; expo: number } {
  // V2 priceUpdateV2 (owned by the Pyth Solana Receiver program)
  if (owner.equals(PYTH_RECEIVER_PROGRAM_ID)) {
    if (data.length < 8 + 32 + 1 + 84 + 8) {
      throw new Error(`pyth-v2: account too short (${data.length} bytes)`);
    }
    const expo = data.readInt32LE(data.length - 44);
    const priceRaw = data.readBigInt64LE(data.length - 60);
    const confRaw = data.readBigUInt64LE(data.length - 52);
    const scale = Math.pow(10, expo);
    return {
      price: Number(priceRaw) * scale,
      conf: Number(confRaw) * scale,
      expo,
    };
  }
  // Legacy Pyth aggregate
  if (data.length >= 240 && data.readUInt32LE(0) === PYTH_LEGACY_MAGIC) {
    const expo = data.readInt32LE(20);
    const priceRaw = data.readBigInt64LE(208);
    const confRaw = data.readBigUInt64LE(216);
    const scale = Math.pow(10, expo);
    return {
      price: Number(priceRaw) * scale,
      conf: Number(confRaw) * scale,
      expo,
    };
  }
  throw new Error(
    `unrecognised pyth account (owner=${owner.toBase58()}, len=${data.length})`,
  );
}

/**
 * Fetch a USD price for `symbol` from a Pyth feed account on the supplied
 * `priceConn` (mainnet RPC for live oracles, falling back to the surfpool
 * fork only when no separate mainnet RPC is configured), caching successful
 * reads for `PRICE_CACHE_TTL_MS`. On any failure (account missing, decode
 * error, confidence too wide), logs a warning and returns the
 * `STUB_PRICE_USD` fallback so the daemon keeps moving.
 *
 * Reading prices from a separate live mainnet RPC avoids the
 * "frozen-at-fork-creation" Pyth staleness on surfpool — token balances /
 * Kamino / Solend reads still hit the fork, only oracle prices come from
 * mainnet.
 *
 * The cache is keyed by symbol so all callers share a single price per
 * tick window; this keeps the digest deterministic across the multiple
 * NAV computations performed within one second.
 */
async function readPythPriceUsd(
  priceConn: Connection,
  symbol: string,
): Promise<number> {
  const now = Date.now();

  // Pinned symbols (bUSD, USDC) — never hit the network.
  const forced = FORCED_PRICES_USD[symbol];
  if (forced !== undefined) {
    const cached = priceCache.get(symbol);
    if (!cached) {
      priceCache.set(symbol, {
        priceUsd: forced,
        fetchedAt: now,
        source: "pinned",
      });
    }
    return forced;
  }

  const cached = priceCache.get(symbol);
  if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cached.priceUsd;
  }

  const feedAddr = PYTH_PRICE_ACCOUNTS[symbol];
  const fallback = STUB_PRICE_USD[symbol] ?? 0;
  if (!feedAddr) {
    // No oracle wired up for this symbol — use the static fallback.
    priceCache.set(symbol, {
      priceUsd: fallback,
      fetchedAt: now,
      source: "fallback",
    });
    return fallback;
  }

  try {
    const info = await priceConn.getAccountInfo(new PublicKey(feedAddr), "confirmed");
    if (!info) {
      throw new Error(`feed account ${feedAddr} missing on price RPC`);
    }
    const { price, conf } = decodePythAccount(info.data, info.owner);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`non-positive price: ${price}`);
    }
    const confFraction = Math.abs(conf / price);
    if (confFraction > MAX_CONFIDENCE_FRACTION) {
      throw new Error(
        `confidence too wide: conf/price=${(confFraction * 100).toFixed(2)}% (>${(MAX_CONFIDENCE_FRACTION * 100).toFixed(0)}%)`,
      );
    }
    const source: CachedPrice["source"] = info.owner.equals(PYTH_RECEIVER_PROGRAM_ID)
      ? "pyth-v2"
      : "pyth-legacy";
    priceCache.set(symbol, { priceUsd: price, fetchedAt: now, source });
    return price;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[nav-pricing] WARN: ${symbol} Pyth read failed (${msg}) — using fallback $${fallback}`,
    );
    priceCache.set(symbol, {
      priceUsd: fallback,
      fetchedAt: now,
      source: "fallback",
    });
    return fallback;
  }
}

/**
 * Resolve every price the NAV computation needs. The one-time banner is
 * emitted later (in `computeNavFromSurfpoolBalances`) so it can also
 * include Kamino + Zeta breakdown numbers — see `emitNavPricingBanner`.
 *
 * Pyth reads target `priceConn` — typically a live mainnet RPC threaded
 * through from the daemon. This is what keeps NAV oracle prices fresh
 * even though the surfpool fork's Pyth accounts are frozen at
 * fork-creation time. When no mainnet RPC is wired the caller passes the
 * surfpool fork as `priceConn` (legacy behaviour).
 */
async function loadPricesForNav(
  priceConn: Connection,
): Promise<Record<string, number>> {
  const symbols = ["SOL", "mSOL", "USDC", "bUSD"];
  const entries = await Promise.all(
    symbols.map(async (s) => [s, await readPythPriceUsd(priceConn, s)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Format a USD figure consistently in the [nav-pricing] banner.
 */
function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Emit the one-shot `[nav-pricing] …` banner showing every input that
 * went into NAV: Pyth-priced symbols + Kamino + MarginFi + Solend +
 * Zeta USD subtotals. Idempotent — only fires once per process.
 */
function emitNavPricingBanner(
  prices: Record<string, number>,
  kaminoUsd: number,
  marginfiUsd: number,
  solendUsd: number,
  zetaUsd: number,
): void {
  if (priceLogEmitted) return;
  priceLogEmitted = true;
  const symbols = ["SOL", "mSOL", "USDC", "bUSD"];
  const sources = symbols
    .map((s) => `${s}=${fmtUsd(prices[s] ?? 0)}(${priceCache.get(s)?.source ?? "?"})`)
    .join(" ");
  console.log(
    `[nav-pricing] ${sources} kamino=${fmtUsd(kaminoUsd)} marginfi=${fmtUsd(marginfiUsd)} solend=${fmtUsd(solendUsd)} zeta=${fmtUsd(zetaUsd)}`,
  );
}

// ─── Kamino kToken / Obligation valuation ────────────────────────────────

/**
 * Kamino mainnet program id — the on-chain owner of every reserve + obligation
 * account on mainnet (and inherited by the surfpool fork). Matches the
 * constant in `kamino-execute.ts` as of the program-id reconciliation;
 * also what `probe-kamino-reserve.ts` checks for.
 */
const KLEND_MAINNET_PROGRAM_ID_STR =
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";

/** Kamino "Main Market" PDA — same constant as `kamino-execute.ts`. */
const KAMINO_MAIN_MARKET_PDA_STR =
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";

/**
 * Reserves we know how to value. Each entry is the on-chain reserve PDA
 * we read raw bytes from + the underlying liquidity mint symbol so we can
 * price the underlying via Pyth/pinned. The cToken mint is *discovered*
 * from the reserve's collateral.mint_pubkey field at decode time, so we
 * don't have to hardcode it here.
 *
 * Today this only covers the Kamino main market USDC reserve — that's
 * the only reserve `executeLend` deposits into (see kamino-execute.ts).
 * Adding cSOL / cmSOL is just a matter of appending to this list and
 * making sure the corresponding underlying symbol is priced above.
 */
const KAMINO_RESERVES_FOR_NAV: ReadonlyArray<{
  reserve: string;
  underlyingSymbol: string;
}> = [
  {
    // Kamino main market USDC reserve.
    reserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
    underlyingSymbol: "USDC",
  },
];

/**
 * Reserve byte offsets, mirrored verbatim from
 *   - `packages/programs/scripts/probes/probe-kamino-reserve.ts`
 *   - `packages/programs/scripts/chaos-sim/src/lib/rate-surfaces.ts`
 *
 * The probe script enforces these against a live fixture; if Kamino ever
 * migrates the Reserve layout the probe will break first and surface the
 * drift with a loud failure. Keeping the same offsets in this file means
 * we update them in one go when that happens.
 */
const RESERVE_OFFSET_LIQUIDITY_AVAILABLE = 224;
const RESERVE_OFFSET_LIQUIDITY_BORROWED_SF = 232;
const RESERVE_OFFSET_COLLATERAL_MINT_PUBKEY = 1344;
const RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY = 1376;
const RESERVE_MIN_LEN = RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY + 8;
const SF_SCALE_BITS_KLEND = 60n;

interface KaminoReserveSnapshot {
  reserve: string;
  /**
   * cToken (collateral) SPL mint. For Kamino's main-market reserves this
   * is often the zero pubkey because the main market tracks deposits via
   * Obligation accounts rather than minting redeemable cTokens — agents
   * who deposit through `kamino-execute.ts` (VanillaObligation flow) do
   * not receive any cToken SPL balance. We still record the mint for
   * the rare reserves that DO mint redeemable cTokens, where the
   * cToken-balance valuation path applies.
   */
  cTokenMint: string;
  /** Symbol of the underlying liquidity (e.g. "USDC"). */
  underlyingSymbol: string;
  /**
   * Underlying-per-cToken ratio. Mirrors klend's `getCollateralExchangeRate`
   * inverse:
   *   underlyingPerCToken = totalUnderlying / mintTotalSupply
   * Both numerator and denominator are in the same base units (cToken and
   * underlying share decimals on klend), so the ratio is dimension-less.
   * Multiply a cToken or obligation `depositedAmount` (in collateral base
   * units) by this to get the equivalent underlying base units.
   *
   * Defaults to 1.0 when the reserve has never minted cTokens (klend's
   * INITIAL_COLLATERAL_RATIO behaviour) — this is the conservative read
   * for our chaos-sim agents, who deposit ≪ the reserve's float.
   */
  exchangeRate: number;
  /** Total underlying base units in the reserve (available + borrowed). */
  totalUnderlyingBaseUnits: bigint;
  fetchedAt: number;
}

/**
 * Per-reserve cache of decoded snapshots, TTL bounded by
 * `PROTOCOL_POSITION_TTL_MS`. Reserve data changes every slot (interest
 * accrual ticks `borrowed_amount_sf` upward) but for NAV purposes a 60s
 * window is fine — interest in 60s is below the noise floor.
 */
const kaminoReserveCache: Map<string, KaminoReserveSnapshot> = new Map();

/**
 * Read a Kamino reserve account on surfpool and decode the fields we need
 * for cToken valuation. Returns `null` and logs on any failure (account
 * missing, wrong owner, layout mismatch, division-by-zero) so NAV stays
 * conservative rather than crashing.
 */
async function readKaminoReserveSnapshot(
  surfpool: Connection,
  reserveStr: string,
  underlyingSymbol: string,
): Promise<KaminoReserveSnapshot | null> {
  const cached = kaminoReserveCache.get(reserveStr);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < PROTOCOL_POSITION_TTL_MS) {
    return cached;
  }

  try {
    const reservePk = new PublicKey(reserveStr);
    const info = await surfpool.getAccountInfo(reservePk, "confirmed");
    if (!info) {
      throw new Error(`reserve ${reserveStr} missing on surfpool`);
    }
    if (info.owner.toBase58() !== KLEND_MAINNET_PROGRAM_ID_STR) {
      throw new Error(
        `reserve ${reserveStr} owner ${info.owner.toBase58()} != klend mainnet program`,
      );
    }
    if (info.data.length < RESERVE_MIN_LEN) {
      throw new Error(
        `reserve ${reserveStr} too small (${info.data.length} < ${RESERVE_MIN_LEN})`,
      );
    }

    // available_amount @ 224..232  (u64 LE)
    const available = info.data.readBigUInt64LE(RESERVE_OFFSET_LIQUIDITY_AVAILABLE);

    // borrowed_amount_sf @ 232..248 (u128 LE, scaled by 2^60)
    const bLo = info.data.readBigUInt64LE(RESERVE_OFFSET_LIQUIDITY_BORROWED_SF);
    const bHi = info.data.readBigUInt64LE(RESERVE_OFFSET_LIQUIDITY_BORROWED_SF + 8);
    const borrowedSf = (bHi << 64n) | bLo;
    const borrowed = borrowedSf >> SF_SCALE_BITS_KLEND;

    // collateral.mint_pubkey @ 1344..1376
    const cTokenMint = new PublicKey(
      info.data.subarray(
        RESERVE_OFFSET_COLLATERAL_MINT_PUBKEY,
        RESERVE_OFFSET_COLLATERAL_MINT_PUBKEY + 32,
      ),
    ).toBase58();

    // collateral.mint_total_supply @ 1376..1384 (u64 LE, base units)
    const cTokenSupply = info.data.readBigUInt64LE(
      RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY,
    );

    const totalUnderlying = available + borrowed;
    // BigInt → number ratio. 2^53 headroom is plenty: USDC reserves cap
    // out around 1e9 USDC = 1e15 base units, well below MAX_SAFE_INTEGER.
    let exchangeRate: number;
    if (cTokenSupply === 0n) {
      // Reserve has never minted cTokens (the common case for Kamino
      // main-market vanilla obligations) — klend uses 1:1 here too. See
      // `INITIAL_COLLATERAL_RATIO` in the SDK's utils/constants.
      exchangeRate = 1;
    } else {
      exchangeRate = Number(totalUnderlying) / Number(cTokenSupply);
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        throw new Error(
          `non-positive exchange rate ${exchangeRate} (totalUnderlying=${totalUnderlying} cTokenSupply=${cTokenSupply})`,
        );
      }
    }

    const snap: KaminoReserveSnapshot = {
      reserve: reserveStr,
      cTokenMint,
      underlyingSymbol,
      exchangeRate,
      totalUnderlyingBaseUnits: totalUnderlying,
      fetchedAt: now,
    };
    kaminoReserveCache.set(reserveStr, snap);
    return snap;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[nav-pricing] WARN: kamino reserve ${reserveStr} read failed: ${msg}`);
    return null;
  }
}

/**
 * Read every reserve we care about and return two indices:
 *   - `byCToken`: map keyed by cToken SPL mint (base58) for the parsed-
 *     token-account loop. Skips reserves whose cToken mint is the zero
 *     pubkey (vanilla-obligation reserves never mint redeemable cTokens
 *     so there is no SPL balance to match).
 *   - `byReserve`: map keyed by reserve PDA (base58) for the obligation
 *     loop, which references reserves directly via depositReserve.
 *
 * Called once per NAV computation; the underlying reserve reads are
 * TTL-cached so subsequent calls within `PROTOCOL_POSITION_TTL_MS`
 * resolve without an RPC round trip.
 *
 * MarginFi + Solend deposit pricing live in `loadMarginfiSnapshots` and
 * `loadSolendSnapshots` below — same shape (per-agent USD subtotal +
 * breakdown), same TTL cache pattern.
 */
async function loadKaminoSnapshots(
  surfpool: Connection,
): Promise<{
  byCToken: Map<string, KaminoReserveSnapshot>;
  byReserve: Map<string, KaminoReserveSnapshot>;
}> {
  const byCToken = new Map<string, KaminoReserveSnapshot>();
  const byReserve = new Map<string, KaminoReserveSnapshot>();
  await Promise.all(
    KAMINO_RESERVES_FOR_NAV.map(async (entry) => {
      const snap = await readKaminoReserveSnapshot(
        surfpool,
        entry.reserve,
        entry.underlyingSymbol,
      );
      if (!snap) return;
      byReserve.set(snap.reserve, snap);
      // Only index by cToken mint if it's a real (non-zero) mint. Vanilla-
      // obligation reserves leave collateral.mint_pubkey as the system
      // program's default address, which would clobber any other reserve
      // sharing that null index.
      if (
        snap.cTokenMint !== "11111111111111111111111111111111" &&
        snap.cTokenMint !== ""
      ) {
        byCToken.set(snap.cTokenMint, snap);
      }
    }),
  );
  return { byCToken, byReserve };
}

// ─── Kamino Obligation reader ────────────────────────────────────────────

/**
 * Module-scope cache of the loaded `KaminoMarket`. The first
 * `KaminoMarket.load()` against surfpool is slow (~9min in the worst
 * case — pulls every reserve + scope state) but subsequent loads warm
 * from Solana's RPC caches. The cache here keeps the loaded market
 * alive across multiple per-agent NAV computations within a single
 * daemon tick AND across nearby ticks, while still refreshing often
 * enough that `KaminoObligation.load(...).refreshedStats` reflects
 * recent oracle moves.
 *
 * TTL = 60s: chaos-sim ticks every ~15s (CHAOS_SIM_POLL_INTERVAL_MS),
 * so this is ~1 load per minute, ~7 reuses per load.
 */
const KAMINO_MARKET_TTL_MS = 60_000;
let kaminoMarketCache: { market: KaminoMarket; fetchedAt: number } | null =
  null;
const MAINNET_SLOT_DURATION_MS_NAV = 450;

async function getCachedKaminoMarket(
  rpcUrl: string,
): Promise<KaminoMarket | null> {
  const now = Date.now();
  if (
    kaminoMarketCache &&
    now - kaminoMarketCache.fetchedAt < KAMINO_MARKET_TTL_MS
  ) {
    return kaminoMarketCache.market;
  }
  try {
    const kitRpc = createSolanaRpc(rpcUrl);
    const market = await KaminoMarket.load(
      kitRpc,
      KAMINO_MAIN_MARKET_PDA_STR as Address,
      MAINNET_SLOT_DURATION_MS_NAV,
      KLEND_MAINNET_PROGRAM_ID_STR as Address,
      true,
    );
    if (!market) {
      // Don't cache nulls — let the next call retry.
      console.warn(
        `[nav-pricing] WARN: KaminoMarket.load returned null for ${KAMINO_MAIN_MARKET_PDA_STR}`,
      );
      return null;
    }
    kaminoMarketCache = { market, fetchedAt: now };
    return market;
  } catch (e) {
    console.warn(
      `[nav-pricing] WARN: KaminoMarket.load failed: ${(e as Error).message}`,
    );
    return null;
  }
}

/**
 * Derive the Vanilla Obligation PDA for `(market, user)` — mirrors
 * `VanillaObligation.toPda`:
 *   seeds = [
 *     [tag=0],            // 1 byte
 *     [id=0],             // 1 byte
 *     user.toBytes(),     // 32 bytes
 *     market.toBytes(),   // 32 bytes
 *     default.toBytes(),  // 32 bytes (seed1)
 *     default.toBytes(),  // 32 bytes (seed2)
 *   ]
 *   programId = klend mainnet
 *
 * Synchronous because PublicKey.findProgramAddressSync is synchronous —
 * no need to await even though the SDK's helper is async.
 */
function vanillaObligationPda(
  market: PublicKey,
  user: PublicKey,
): PublicKey {
  const programId = new PublicKey(KLEND_MAINNET_PROGRAM_ID_STR);
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([0]), // tag
      Buffer.from([0]), // id
      user.toBuffer(),
      market.toBuffer(),
      PublicKey.default.toBuffer(),
      PublicKey.default.toBuffer(),
    ],
    programId,
  );
  return pda;
}

/**
 * Compute the USD value of the agent's vanilla Kamino obligation
 * (deposits − borrows), using the klend SDK's `KaminoObligation.load`
 * to apply CURRENT reserve exchange rates and oracle prices.
 *
 * Why the SDK path (over raw byte reads or static `marketValueSf`):
 *
 *   The obligation account stores `depositedAmount` (collateral base
 *   units) and a `marketValueSf` (USD × 2^60). Both have edge-cases:
 *
 *   1. `depositedAmount` requires a collateral→underlying exchange rate
 *      to translate to USD. For Kamino's main USDC reserve no cTokens
 *      are minted (collateralMintTotalSupply == 0 is steady-state, not
 *      empty-reserve), so the obvious `totalUnderlying / cTokenSupply`
 *      formula divides by zero and the prior hand-rolled decoder fell
 *      back to 1:1 — which under-counted by ~17% vs the program's
 *      actual rate (1.181x for the May 2026 cohort).
 *
 *   2. `marketValueSf` IS the program-computed USD, but it's only
 *      refreshed when a deposit / withdraw / refresh_obligation ix
 *      runs against the obligation. Probes showed values 70+ hours
 *      stale; for stable-arber it read $5 while the on-tick refreshed
 *      value (per a simulated withdraw) was $1005.
 *
 *   `KaminoObligation.load` does both at once: pulls the obligation
 *   account, pulls the reserves it references via the cached
 *   KaminoMarket, applies the SDK's own collateral-exchange-rate
 *   formula (matching klend's `collateral_to_liquidity` exactly), and
 *   exposes the result on `refreshedStats.userTotalDeposit` /
 *   `userTotalBorrow` in USD.
 *
 *   We subtract borrows defensively. Vanilla obligations on the main
 *   USDC reserve don't carry borrows today, but the same code path is
 *   used for any future market the brain targets (Multiply, leveraged
 *   pools, etc.) where borrows would otherwise inflate NAV.
 *
 * Returns 0 when the agent has no Obligation, when the loaded
 * KaminoMarket isn't available (cold-start failure, RPC blip), or on
 * any per-agent decode error. Fail-soft is the right behavior for the
 * NAV writer — a transient zero won't permanently affect TVL because
 * the next tick re-reads.
 */
async function computeKaminoObligationUsd(
  surfpool: Connection,
  authority: PublicKey,
): Promise<number> {
  try {
    const market = await getCachedKaminoMarket(surfpool.rpcEndpoint);
    if (!market) {
      // Couldn't load the market — drop a zero rather than crash the
      // NAV tick. The next tick will retry; if surfpool is really down
      // the rest of the breakdown still reports correctly.
      return 0;
    }
    const marketPk = new PublicKey(KAMINO_MAIN_MARKET_PDA_STR);
    const obligationPda = vanillaObligationPda(marketPk, authority);

    // Bail early if the agent has no obligation account at all — this
    // is the common "never deposited" path and avoids a wasted SDK
    // call that would just return null anyway.
    const info = await surfpool.getAccountInfo(obligationPda, "confirmed");
    if (!info) return 0;
    if (info.owner.toBase58() !== KLEND_MAINNET_PROGRAM_ID_STR) {
      throw new Error(
        `obligation owner ${info.owner.toBase58()} != klend mainnet`,
      );
    }

    const kobl = await KaminoObligation.load(
      market,
      obligationPda.toBase58() as Address,
    );
    if (!kobl) {
      // load() returns null when the obligation isn't fetchable through
      // the market's reserve set. Treat as zero — the obligation exists
      // (we just confirmed) but the SDK couldn't price it, so don't
      // make up a number.
      return 0;
    }

    const deposit = kobl.refreshedStats.userTotalDeposit.toNumber();
    const borrow = kobl.refreshedStats.userTotalBorrow.toNumber();
    const net = deposit - borrow;
    return net > 0 ? net : 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[nav-pricing] WARN: kamino obligation read for ${authority.toBase58()} failed: ${msg}`,
    );
    return 0;
  }
}

// ─── MarginFi deposit valuation ──────────────────────────────────────────

/**
 * Per-agent USD breakdown entry returned by the protocol pricers. The
 * shape is intentionally identical across MarginFi / Solend so the
 * diagnostic banner can iterate them uniformly.
 */
interface ProtocolPositionEntry {
  /** Human-readable label for the [nav-pricing] banner / STATE_JSON. */
  label: string;
  /** USD value of this single position. */
  usd: number;
}

interface ProtocolSnapshotResult {
  usdSubtotal: number;
  breakdown: ProtocolPositionEntry[];
  fetchedAt: number;
}

/**
 * Map a SPL mint pubkey (base58) to the symbol our Pyth helper recognises.
 * Same set of mints the Pyth-priced spot path covers — anything else
 * contributes 0 (logged once per unknown mint).
 */
const MINT_TO_SYMBOL: Record<string, string> = {
  // USDC mainnet (inherited by surfpool fork).
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  // SOL — represented by the wrapped-SOL mint when held inside a token account.
  So11111111111111111111111111111111111111112: "SOL",
  // mSOL.
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
};

/**
 * Per-agent cache of MarginFi USD subtotals. Same TTL semantics as the
 * Kamino reserve cache — interest accrual within 60s rounds to noise.
 */
const marginfiCache: Map<string, ProtocolSnapshotResult> = new Map();

/**
 * Lazy-load the MarginFi v2 SDK. Mirrors `marginfi-execute.ts` — keep the
 * import behind a dynamic boundary so eagerly importing this file does not
 * drag the SDK's transitive web3.js@1.92 / rpc-websockets pin into the
 * static graph (the same crash that already cost a session, see
 * marginfi-execute.ts header).
 */
async function loadMarginfiSdkForRead(): Promise<
  typeof import("@mrgnlabs/marginfi-client-v2") | null
> {
  try {
    return await import("@mrgnlabs/marginfi-client-v2");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[nav-pricing] WARN: marginfi SDK import failed: ${msg}`);
    return null;
  }
}

async function loadMrgnCommonForRead(): Promise<
  typeof import("@mrgnlabs/mrgn-common") | null
> {
  try {
    return await import("@mrgnlabs/mrgn-common");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[nav-pricing] WARN: mrgn-common import failed: ${msg}`);
    return null;
  }
}

/**
 * Read the agent's MarginFi deposits and return a USD subtotal plus a
 * per-bank breakdown. Returns `{ usdSubtotal: 0, breakdown: [] }` when
 * the agent has no MarginfiAccount (i.e. has never deposited).
 *
 * We use the SDK rather than hand-rolling the LendingAccount layout: the
 * MarginfiAccountWrapper exposes `activeBalances` and per-Balance
 * `computeQuantityUi(bank)` which returns the asset/liability quantities
 * already converted from `assetShares × assetShareValue` to UI base
 * units. Hand-rolling would require parsing the I80F48 share-value drift
 * the probe script already calls out as fragile.
 *
 * Per-agent fail-soft: any error logs and contributes 0.
 */
async function loadMarginfiSnapshots(
  surfpool: Connection,
  mainnet: Connection,
  agentPubkey: PublicKey,
): Promise<{ usdSubtotal: number; breakdown: ProtocolPositionEntry[] }> {
  const key = agentPubkey.toBase58();
  const cached = marginfiCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < PROTOCOL_POSITION_TTL_MS) {
    return { usdSubtotal: cached.usdSubtotal, breakdown: cached.breakdown };
  }

  try {
    const sdk = await loadMarginfiSdkForRead();
    const common = await loadMrgnCommonForRead();
    if (!sdk || !common) {
      const empty: ProtocolSnapshotResult = {
        usdSubtotal: 0,
        breakdown: [],
        fetchedAt: now,
      };
      marginfiCache.set(key, empty);
      return { usdSubtotal: 0, breakdown: [] };
    }

    // Build a read-only client. The wallet identity is irrelevant for
    // `getMarginfiAccountsForAuthority` — same trick as marginfi-execute.ts
    // uses for prewarm. We materialise an ephemeral keypair NodeWallet.
    const config = sdk.getConfig("production");
    const ephemeralKp = Keypair.generate();
    const wallet = new common.NodeWallet(ephemeralKp);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = await sdk.MarginfiClient.fetch(config, wallet, surfpool);

    const accounts = await client.getMarginfiAccountsForAuthority(agentPubkey);
    if (!accounts || accounts.length === 0) {
      const empty: ProtocolSnapshotResult = {
        usdSubtotal: 0,
        breakdown: [],
        fetchedAt: now,
      };
      marginfiCache.set(key, empty);
      return { usdSubtotal: 0, breakdown: [] };
    }

    let usdSubtotal = 0;
    const breakdown: ProtocolPositionEntry[] = [];
    // An agent could in theory have multiple MarginfiAccounts under the
    // same authority. Sum every active deposit balance across them.
    for (const acct of accounts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const balances = (acct as any).activeBalances ?? [];
      for (const bal of balances) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bank = client.getBankByPk((bal as any).bankPk);
        if (!bank) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const quantities = (bal as any).computeQuantityUi(bank);
        const assetUi = Number(quantities.assets?.toString?.() ?? 0);
        if (!Number.isFinite(assetUi) || assetUi <= 0) continue;

        const mintStr = bank.mint.toBase58();
        const symbol =
          bank.tokenSymbol && MINT_TO_SYMBOL[mintStr]
            ? MINT_TO_SYMBOL[mintStr]
            : (MINT_TO_SYMBOL[mintStr] ?? bank.tokenSymbol);
        if (!symbol) {
          console.warn(
            `[nav-pricing] WARN: marginfi bank ${bank.address.toBase58()} mint ${mintStr} has no known symbol — contributing 0`,
          );
          continue;
        }
        const px = await readPythPriceUsd(mainnet, symbol);
        if (!Number.isFinite(px) || px <= 0) continue;
        const usd = assetUi * px;
        usdSubtotal += usd;
        breakdown.push({
          label: `MarginFi ${symbol} bank`,
          usd,
        });
      }
    }

    const snap: ProtocolSnapshotResult = {
      usdSubtotal,
      breakdown,
      fetchedAt: now,
    };
    marginfiCache.set(key, snap);
    return { usdSubtotal, breakdown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The MarginFi SDK's borsh decoder throws "Cannot read properties of
    // null (reading 'property')" on surfpool because the cloned account
    // state diverges from the SDK's expected layout (Union variant
    // discriminator missing). Until we pin the SDK or pre-clone the
    // right MarginFi accounts into surfpool startup, treat this as a
    // signal-free contribution and only log once per agent so the log
    // doesn't spam every tick.
    if (!_marginfiWarnedFor.has(key)) {
      _marginfiWarnedFor.add(key);
      console.warn(
        `[nav-pricing] marginfi snapshot for ${key} unavailable on surfpool — NAV will treat as $0 (${msg.slice(0, 120)})`,
      );
    }
    const empty: ProtocolSnapshotResult = {
      usdSubtotal: 0,
      breakdown: [],
      fetchedAt: now,
    };
    marginfiCache.set(key, empty);
    return { usdSubtotal: 0, breakdown: [] };
  }
}

// Per-process set of agent pubkeys we've already warned about for
// marginfi. Reset on daemon restart, which is fine — surfpool fork
// state may have moved by then.
const _marginfiWarnedFor: Set<string> = new Set();

// ─── Solend deposit valuation ────────────────────────────────────────────

/** Solend mainnet program (same id on the surfpool fork). */
const SOLEND_PROGRAM_ID_STR = "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo";

/** Solend "Main Pool" lending market. Mirrors `solend-execute.ts`. */
const SOLEND_MAIN_POOL_STR = "4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY";

/**
 * Per-agent cache of Solend USD subtotals. Same TTL pattern as MarginFi.
 */
const solendCache: Map<string, ProtocolSnapshotResult> = new Map();

/**
 * Per-reserve cache of decoded Solend Reserve state. Independent of the
 * agent — every agent's deposits in the same reserve share this.
 */
interface SolendReserveSnapshot {
  reserve: string;
  liquidityMint: string;
  liquidityDecimals: number;
  /** Underlying base units (available + borrowed) in the reserve. */
  totalLiquidity: bigint;
  /** Outstanding cToken supply, base units. */
  cTokenSupply: bigint;
  /** UI symbol resolvable by `readPythPriceUsd` (e.g. "USDC"). */
  symbol: string;
  fetchedAt: number;
}
const solendReserveCache: Map<string, SolendReserveSnapshot> = new Map();

// Cache the Solend SDK module (or its load failure) for the lifetime of
// the daemon process. The SDK's transitive `@metaplex-foundation/mpl-core`
// dies at module-load with "Cannot read properties of undefined
// (reading 'prototype')" because of a borsh class-extension mismatch.
// Until we pin the dep tree, the per-tick warning was firing every 30s
// for every agent — log once, then stay silent.
let _solendSdk:
  | typeof import("@solendprotocol/solend-sdk")
  | null
  | undefined = undefined;
async function loadSolendSdkForRead(): Promise<
  typeof import("@solendprotocol/solend-sdk") | null
> {
  if (_solendSdk !== undefined) return _solendSdk;
  try {
    _solendSdk = await import("@solendprotocol/solend-sdk");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[nav-pricing] solend SDK unavailable (NAV will skip Solend positions): ${msg.slice(0, 160)}`,
    );
    _solendSdk = null;
  }
  return _solendSdk;
}

/**
 * Decode a Solend reserve via the SDK and cache the underlying liquidity
 * + cToken supply needed for collateral exchange-rate math.
 */
async function readSolendReserveSnapshot(
  surfpool: Connection,
  reserveStr: string,
): Promise<SolendReserveSnapshot | null> {
  const cached = solendReserveCache.get(reserveStr);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < PROTOCOL_POSITION_TTL_MS) {
    return cached;
  }
  try {
    const sdk = await loadSolendSdkForRead();
    if (!sdk) return null;
    const reservePk = new PublicKey(reserveStr);
    const info = await surfpool.getAccountInfo(reservePk, "confirmed");
    if (!info) {
      throw new Error(`reserve ${reserveStr} missing on surfpool`);
    }
    const parsed = sdk.parseReserve(reservePk, info);
    const liq = parsed.info.liquidity;
    const liquidityMint = liq.mintPubkey.toBase58();
    const symbol = MINT_TO_SYMBOL[liquidityMint];
    if (!symbol) {
      throw new Error(
        `solend reserve ${reserveStr} has unknown liquidity mint ${liquidityMint}`,
      );
    }
    const available = BigInt(liq.availableAmount.toString());
    // borrowedAmountWads is in WAD (1e18) fractional units — collapse to
    // base units to add to availableAmount.
    const WAD = 1_000_000_000_000_000_000n;
    const borrowedWads = BigInt(liq.borrowedAmountWads.toString());
    const borrowed = borrowedWads / WAD;
    const totalLiquidity = available + borrowed;
    const cTokenSupply = BigInt(parsed.info.collateral.mintTotalSupply.toString());

    const snap: SolendReserveSnapshot = {
      reserve: reserveStr,
      liquidityMint,
      liquidityDecimals: liq.mintDecimals,
      totalLiquidity,
      cTokenSupply,
      symbol,
      fetchedAt: now,
    };
    solendReserveCache.set(reserveStr, snap);
    return snap;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[nav-pricing] WARN: solend reserve ${reserveStr} read failed: ${msg}`,
    );
    return null;
  }
}

/**
 * Read the agent's Solend obligation, sum every deposit (cToken amount ×
 * collateral exchange rate × Pyth price), and return a USD subtotal.
 *
 * Solend's obligation account is derived deterministically via
 * `createWithSeed(owner, lendingMarket.slice(0,32), programId)` — the
 * same derivation `solend-execute.ts` uses. No PDA seeds.
 *
 * SDK over hand-rolled layout: `parseObligation` and `parseReserve` are
 * stable Solend SDK exports. Hand-rolling would require tracking
 * Solend's `Obligation.dataFlat` variable-length deposits/borrows
 * encoding, which is more error-prone than a bulk SDK decode.
 */
async function loadSolendSnapshots(
  surfpool: Connection,
  mainnet: Connection,
  agentPubkey: PublicKey,
): Promise<{ usdSubtotal: number; breakdown: ProtocolPositionEntry[] }> {
  const key = agentPubkey.toBase58();
  const cached = solendCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < PROTOCOL_POSITION_TTL_MS) {
    return { usdSubtotal: cached.usdSubtotal, breakdown: cached.breakdown };
  }

  try {
    const sdk = await loadSolendSdkForRead();
    if (!sdk) {
      const empty: ProtocolSnapshotResult = {
        usdSubtotal: 0,
        breakdown: [],
        fetchedAt: now,
      };
      solendCache.set(key, empty);
      return { usdSubtotal: 0, breakdown: [] };
    }

    const programId = new PublicKey(SOLEND_PROGRAM_ID_STR);
    const lendingMarket = SOLEND_MAIN_POOL_STR;
    const obligationPk = await PublicKey.createWithSeed(
      agentPubkey,
      lendingMarket.slice(0, 32),
      programId,
    );
    const info = await surfpool.getAccountInfo(obligationPk, "confirmed");
    if (!info) {
      const empty: ProtocolSnapshotResult = {
        usdSubtotal: 0,
        breakdown: [],
        fetchedAt: now,
      };
      solendCache.set(key, empty);
      return { usdSubtotal: 0, breakdown: [] };
    }
    if (info.owner.toBase58() !== SOLEND_PROGRAM_ID_STR) {
      throw new Error(
        `obligation owner ${info.owner.toBase58()} != solend program`,
      );
    }
    const parsed = sdk.parseObligation(obligationPk, info);
    const deposits = parsed.info.deposits ?? [];

    let usdSubtotal = 0;
    const breakdown: ProtocolPositionEntry[] = [];
    for (const d of deposits) {
      const amount = BigInt(d.depositedAmount.toString());
      if (amount === 0n) continue;
      const reserveStr = d.depositReserve.toBase58();
      const snap = await readSolendReserveSnapshot(surfpool, reserveStr);
      if (!snap) {
        console.warn(
          `[nav-pricing] WARN: solend obligation has deposit in unreadable reserve ${reserveStr} — contributing 0`,
        );
        continue;
      }
      // collateral_exchange_rate = totalLiquidity / cTokenSupply.
      // Solend's convention is 1:1 when the reserve has never minted
      // cTokens (initial state) — same fallback as klend.
      let exchangeRate = 1;
      if (snap.cTokenSupply > 0n) {
        exchangeRate = Number(snap.totalLiquidity) / Number(snap.cTokenSupply);
        if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
          console.warn(
            `[nav-pricing] WARN: solend reserve ${reserveStr} non-positive exchange rate ${exchangeRate}`,
          );
          continue;
        }
      }
      const px = await readPythPriceUsd(mainnet, snap.symbol);
      if (!Number.isFinite(px) || px <= 0) continue;
      const underlyingBaseUnits = Number(amount) * exchangeRate;
      const ui = underlyingBaseUnits / Math.pow(10, snap.liquidityDecimals);
      const usd = ui * px;
      usdSubtotal += usd;
      breakdown.push({
        label: `Solend ${snap.symbol} reserve`,
        usd,
      });
    }

    const out: ProtocolSnapshotResult = {
      usdSubtotal,
      breakdown,
      fetchedAt: now,
    };
    solendCache.set(key, out);
    return { usdSubtotal, breakdown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[nav-pricing] WARN: solend snapshot for ${key} failed: ${msg}`,
    );
    const empty: ProtocolSnapshotResult = {
      usdSubtotal: 0,
      breakdown: [],
      fetchedAt: now,
    };
    solendCache.set(key, empty);
    return { usdSubtotal: 0, breakdown: [] };
  }
}

// ─── Jupiter Perps equity valuation ──────────────────────────────────────
//
// Stub: returns 0 USD until the PositionRequest decoder is wired. The
// open-perp executor (jup-perps-execute.ts) still issues real on-chain
// ixs; this just means NAV under-counts active perp positions for now.
async function computeJupiterPerpsEquityUsd(
  _surfpool: Connection,
  _authority: PublicKey,
): Promise<number> {
  // TODO(jup-perps-nav): decode the agent's PositionRequest accounts
  // (PDA = [PERP_POSITION_REQUEST_SEED, authority, custody, market]),
  // sum collateralUsd + (positionSize × mark). Until then NAV pricing
  // skips perp positions.
  return 0;
}

// ─── Zeta cross-margin equity valuation (DEAD — see Jupiter Perps stub above) ───────

interface ZetaEquitySnapshot {
  /** USD value of the cross-margin account at read time. */
  equityUsd: number;
  /** When this was read — used by the per-agent TTL cache. */
  fetchedAt: number;
}

/**
 * Per-agent cache of Zeta cross-margin equity. Keyed by agent pubkey
 * base58. Mirrors the cache pattern in `zeta-execute.ts` (one client
 * per-agent kept for the process lifetime), but here we cache the
 * computed USD figure rather than the SDK client object — we don't need
 * to keep a websocket subscription open just for NAV reads.
 */
const zetaEquityCache: Map<string, ZetaEquitySnapshot> = new Map();

/**
 * In-flight CrossClient.load promises so concurrent ticks share the
 * (slow) initial bind. Distinct from `zeta-execute.ts`'s cache because
 * the spec restricts changes to this file — we'd ideally share one cache
 * across the daemon but that requires an export from zeta-execute.ts
 * which is out of scope here. Worst case: each process has two clients
 * (one per cache), neither leaks across ticks.
 */
type ZetaCrossClient = {
  account: { balance: { toNumber(): number } } | null;
  accountAddress: PublicKey;
  updateState(fetch?: boolean, force?: boolean): Promise<number>;
  getPositionSize(asset: unknown, decimal?: boolean): number;
};
const zetaClientCache: Map<string, ZetaCrossClient> = new Map();
const zetaClientLoadPromises: Map<string, Promise<ZetaCrossClient | null>> = new Map();

/**
 * Lazy-load the Zeta SDK and bootstrap the Exchange singleton if it
 * isn't already loaded. Returns the SDK module so callers can use it
 * without re-importing. Returns `null` on any load failure (Exchange
 * already loaded counts as success — the SDK throws on double-load
 * which we treat as a no-op).
 *
 * The first call from this module is heavy (15-30s of mainnet account
 * cloning on a cold surfpool fork — see comments in zeta-execute.ts).
 * Subsequent calls hit the SDK's internal `Exchange` singleton.
 */
let zetaModuleCache: typeof import("@zetamarkets/sdk") | null = null;
let zetaExchangeBoot: Promise<boolean> | null = null;
async function ensureZetaReady(
  surfpool: Connection,
): Promise<typeof import("@zetamarkets/sdk") | null> {
  try {
    if (!zetaModuleCache) {
      zetaModuleCache = await import("@zetamarkets/sdk");
    }
    const sdk = zetaModuleCache;
    if (!zetaExchangeBoot) {
      zetaExchangeBoot = (async () => {
        try {
          // If zeta-execute.ts has already booted Exchange in this process
          // the SDK's internal singleton is good — we just check via a
          // cheap getter that throws if not loaded.
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          sdk.Exchange.assets;
          return true;
        } catch {
          // Not loaded yet — boot it ourselves with the same minimal
          // [SOL,BTC,ETH] asset set zeta-execute.ts uses.
          const loadConfig = sdk.types.defaultLoadExchangeConfig(
            sdk.Network.MAINNET,
            surfpool,
            sdk.utils.defaultCommitment(),
            0,
            true,
            undefined,
            undefined,
            undefined,
            [
              sdk.constants.Asset.SOL,
              sdk.constants.Asset.BTC,
              sdk.constants.Asset.ETH,
            ],
          );
          await sdk.Exchange.load(loadConfig);
          return true;
        }
      })();
    }
    const ok = await zetaExchangeBoot;
    return ok ? sdk : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[nav-pricing] WARN: zeta SDK init failed: ${msg}`);
    return null;
  }
}

/**
 * Minimal anchor-style read-only wallet. CrossClient.load only uses the
 * wallet for `publicKey` and (when actually placing orders) for
 * sign/signAll. NAV reads never sign, so the sign methods simply throw —
 * a defensive guard against accidentally routing a write through the
 * read-only path.
 */
function makeReadOnlyZetaWallet(pk: PublicKey): {
  publicKey: PublicKey;
  signTransaction<T>(tx: T): Promise<T>;
  signAllTransactions<T>(txs: T[]): Promise<T[]>;
} {
  return {
    publicKey: pk,
    async signTransaction<T>(_tx: T): Promise<T> {
      throw new Error("nav-pricing readonly wallet: signTransaction called");
    },
    async signAllTransactions<T>(_txs: T[]): Promise<T[]> {
      throw new Error("nav-pricing readonly wallet: signAllTransactions called");
    },
  };
}

/**
 * Get-or-load a CrossClient for `authority`. Cached for the process
 * lifetime (subscriptions stay open between ticks). Returns `null` if
 * the SDK could not be loaded or if loading the per-agent client fails.
 *
 * Why we don't share `zeta-execute.ts`'s cache: the spec restricts edits
 * to this file. Worst-case duplication is one extra subscription per
 * agent — acceptable for the chaos-sim's three-agent footprint.
 */
async function ensureZetaClientForRead(
  surfpool: Connection,
  authority: PublicKey,
): Promise<ZetaCrossClient | null> {
  const key = authority.toBase58();
  const cached = zetaClientCache.get(key);
  if (cached) return cached;
  const inflight = zetaClientLoadPromises.get(key);
  if (inflight) return inflight;

  const sdk = await ensureZetaReady(surfpool);
  if (!sdk) return null;

  const promise = (async (): Promise<ZetaCrossClient | null> => {
    try {
      const wallet = makeReadOnlyZetaWallet(authority);
      // CrossClient.load against the authority's pubkey. If the agent
      // never opened a perp position the SDK still returns a client
      // with `account === null` — we surface that as zero equity below.
      const client = (await sdk.CrossClient.load(
        surfpool,
        wallet as unknown as import("@zetamarkets/sdk").types.Wallet,
        undefined,
      )) as unknown as ZetaCrossClient;
      zetaClientCache.set(key, client);
      return client;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[nav-pricing] WARN: zeta CrossClient.load(${key}) failed: ${msg}`,
      );
      return null;
    }
  })();
  zetaClientLoadPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    zetaClientLoadPromises.delete(key);
  }
}

/**
 * Compute the agent's Zeta cross-margin equity in USD. Per spec:
 *   equity = balance + Σ(positionSize × markPrice)
 * — this is the "naive" mark-to-market that the brain reasons in. True
 * accounting equity would also subtract Σ(costOfTrades) but the spec is
 * explicit and the difference is bounded by realised-vs-unrealised PNL,
 * which for an active basis trade rounds to zero over short windows.
 *
 * Idempotent on a fresh agent: `client.account === null` returns 0. On
 * any SDK failure, logs and returns 0 so NAV stays conservative.
 */
async function computeZetaEquityUsd(
  surfpool: Connection,
  authority: PublicKey,
): Promise<number> {
  const key = authority.toBase58();
  const cached = zetaEquityCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < PROTOCOL_POSITION_TTL_MS) {
    return cached.equityUsd;
  }

  try {
    const sdk = await ensureZetaReady(surfpool);
    if (!sdk) {
      zetaEquityCache.set(key, { equityUsd: 0, fetchedAt: now });
      return 0;
    }
    const client = await ensureZetaClientForRead(surfpool, authority);
    if (!client) {
      zetaEquityCache.set(key, { equityUsd: 0, fetchedAt: now });
      return 0;
    }
    // Refresh state — `force=true` bypasses the SDK's debounce so a
    // perp_open earlier in this same tick is reflected here.
    await client.updateState(false, true);

    // No CrossMarginAccount yet → agent never deposited. Contributes 0.
    if (client.account === null) {
      zetaEquityCache.set(key, { equityUsd: 0, fetchedAt: now });
      return 0;
    }

    // Collateral balance is in 6dp USDC base units; treat USDC ≈ $1.
    const balanceUsd = client.account.balance.toNumber() / 1_000_000;

    // Mark-to-market every position the Exchange knows about. We iterate
    // `Exchange.assets` rather than walking productLedgers ourselves
    // because the SDK abstracts the (asset → ledger index) mapping.
    let positionsUsd = 0;
    for (const asset of sdk.Exchange.assets) {
      let mark: number;
      try {
        mark = sdk.Exchange.getMarkPrice(asset);
      } catch {
        continue;
      }
      if (!Number.isFinite(mark) || mark <= 0) continue;
      let size: number;
      try {
        size = client.getPositionSize(asset, true);
      } catch {
        continue;
      }
      if (!Number.isFinite(size) || size === 0) continue;
      positionsUsd += size * mark;
    }

    const equityUsd = balanceUsd + positionsUsd;
    zetaEquityCache.set(key, { equityUsd, fetchedAt: now });
    return equityUsd;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[nav-pricing] WARN: zeta equity read for ${key} failed: ${msg}`,
    );
    zetaEquityCache.set(key, { equityUsd: 0, fetchedAt: now });
    return 0;
  }
}

/**
 * Compute the agent's NAV (in bUSD lamports) by summing every value the
 * agent can withdraw on the surfpool execution chain:
 *
 *   - native SOL balance      → priced via Pyth SOL/USD
 *   - SPL token balances      → priced via Pyth (SOL/mSOL) or pinned ($1
 *                               for USDC/bUSD); cTokens (Kamino kUSDC etc.)
 *                               are valued at `cTokenBalance × reserve
 *                               exchange rate × underlying price`
 *   - Zeta cross-margin equity → `balance + Σ(positionSize × markPrice)`
 *
 * Each component is fail-soft: any read that throws contributes 0 and
 * logs a warning, so a flapping RPC or stale fork can never crash the
 * daemon's NAV-commit loop. The fallback to `STUB_PRICE_USD` covers Pyth
 * outages.
 *
 * On the first successful invocation in a process, emits a one-shot
 * `[nav-pricing] …` banner enumerating every input source so operators
 * can sanity-check the breakdown.
 *
 * MarginFi + Solend lend balances are valued via `loadMarginfiSnapshots`
 * and `loadSolendSnapshots` (same per-agent breakdown shape as Kamino).
 */
export async function computeNavFromSurfpoolBalances(
  surfpool: Connection,
  mainnetOrAuthority: Connection | PublicKey,
  authorityArg?: PublicKey,
): Promise<bigint> {
  // Backward-compat overload: legacy callers pass `(surfpool, authority)`
  // and expect prices to come from the same connection. New callers pass
  // `(surfpool, mainnet, authority)` so Pyth reads can target a separate
  // live mainnet RPC while balance reads still hit the surfpool fork.
  let mainnet: Connection;
  let authority: PublicKey;
  if (mainnetOrAuthority instanceof PublicKey) {
    mainnet = surfpool;
    authority = mainnetOrAuthority;
  } else {
    mainnet = mainnetOrAuthority;
    if (!authorityArg) {
      throw new Error(
        "computeNavFromSurfpoolBalances: authority is required when a mainnet Connection is supplied",
      );
    }
    authority = authorityArg;
  }
  const breakdown = await computeNavBreakdown(surfpool, mainnet, authority);
  return breakdown.navLamports;
}

/**
 * Per-component NAV breakdown returned by `computeNavBreakdown`. All
 * `*_usd_micros` fields are in micro-USD (1e6 scale) so they fit alongside
 * NAV lamports in a bigint without losing sub-cent precision.
 *
 * `perpsUsdMicros` represents Jupiter Perps equity. The internal pipeline
 * still uses the legacy `zetaUsd` variable name (a hold-over from the Zeta
 * integration we retired); the breakdown surface renames it.
 */
export interface NavBreakdown {
  navLamports: bigint;
  baseUsdMicros: bigint;
  kaminoUsdMicros: bigint;
  solendUsdMicros: bigint;
  perpsUsdMicros: bigint;
}

/**
 * Identical math to `computeNavFromSurfpoolBalances`, but exposes the
 * per-component USD subtotals used by the daemon's `nav-pricing` banner so
 * callers can persist them for charting. The original function is kept as a
 * thin wrapper around this one to preserve every existing call site (which
 * only consumes the rolled-up `navLamports`).
 */
export async function computeNavBreakdown(
  surfpool: Connection,
  mainnet: Connection,
  authority: PublicKey,
): Promise<NavBreakdown> {
  // Resolve prices once per invocation; the cache will keep them stable
  // across the surrounding tick window (~60s). Pyth reads target `mainnet`
  // (live RPC) so prices stay fresh — the surfpool fork's Pyth accounts
  // are frozen at fork-creation time and would mis-price NAV by 20%+ on
  // any volatile day.
  let prices: Record<string, number>;
  try {
    prices = await loadPricesForNav(mainnet);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[nav-pricing] WARN: price load failed (${msg}) — using STUB_PRICE_USD`,
    );
    prices = { ...STUB_PRICE_USD };
  }

  // Pull the Kamino reserve snapshots in parallel with Pyth — same TTL
  // window so both are warm by the time we need them. We get back two
  // indices: by cToken mint (for the SPL-token-account loop) and by
  // reserve PDA (for the obligation loop).
  const kamino = await loadKaminoSnapshots(surfpool).catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[nav-pricing] WARN: kamino reserve fan-out failed (${msg}) — kamino contributes 0`,
      );
      return {
        byCToken: new Map<string, KaminoReserveSnapshot>(),
        byReserve: new Map<string, KaminoReserveSnapshot>(),
      };
    },
  );

  // Track per-component USD subtotals so we can surface them in the
  // banner. Native SOL + non-cToken SPL balances are lumped under
  // `baseUsd`; cTokens roll up to `kaminoUsd`; MarginFi/Solend deposits
  // and Zeta equity each get their own line.
  let baseUsd = 0;
  let kaminoUsd = 0;
  let marginfiUsd = 0;
  let solendUsd = 0;
  let zetaUsd = 0;

  // SOL balance is always observable.
  try {
    const lamports = await surfpool.getBalance(authority, "confirmed");
    baseUsd += (lamports / 1e9) * (prices.SOL ?? STUB_PRICE_USD.SOL);
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
      const ui = Number(parsed.tokenAmount?.uiAmount ?? 0);
      if (!Number.isFinite(ui) || ui === 0) continue;

      // 1. Kamino cToken? (mint matches a known reserve's collateral mint)
      //    For the chaos-sim's main-market USDC reserve this never hits
      //    because vanilla obligations don't mint redeemable cTokens —
      //    we still wire it up for any reserve that DOES (e.g. some
      //    Multiply / Leverage products).
      const mint = String(parsed.mint ?? "");
      const reserveSnap = mint ? kamino.byCToken.get(mint) : undefined;
      if (reserveSnap) {
        const underlyingPx =
          prices[reserveSnap.underlyingSymbol] ??
          STUB_PRICE_USD[reserveSnap.underlyingSymbol] ??
          0;
        if (underlyingPx > 0) {
          // cToken UI balance × exchange rate = underlying UI balance.
          // (cToken and underlying share decimals, so the ratio is unit-less.)
          kaminoUsd += ui * reserveSnap.exchangeRate * underlyingPx;
        }
        continue;
      }

      // 2. Otherwise the existing symbol-based path. parsed.tokenSymbol
      //    only populates for well-known mints; for everything else we
      //    fall back to mint and miss (contributes 0).
      const symbol = parsed.tokenSymbol || parsed.mint;
      const px = prices[symbol] ?? STUB_PRICE_USD[symbol] ?? 0;
      if (px > 0) baseUsd += ui * px;
    }
  } catch {
    // Token-account enumeration optional — ignore failures.
  }

  // 2b. Kamino main-market vanilla obligations. Agents who deposited
  //     USDC via `kamino-execute.ts` end up with an Obligation PDA whose
  //     `deposits[]` array references the reserve directly — no cToken
  //     SPL balance is minted, so the path above wouldn't catch them.
  //     Valued via `marketValueSf` from the klend SDK — `reservesByPda`
  //     and `prices` are no longer needed because Kamino's program writes
  //     the USD value directly into the obligation account.
  try {
    const obligationUsd = await computeKaminoObligationUsd(
      surfpool,
      authority,
    );
    kaminoUsd += obligationUsd;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[nav-pricing] WARN: kamino obligation outer catch: ${msg}`,
    );
  }

  // 3. MarginFi deposits — RETIRED. The SDK can't decode current
  //    mainnet OracleSetup variants, and we removed marginfi from the
  //    brain's allowed protocols, so no agent can have a position. Skip
  //    the SDK read entirely — saves ~5-10s per tick on cold caches.
  let marginfiBreakdown: ProtocolPositionEntry[] = [];
  marginfiUsd = 0;

  // 4. Solend deposits. Per-agent obligation read via SDK; returns 0
  //    when the agent has no obligation.
  let solendBreakdown: ProtocolPositionEntry[] = [];
  try {
    const sol = await loadSolendSnapshots(surfpool, mainnet, authority);
    solendUsd = sol.usdSubtotal;
    solendBreakdown = sol.breakdown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[nav-pricing] WARN: solend outer catch: ${msg}`);
    solendUsd = 0;
  }

  // 5. Jupiter Perps equity. Stubbed to 0 until the PositionRequest
  //    account decoder lands — see jup-perps-execute.ts for the open
  //    path. perp_open ix's still broadcast as real on-chain txs, but
  //    until we read PositionRequest collateral here, NAV under-prices
  //    open perps. Fine for hackathon scope: brain reasons in observed
  //    rates, not committed equity.
  try {
    zetaUsd = await computeJupiterPerpsEquityUsd(surfpool, authority);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[nav-pricing] WARN: jupiter-perps equity outer catch: ${msg}`);
    zetaUsd = 0;
  }

  // Emit the one-shot banner now that we have every subtotal. Per-bank
  // / per-reserve breakdowns log here too so the brain's STATE_JSON can
  // see exactly how MarginFi + Solend deposits were valued.
  emitNavPricingBanner(prices, kaminoUsd, marginfiUsd, solendUsd, zetaUsd);
  for (const entry of marginfiBreakdown) {
    console.log(`[nav-pricing] ${entry.label}: ${fmtUsd(entry.usd)}`);
  }
  for (const entry of solendBreakdown) {
    console.log(`[nav-pricing] ${entry.label}: ${fmtUsd(entry.usd)}`);
  }

  const totalUsd = baseUsd + kaminoUsd + marginfiUsd + solendUsd + zetaUsd;

  // Convert USD → bUSD lamports (6 decimals). Clamp to non-negative —
  // negative Zeta equity (a blown-out short, say) could in theory drag
  // the agent's NAV below zero, but the on-chain `commit_nav` accepts
  // u64 only.
  const navLamports = BigInt(Math.max(0, Math.round(totalUsd * 10 ** BUSD_DECIMALS)));

  // Surface micro-USD (1e6) component subtotals so callers can persist
  // them for charting. We round to the nearest unit; sub-micro-USD jitter
  // is well below display precision. Values are clamped to non-negative
  // for the same reason as `navLamports` — `bigint` here is unsigned in
  // intent even though the type permits negatives.
  const toMicros = (usd: number): bigint =>
    BigInt(Math.max(0, Math.round(usd * 1_000_000)));

  return {
    navLamports,
    // `baseUsd` rolls up native SOL + non-cToken SPL balances. MarginFi
    // is retired (always 0), so we fold its zero subtotal into base
    // rather than minting a new column for a dead protocol.
    baseUsdMicros: toMicros(baseUsd + marginfiUsd),
    kaminoUsdMicros: toMicros(kaminoUsd),
    solendUsdMicros: toMicros(solendUsd),
    perpsUsdMicros: toMicros(zetaUsd),
  };
}

// Re-export the PDA helper so callers in init-vaults / shared-tick can
// import everything from one module.
export { bundieVaultPda };
// `SystemProgram` import kept available for downstream consumers wiring
// `init_vault` from this same file family.
export { SystemProgram };
