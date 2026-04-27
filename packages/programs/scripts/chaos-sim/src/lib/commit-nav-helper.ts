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
 * Fetch a USD price for `symbol` from the Pyth feed account on surfpool,
 * caching successful reads for `PRICE_CACHE_TTL_MS`. On any failure
 * (account missing, decode error, confidence too wide), logs a warning
 * and returns the `STUB_PRICE_USD` fallback so the daemon keeps moving.
 *
 * The cache is keyed by symbol so all callers share a single price per
 * tick window; this keeps the digest deterministic across the multiple
 * NAV computations performed within one second.
 */
async function readPythPriceUsd(
  surfpool: Connection,
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
    const info = await surfpool.getAccountInfo(new PublicKey(feedAddr), "confirmed");
    if (!info) {
      throw new Error(`feed account ${feedAddr} missing on surfpool`);
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
 * Resolve every price the NAV computation needs. Emits a one-time banner
 * the first time it returns a complete price set so the daemon's stdout
 * shows where each NAV figure is coming from.
 */
async function loadPricesForNav(
  surfpool: Connection,
): Promise<Record<string, number>> {
  const symbols = ["SOL", "mSOL", "USDC", "bUSD"];
  const entries = await Promise.all(
    symbols.map(async (s) => [s, await readPythPriceUsd(surfpool, s)] as const),
  );
  const prices = Object.fromEntries(entries);

  if (!priceLogEmitted) {
    priceLogEmitted = true;
    const fmt = (n: number) =>
      `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    const sources = symbols
      .map((s) => `${s}=${fmt(prices[s])}(${priceCache.get(s)?.source ?? "?"})`)
      .join(" ");
    console.log(`[nav-pricing] ${sources}`);
  }

  return prices;
}

/**
 * Compute the agent's NAV (in bUSD lamports) by summing token balances on
 * the surfpool execution chain priced at live Pyth feeds. Falls back to
 * `STUB_PRICE_USD` for any symbol whose Pyth read fails so the daemon
 * keeps producing commits while the operator investigates.
 *
 * Note: this only prices the SOL + bUSD/USDC + LST graph. Kamino kToken
 * holdings and Zeta cross-margin equity are added by parallel work in
 * Phase Q (see HANDOFF-2026-04-27.md → "Phase Q").
 */
export async function computeNavFromSurfpoolBalances(
  surfpool: Connection,
  authority: PublicKey,
): Promise<bigint> {
  // Resolve prices once per invocation; the cache will keep them stable
  // across the surrounding tick window (~60s).
  let prices: Record<string, number>;
  try {
    prices = await loadPricesForNav(surfpool);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[nav-pricing] WARN: price load failed (${msg}) — using STUB_PRICE_USD`,
    );
    prices = { ...STUB_PRICE_USD };
  }

  // SOL balance is always observable.
  let totalUsd = 0;
  try {
    const lamports = await surfpool.getBalance(authority, "confirmed");
    totalUsd += (lamports / 1e9) * (prices.SOL ?? STUB_PRICE_USD.SOL);
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
      const px = prices[symbol] ?? STUB_PRICE_USD[symbol] ?? 0;
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
