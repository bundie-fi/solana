#!/usr/bin/env node
/**
 * seed-busd-onchain-market.mjs — seed ONE on-chain-resolved prediction market
 * collateralized in bUSD, then push a handful of YES/NO trades so the live
 * backend reports a real price (!= 0.5) and depth_usd > 0.
 *
 * WHY THIS EXISTS
 *   The demo event markets created by create-demo-events.ts are collateralized
 *   in devnet USDC-Dev (4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU) which we
 *   cannot mint. The in-app faucet mints bUSD (42LaRiwvuxfQv5rfHMmk9wU3K2nRxMGzgukNJztydpiB)
 *   instead. This script unifies on bUSD by creating one
 *   `onchain_tvl_rolling_window` market (event_id = kamino_main_tvl_drop_50m_24h_90d,
 *   MARKET_KIND_PROTOCOL_TVL_DROP = 8) backed by bUSD, then buys YES/NO shares.
 *
 *   The market's collateral_mint only affects which token the vault holds and
 *   which buyer ATA is debited — the backend's /v1/events and /v1/event-price
 *   compute price from (yes_shares, no_shares, liquidity_param) and depth from
 *   total_volume, both read straight off the Market account. So changing the
 *   collateral mint from USDC to bUSD is sufficient; price/depth are unaffected.
 *
 * KEY BACKEND-DISCOVERY CONSTRAINT (read before changing MARKET_ID_PREFIX)
 *   The backend finds a market for an event_id by scanning market_ids
 *   [MARKET_ID_PREFIX .. MARKET_ID_PREFIX+searchRange) and returning the FIRST
 *   live PDA (packages/backend/src/v1/onchain.ts:findMarketForEvent,
 *   startId = process.env.MARKET_ID_PREFIX ?? 100, searchRange = 50).
 *   The deployed backend does NOT set MARKET_ID_PREFIX, so it scans [100, 150).
 *   The new market's market_id MUST land inside [100, 150) for the backend to
 *   discover it. We default MARKET_ID_PREFIX to 105 (clean as of investigation;
 *   the kamino event only had live ids 202/302/310, all OUTSIDE the backend's
 *   default scan window — i.e. the backend currently finds NO kamino market and
 *   serves the 0.5 stub). The script probes the PDA first and aborts on
 *   collision, printing a safe next value (keep it < 150!).
 *
 * WHAT IT DOES
 *   1. Loads the creator/buyer signer from ANCHOR_WALLET (~/.config/solana/id.json).
 *   2. Loads the bUSD mint-authority keypair from busd-mint.json (.secret) — this
 *      is the keypair that created the mint, so it IS the mint authority.
 *   3. Mints bUSD to the creator (for the initial subsidy) and to a buyer wallet
 *      (defaults to the same wallet) — creating ATAs as needed.
 *   4. Calls create_event for kamino_main_tvl_drop_50m_24h_90d with
 *      collateral_mint = bUSD and the SAME ProtocolTvlDrop payload + config_hash
 *      as create-demo-events.ts (so the off-chain resolver config_hash matches).
 *   5. Buys a few YES and NO shares via buy_event_shares to move price + depth.
 *
 * ENV VARS
 *   ANCHOR_WALLET            (required) path to creator/buyer keypair json
 *                            e.g. ~/.config/solana/id.json (pubkey
 *                            4rebicw8ngU5HKxRmdNLrij9VqKDzi5gSFU7FJcJ3yxG)
 *   ANCHOR_PROVIDER_URL      (optional) RPC url. Defaults to the rpcfast devnet
 *                            endpoint from packages/web/.env.local. Falls back
 *                            to https://api.devnet.solana.com if unset.
 *   BUSD_MINT_JSON           (optional) path to busd-mint.json. Defaults to repo
 *                            root ../../busd-mint.json relative to this script.
 *   MARKET_ID_PREFIX         (optional) market_id to use. Default 105. MUST be
 *                            in [100, 150) for the deployed backend to find it.
 *   BUNDIE_RESOLVER_PUBKEY   (optional) resolver signer recorded in the market.
 *                            Defaults to the creator pubkey.
 *   INITIAL_SUBSIDY_BUSD     (optional) initial subsidy in bUSD. Default 100.
 *   FEE_BPS                  (optional) market fee bps. Default 100 (1%).
 *   BUY_BUSD_PER_TRADE       (optional) bUSD spent per buy trade. Default 5.
 *   BUYER_WALLET             (optional) path to a separate buyer keypair json.
 *                            Defaults to ANCHOR_WALLET (creator == buyer).
 *   DRY_RUN                  (optional) "true" = print plan, do NOT submit any tx.
 *
 * RUN
 *   export ANCHOR_WALLET=~/.config/solana/id.json
 *   # dry run first (no tx submitted):
 *   DRY_RUN=true pnpm tsx packages/programs/scripts/seed-busd-onchain-market.mjs
 *   # then for real:
 *   pnpm tsx packages/programs/scripts/seed-busd-onchain-market.mjs
 *
 *   (node also works: `node packages/programs/scripts/seed-busd-onchain-market.mjs`
 *    — this file is plain .mjs, no TS. tsx is fine too.)
 *
 * NOTE: This is a DRAFT for review. It does NOT broadcast on import — run it
 * explicitly. Default is a live run unless DRY_RUN=true. Review then run.
 */

// `@coral-xyz/anchor` is CJS; named-importing BN/AnchorProvider/etc. under raw
// ESM (`node foo.mjs`) throws "Named export 'BN' not found". Pull them off the
// default export — the same trick event-price-onchain.ts and buy-shares-kamino.mjs use.
// (Running via `pnpm tsx` would tolerate named imports, but this keeps `node` working too.)
import anchorPkg from "@coral-xyz/anchor";
const { AnchorProvider, BN, Program, Wallet } = anchorPkg;
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import idlJson from "../target/idl/prediction_market.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ───────────────────────────── constants ──────────────────────────────

const EVENT_ID = "kamino_main_tvl_drop_50m_24h_90d";

// MARKET_KIND from programs/prediction-market/src/state/market.rs (mirrors
// create-demo-events.ts). ProtocolTvlDrop == 8.
const MARKET_KIND_PROTOCOL_TVL_DROP = 8;

// Default RPC — the rpcfast devnet endpoint from packages/web/.env.local. The
// public api.devnet RPC frequently rate-limits getMultipleAccountsInfo, so the
// rpcfast key is preferred. Override with ANCHOR_PROVIDER_URL.
const DEFAULT_RPC =
  "https://sol-devnet-rpc.rpcfast.com?api_key=0QW9Zx1DgikISDpXoZrfjohjDWs0EYKegoxyq7lc1PfI3tMPvCNOaYPGjlBSoumr";

const MARKET_ID_PREFIX = Number(process.env.MARKET_ID_PREFIX ?? "105");
const INITIAL_SUBSIDY_BUSD = Number(process.env.INITIAL_SUBSIDY_BUSD ?? "100");
const FEE_BPS = Number(process.env.FEE_BPS ?? "100"); // 1%
const BUY_BUSD_PER_TRADE = Number(process.env.BUY_BUSD_PER_TRADE ?? "5");
const DRY_RUN = process.env.DRY_RUN === "true";

// PROD backend sets MARKET_ID_PREFIX=300, so it scans [300, 350). The existing
// (USDC, untraded) kamino market is at 302; seeding below it (300/301) makes our
// bUSD market the FIRST live hit so findMarketForEvent returns it after a restart.
const BACKEND_SCAN_START = 300;
const BACKEND_SCAN_END = 350; // exclusive (startId + searchRange=50)

// ───────────────────────────── helpers ──────────────────────────────

function loadKeypair(path) {
  const secret = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

function eventIdHash(eventId) {
  return createHash("sha256").update(eventId).digest();
}

/**
 * config_hash MUST match exactly what create-demo-events.ts pins on-chain so
 * the off-chain resolver (which compares its sources.json hash to the
 * ResolverAuthority pin) accepts this market. It hashes the resolver_config
 * JSON object for this event, taken verbatim from sources.json.
 */
function loadResolverConfigHash() {
  const path = join(__dirname, "resolvers", "sources.json");
  const registry = JSON.parse(readFileSync(path, "utf-8"));
  const ev = registry.events.find((e) => e.event_id === EVENT_ID);
  if (!ev) throw new Error(`event ${EVENT_ID} not found in sources.json`);
  return {
    config: ev.resolver_config,
    hash: createHash("sha256")
      .update(JSON.stringify(ev.resolver_config))
      .digest(),
    description: ev.description,
  };
}

/**
 * Encode the 64-byte ProtocolTvlDrop payload, identical layout to
 * create-demo-events.ts encodePayload() (MARKET_KIND_PROTOCOL_TVL_DROP branch).
 *   [0..8]   drop_threshold (micro-dollars)
 *   [8..16]  rolling_window_seconds
 *   [16..24] window_end_unix_ts (now + outcome_window_seconds)
 *   [32..64] tvl_source_pubkey (placeholder: 0x01-filled, must be != default)
 */
function encodeTvlPayload(cfg) {
  const payload = Buffer.alloc(64);
  const dropThreshold = BigInt(
    Math.round(Number(cfg.drop_threshold_usd) * 1e6),
  );
  const rollingWindow = Number(cfg.rolling_window_seconds);
  const windowEnd =
    Math.floor(Date.now() / 1000) + Number(cfg.outcome_window_seconds);
  payload.writeBigUInt64LE(dropThreshold, 0);
  payload.writeBigUInt64LE(BigInt(rollingWindow), 8);
  payload.writeBigUInt64LE(BigInt(windowEnd), 16);
  Buffer.alloc(32, 1).copy(payload, 32); // non-default tvl_source placeholder
  return payload;
}

function deriveMarketPda(programId, eventIdHashBuf, marketId) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("event_market"),
      eventIdHashBuf,
      new BN(marketId).toArrayLike(Buffer, "le", 8),
    ],
    programId,
  );
  return pda;
}

/** Ensure an ATA exists; returns ix to create it or null if already present. */
async function ensureAtaIx(connection, mint, owner, payer) {
  const ata = await getAssociatedTokenAddress(mint, owner);
  const info = await connection.getAccountInfo(ata);
  if (info) return { ata, ix: null };
  return {
    ata,
    ix: createAssociatedTokenAccountInstruction(payer, ata, owner, mint),
  };
}

// ───────────────────────────── main ──────────────────────────────

async function main() {
  // ── signers + connection ───────────────────────────────────────────
  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) {
    console.error("ANCHOR_WALLET env var is required (path to keypair json)");
    process.exit(1);
  }
  const creator = loadKeypair(walletPath);
  const buyer = process.env.BUYER_WALLET
    ? loadKeypair(process.env.BUYER_WALLET)
    : creator;

  const busdJsonPath =
    process.env.BUSD_MINT_JSON ?? join(__dirname, "..", "..", "..", "busd-mint.json");
  const busdMeta = JSON.parse(readFileSync(busdJsonPath, "utf-8"));
  const BUSD_MINT = new PublicKey(busdMeta.mint);
  const busdAuthority = Keypair.fromSecretKey(new Uint8Array(busdMeta.secret));
  // Sanity: the .secret keypair must be the recorded mint authority.
  if (busdAuthority.publicKey.toBase58() !== busdMeta.authority) {
    console.error(
      `busd-mint.json secret (${busdAuthority.publicKey.toBase58()}) != authority (${busdMeta.authority})`,
    );
    process.exit(1);
  }

  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? DEFAULT_RPC;
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(creator), {
    commitment: "confirmed",
  });
  const program = new Program(idlJson, provider);

  const resolver = new PublicKey(
    process.env.BUNDIE_RESOLVER_PUBKEY ?? creator.publicKey.toBase58(),
  );

  // ── derive everything for the market ───────────────────────────────
  const eventIdHashBuf = eventIdHash(EVENT_ID);
  const marketId = MARKET_ID_PREFIX;
  const marketPda = deriveMarketPda(program.programId, eventIdHashBuf, marketId);
  const { config: resolverConfig, hash: configHashBuf, description } =
    loadResolverConfigHash();
  const payload = encodeTvlPayload(resolverConfig);

  const [resolverAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("resolver_auth"), marketPda.toBuffer()],
    program.programId,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPda.toBuffer()],
    program.programId,
  );
  const [yesMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), marketPda.toBuffer()],
    program.programId,
  );
  const [noMintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), marketPda.toBuffer()],
    program.programId,
  );

  console.log("=== seed-busd-onchain-market ===");
  console.log(`RPC:           ${rpcUrl}`);
  console.log(`Creator:       ${creator.publicKey.toBase58()}`);
  console.log(`Buyer:         ${buyer.publicKey.toBase58()}`);
  console.log(`Resolver:      ${resolver.toBase58()}`);
  console.log(`bUSD mint:     ${BUSD_MINT.toBase58()}`);
  console.log(`bUSD authority:${busdAuthority.publicKey.toBase58()}`);
  console.log(`Event:         ${EVENT_ID}`);
  console.log(`market_id:     ${marketId}`);
  console.log(`market PDA:    ${marketPda.toBase58()}`);
  console.log(`vault PDA:     ${vaultPda.toBase58()}`);
  console.log(`Subsidy:       ${INITIAL_SUBSIDY_BUSD} bUSD`);
  console.log(`Buy/trade:     ${BUY_BUSD_PER_TRADE} bUSD`);
  console.log(`Mode:          ${DRY_RUN ? "DRY RUN (no tx)" : "LIVE"}`);
  console.log("");

  // ── backend-range guard ─────────────────────────────────────────────
  if (marketId < BACKEND_SCAN_START || marketId >= BACKEND_SCAN_END) {
    console.error(
      `✗ market_id ${marketId} is OUTSIDE the backend default scan window ` +
        `[${BACKEND_SCAN_START}, ${BACKEND_SCAN_END}). The deployed backend ` +
        `would NOT discover this market. Pick a MARKET_ID_PREFIX in range, or ` +
        `set MARKET_ID_PREFIX on the backend too.`,
    );
    process.exit(1);
  }

  // ── collision pre-check ─────────────────────────────────────────────
  const existing = await connection.getAccountInfo(marketPda);
  if (existing) {
    // Find smallest safe id still inside the backend scan window.
    let next = null;
    for (let id = marketId + 1; id < BACKEND_SCAN_END; id++) {
      const p = deriveMarketPda(program.programId, eventIdHashBuf, id);
      // eslint-disable-next-line no-await-in-loop
      const info = await connection.getAccountInfo(p);
      if (!info) {
        next = id;
        break;
      }
    }
    console.error(
      `✗ market_id ${marketId} already exists on-chain (${marketPda.toBase58()}).`,
    );
    if (next !== null) {
      console.error(
        `  → Re-run with MARKET_ID_PREFIX=${next} (still inside backend scan window).`,
      );
    } else {
      console.error(
        `  → No free slot left in [${marketId + 1}, ${BACKEND_SCAN_END}). ` +
          `Either reuse the existing market (already discoverable) or bump the ` +
          `backend's MARKET_ID_PREFIX.`,
      );
    }
    process.exit(1);
  }

  // ── ATAs + mint bUSD ────────────────────────────────────────────────
  const creatorBusdAta = getAssociatedTokenAddressSync(
    BUSD_MINT,
    creator.publicKey,
  );
  const buyerBusdAta = getAssociatedTokenAddressSync(
    BUSD_MINT,
    buyer.publicKey,
  );

  // Mint enough for the subsidy + all planned buys (+ headroom for fees).
  const numBuys = 4; // 2 YES + 2 NO below
  const buyTotalBusd = BUY_BUSD_PER_TRADE * numBuys * 1.1; // +10% for LMSR fee
  const creatorMintBusd = INITIAL_SUBSIDY_BUSD + 1; // subsidy + a little slack
  const buyerMintBusd = buyTotalBusd;

  if (DRY_RUN) {
    console.log("[DRY RUN] Would mint bUSD:");
    console.log(`  → creator ${creatorBusdAta.toBase58()}: ${creatorMintBusd} bUSD`);
    console.log(`  → buyer   ${buyerBusdAta.toBase58()}: ${buyerMintBusd} bUSD`);
    console.log("[DRY RUN] Would create_event then buy 2x YES + 2x NO.");
    console.log("[DRY RUN] No transactions submitted.");
    return;
  }

  // (a) mint bUSD to creator + buyer. Mint authority signs.
  {
    const ixs = [];
    const c = await ensureAtaIx(connection, BUSD_MINT, creator.publicKey, creator.publicKey);
    if (c.ix) ixs.push(c.ix);
    // Only create the buyer ATA when it's a distinct wallet. When buyer == creator
    // the ATA is identical, and a second create-ATA ix in the same tx fails with
    // "Provided owner is not allowed".
    if (buyer.publicKey.toBase58() !== creator.publicKey.toBase58()) {
      const b = await ensureAtaIx(connection, BUSD_MINT, buyer.publicKey, creator.publicKey);
      if (b.ix) ixs.push(b.ix);
    }
    ixs.push(
      createMintToInstruction(
        BUSD_MINT,
        creatorBusdAta,
        busdAuthority.publicKey,
        BigInt(Math.round(creatorMintBusd * 1e6)),
      ),
    );
    if (buyer.publicKey.toBase58() !== creator.publicKey.toBase58()) {
      ixs.push(
        createMintToInstruction(
          BUSD_MINT,
          buyerBusdAta,
          busdAuthority.publicKey,
          BigInt(Math.round(buyerMintBusd * 1e6)),
        ),
      );
    } else {
      // creator == buyer: fold the buyer allowance into the single ATA.
      ixs[ixs.length - 1] = createMintToInstruction(
        BUSD_MINT,
        creatorBusdAta,
        busdAuthority.publicKey,
        BigInt(Math.round((creatorMintBusd + buyerMintBusd) * 1e6)),
      );
    }
    const tx = new Transaction().add(...ixs);
    // payer = creator (fees), signer = creator + busdAuthority (mintTo authority)
    const sig = await sendAndConfirmTransaction(connection, tx, [
      creator,
      busdAuthority,
    ]);
    console.log(`✓ minted bUSD: ${sig}`);
  }

  // (b) create_event collateralized in bUSD.
  {
    const initialSubsidy = new BN(Math.round(INITIAL_SUBSIDY_BUSD * 1e6));
    const currentSlot = await connection.getSlot();
    const resolutionSlot = new BN(currentSlot + 2 * 24 * 60 * 60 * 2.5); // ~2 days

    const sig = await program.methods
      .createEvent(
        description.slice(0, 128),
        new BN(marketId),
        Array.from(eventIdHashBuf),
        MARKET_KIND_PROTOCOL_TVL_DROP,
        Array.from(payload),
        resolutionSlot,
        initialSubsidy,
        FEE_BPS,
        resolver,
        Array.from(configHashBuf),
      )
      .accounts({
        creator: creator.publicKey,
        market: marketPda,
        resolverAuthority: resolverAuthorityPda,
        collateralMint: BUSD_MINT, // ← bUSD, not DEVNET_USDC
        vault: vaultPda,
        yesMint: yesMintPda,
        noMint: noMintPda,
        subsidySource: creatorBusdAta, // creator's bUSD ATA holds the subsidy
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    console.log(`✓ create_event (bUSD): ${sig}`);
    console.log(`  market: ${marketPda.toBase58()}`);
  }

  // (c) buy a few YES + NO shares to move price + depth.
  //   amount is in YES/NO share base units (6 dp). LMSR cost is paid in bUSD
  //   from buyer_collateral; the buy fails if the ATA can't cover cost+fee.
  const buyerYesAta = getAssociatedTokenAddressSync(yesMintPda, buyer.publicKey);
  const buyerNoAta = getAssociatedTokenAddressSync(noMintPda, buyer.publicKey);

  // Buy unequal YES vs NO so price diverges from 0.5. Share amount uses 6 dp;
  // a few "shares" worth keeps LMSR cost well under BUY_BUSD_PER_TRADE.
  const trades = [
    { outcome: { yes: {} }, label: "YES", shares: 3 },
    { outcome: { yes: {} }, label: "YES", shares: 3 },
    { outcome: { no: {} }, label: "NO", shares: 1 },
    { outcome: { no: {} }, label: "NO", shares: 1 },
  ];

  for (const t of trades) {
    const amount = new BN(Math.round(t.shares * 1e6));
    const sig = await program.methods
      .buyEventShares(Array.from(eventIdHashBuf), t.outcome, amount)
      .accounts({
        buyer: buyer.publicKey,
        market: marketPda,
        yesMint: yesMintPda,
        noMint: noMintPda,
        vault: vaultPda,
        buyerCollateral: buyerBusdAta,
        buyerYesAta,
        buyerNoAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
    console.log(`✓ buy ${t.label} ${t.shares} shares: ${sig}`);
  }

  console.log("");
  console.log("Done. Verify via the live backend:");
  console.log(
    `  curl 'https://backend.solana.bundie.fi/v1/event-price?id=${EVENT_ID}'`,
  );
  console.log(`  curl 'https://backend.solana.bundie.fi/v1/events'`);
  console.log(
    "Expect price != 0.5 and depth_usd > 0 once the backend's 30s market cache refreshes.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
