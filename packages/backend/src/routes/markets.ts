import { Hono } from "hono";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { buildPredictBuy } from "../lib/builders.js";
import { dbQuery, getPool } from "../lib/db.js";
import {
  connection,
  DEVNET_USDC,
  getAssociatedTokenAddress,
  getPredictionProgram,
  noMintPDA,
  yesMintPDA,
} from "../lib/solana.js";

export const markets = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PredictionMarket {
  address: string;
  strategy: string;
  strategyName: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  totalVolume: number;
  status: "open" | "resolved" | "expired";
  timeRemaining: string;
}

interface MarketDetail extends PredictionMarket {
  lsLmsr: {
    b: number;
    qYes: number;
    qNo: number;
    costFunction: number;
  };
  resolutionCriteria: string;
  expiryTimestamp: number;
  createdAt: number;
}

interface ResolveResponse {
  outcome: "yes" | "no";
  navAtResolution: number;
  threshold: number;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_MARKETS: MarketDetail[] = [
  {
    address: "Mkt1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3y",
    strategy: "StrT1kQ7v9bYfqnGv4oKj8RXwJ4YtRdGJc9AzLkWfPm",
    strategyName: "SOL Momentum Alpha",
    question: "Will SOL Momentum Alpha exceed 20% APY by end of Q2 2026?",
    yesPrice: 0.62,
    noPrice: 0.38,
    totalVolume: 184_500,
    status: "open",
    timeRemaining: "18d 4h",
    lsLmsr: { b: 100, qYes: 620, qNo: 380, costFunction: 714.2 },
    resolutionCriteria: "Strategy NAV-based APY >= 20% at expiry block",
    expiryTimestamp: 1751328000,
    createdAt: 1748736000,
  },
  {
    address: "Mkt2bC3dE4fG5hI6jK7lM8nO9pQ0rS1tU2vW3xY4z",
    strategy: "StrT2kQ8w0cYgGv5pLkj9SXxK5ZuSeFHkd0BaMmXgQn",
    strategyName: "USDC Stable Yield",
    question: "Will USDC Stable Yield maintain >8% APY for 30 consecutive days?",
    yesPrice: 0.81,
    noPrice: 0.19,
    totalVolume: 312_000,
    status: "open",
    timeRemaining: "6d 12h",
    lsLmsr: { b: 150, qYes: 1215, qNo: 285, costFunction: 1023.7 },
    resolutionCriteria: "Rolling 30d APY stays above 8% at each daily checkpoint",
    expiryTimestamp: 1749312000,
    createdAt: 1746720000,
  },
  {
    address: "Mkt3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5a",
    strategy: "StrT4kR0y2eAiIv7rNml1UZzM7BwUgHJmf2DcOoZiSp",
    strategyName: "Leveraged SOL 2x",
    question: "Will Leveraged SOL 2x outperform spot SOL by >10% this month?",
    yesPrice: 0.44,
    noPrice: 0.56,
    totalVolume: 97_800,
    status: "open",
    timeRemaining: "22d 8h",
    lsLmsr: { b: 80, qYes: 352, qNo: 448, costFunction: 582.1 },
    resolutionCriteria: "Strategy return minus SOL spot return > 10% at expiry",
    expiryTimestamp: 1751932800,
    createdAt: 1749340800,
  },
  {
    address: "Mkt4dE5fG6hI7jK8lM9nO0pQ1rS2tU3vW4xY5zA6b",
    strategy: "StrT3kQ9x1dZhHv6qMlk0TYyL6AvTfGIle1CbNnYhRo",
    strategyName: "DeFi Blue-Chip Index",
    question: "Will DeFi Blue-Chip Index TVL exceed $10M before July 2026?",
    yesPrice: 0.35,
    noPrice: 0.65,
    totalVolume: 56_200,
    status: "open",
    timeRemaining: "54d 16h",
    lsLmsr: { b: 60, qYes: 210, qNo: 390, costFunction: 421.8 },
    resolutionCriteria: "On-chain TVL read from strategy vault >= 10,000,000 USDC",
    expiryTimestamp: 1754524800,
    createdAt: 1749340800,
  },
];

// ---------------------------------------------------------------------------
// Read routes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/markets
//
// Reads the `markets` Postgres mirror populated by chaos-sim's
// markets-indexer. Each row corresponds to an on-chain Market PDA, refreshed
// once per supervisor cycle. We project the columnar mirror into the legacy
// PredictionMarket shape so existing consumers keep working — fields the
// mirror doesn't carry (strategyName, timeRemaining) are returned as best-
// effort approximations:
//   - strategy:     empty string (the on-chain Market.strategy isn't
//                   mirrored; consumers needing it should call
//                   `GET /api/markets/:id` which reads chain directly).
//   - strategyName: derived from question text or empty.
//   - yesPrice:     yes_volume / total_volume when total > 0, else 0.5.
//   - noPrice:      1 - yesPrice.
//   - totalVolume:  total_volume converted from 6dp base units to whole
//                   bUSD (Number, may lose precision for >2^53 base units —
//                   acceptable since UI rounds anyway).
//   - timeRemaining: empty (would require a current-slot read; clients can
//                   compute from resolution_slot if needed).
// ---------------------------------------------------------------------------

interface MarketRow {
  market_pda: string;
  question: string | null;
  status: "open" | "resolved" | "expired";
  yes_volume: string;
  no_volume: string;
  total_volume: string;
  resolution_slot: string | number | null;
}

/**
 * Solana mainnet/devnet target slot time. Real cadence drifts (jitter, vote
 * delays) but 400ms is the protocol target and the value Solana docs use for
 * back-of-envelope calculations.
 */
const SLOT_MS = 400;

/** Format a positive ms duration into a compact "Xd Yh", "Xh Ym", or "Xm Ys" string. */
function fmtRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "ended";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

markets.get("/", async (c) => {
  // Fail-open: if no DB is configured, fall back to the legacy mock catalog
  // so the frontend keeps rendering during local dev without bundie-db.
  if (!getPool()) {
    const summaries: PredictionMarket[] = MOCK_MARKETS.map(
      ({ lsLmsr, resolutionCriteria, expiryTimestamp, createdAt, ...rest }) => rest,
    );
    return c.json({ markets: summaries });
  }

  let rows: MarketRow[] = [];
  try {
    const r = await dbQuery<MarketRow>(
      `SELECT market_pda,
              question,
              status,
              yes_volume::text  AS yes_volume,
              no_volume::text   AS no_volume,
              total_volume::text AS total_volume,
              resolution_slot
         FROM markets
        ORDER BY created_at DESC
        LIMIT 200`,
    );
    rows = r?.rows ?? [];
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  // One RPC round-trip per request to read the current devnet slot. Used for
  // every row's timeRemaining computation. Failure → fall back to "" so the
  // endpoint stays up even if the RPC is flaky.
  let currentSlot: number | null = null;
  try {
    currentSlot = await connection.getSlot("confirmed");
  } catch {
    currentSlot = null;
  }

  const summaries: PredictionMarket[] = rows.map((row) => {
    const yesVol = BigInt(row.yes_volume);
    const noVol = BigInt(row.no_volume);
    const totalBaseUnits = yesVol + noVol;
    let yesPrice = 0.5;
    if (totalBaseUnits > 0n) {
      // Scale by 1e6 before dividing to retain 6dp precision in number math.
      const ratio = Number((yesVol * 1_000_000n) / totalBaseUnits) / 1_000_000;
      yesPrice = Math.min(1, Math.max(0, ratio));
    }
    const noPrice = 1 - yesPrice;
    // Convert 6dp base units → whole bUSD as a Number. Volumes well under
    // 2^53 base units in practice; if they ever overflow the UI will still
    // render correctly to the rounded display precision.
    const totalVolume = Number(totalBaseUnits / 1_000_000n);

    // timeRemaining: empty string when (a) the market has already resolved,
    // (b) the RPC slot read failed, or (c) resolution_slot is missing from
    // the mirror. Otherwise human-readable countdown to resolution.
    let timeRemaining = "";
    const resSlot =
      row.resolution_slot != null ? Number(row.resolution_slot) : null;
    if (
      row.status === "open" &&
      currentSlot !== null &&
      resSlot !== null &&
      resSlot > 0
    ) {
      const slotsRemaining = resSlot - currentSlot;
      timeRemaining =
        slotsRemaining > 0 ? fmtRemaining(slotsRemaining * SLOT_MS) : "ended";
    }

    return {
      address: row.market_pda,
      strategy: "",
      strategyName: row.question ?? "",
      question: row.question ?? "",
      yesPrice,
      noPrice,
      totalVolume,
      status: row.status,
      timeRemaining,
    };
  });

  return c.json({ markets: summaries });
});

markets.get("/:id", (c) => {
  const { id } = c.req.param();
  const market = MOCK_MARKETS.find((m) => m.address === id);

  if (!market) {
    return c.json({ error: "Market not found", id }, 404);
  }

  return c.json({ market });
});

// ---------------------------------------------------------------------------
// GET /api/markets/:marketPda/claimable?wallet=<pubkey>
//
// Bettor-side helper for the redeem flow. Reads the on-chain Market account
// to determine resolution state + winner_mint, then reads the bettor's ATA
// for that mint to determine their claimable share balance. After resolution
// shares are redeemable 1:1 for collateral via the program's `redeem` ix
// (see programs/prediction-market/src/instructions/redeem.rs).
//
// `alreadyRedeemed` is true when the market is resolved and the bettor's
// winning-mint balance is zero — they either already burned their shares
// via redeem, or they never bought any of the winning side.
// ---------------------------------------------------------------------------

interface ClaimableResponse {
  resolved: boolean;
  outcome: 0 | 1 | null;
  winnerShareMint: string | null;
  winnerShareBalance: string;
  estimatedPayoutUsdc: string;
  alreadyRedeemed: boolean;
}

markets.get("/:id/claimable", async (c) => {
  const { id } = c.req.param();
  const walletParam = c.req.query("wallet");

  let marketPk: PublicKey;
  try {
    marketPk = new PublicKey(id);
  } catch {
    return c.json({ error: `Invalid market address: ${id}` }, 400);
  }

  if (!walletParam) {
    return c.json({ error: "`wallet` query param is required" }, 400);
  }

  let walletPk: PublicKey;
  try {
    walletPk = new PublicKey(walletParam);
  } catch {
    return c.json({ error: `Invalid wallet pubkey: ${walletParam}` }, 400);
  }

  // Read-only Anchor client. The provider needs *some* Wallet for type
  // compatibility but is never used to sign — fresh throwaway keypair.
  const throwaway = Keypair.generate();
  const provider = new AnchorProvider(
    connection,
    new Wallet(throwaway),
    { commitment: "confirmed" },
  );
  const program = getPredictionProgram(provider);

  // ── 1. Read market account; deserialize via Anchor IDL. ──────────────
  let marketAccount: Awaited<
    ReturnType<typeof program.account.market.fetch>
  >;
  try {
    marketAccount = await program.account.market.fetch(marketPk);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      { error: "Market not found on-chain", detail: message },
      404,
    );
  }

  // Anchor decodes enum variants as `{ active: {} }` / `{ resolved: {} }`
  // and `{ yes: {} }` / `{ no: {} }`. Mirror auto-resolver.ts's approach.
  const status = marketAccount.status as
    | { active?: unknown; resolved?: unknown }
    | null;
  const resolved = !!status && "resolved" in status;

  let outcome: 0 | 1 | null = null;
  const rawOutcome = marketAccount.outcome as
    | { yes?: unknown; no?: unknown }
    | null
    | undefined;
  if (rawOutcome) {
    if ("yes" in rawOutcome && rawOutcome.yes !== undefined) outcome = 1;
    else if ("no" in rawOutcome && rawOutcome.no !== undefined) outcome = 0;
  }

  // Not resolved yet — short-circuit before doing the token balance read.
  if (!resolved || outcome == null) {
    const body: ClaimableResponse = {
      resolved: false,
      outcome: null,
      winnerShareMint: null,
      winnerShareBalance: "0",
      estimatedPayoutUsdc: "0",
      alreadyRedeemed: false,
    };
    return c.json(body);
  }

  // ── 2. Derive winner mint PDA. ───────────────────────────────────────
  const [yesMint] = yesMintPDA(marketPk);
  const [noMint] = noMintPDA(marketPk);
  const winnerMint = outcome === 1 ? yesMint : noMint;

  // ── 3. Read bettor's ATA for the winner mint. ────────────────────────
  const bettorAta = getAssociatedTokenAddress(winnerMint, walletPk);
  let balanceBase = 0n;
  try {
    const info = await connection.getTokenAccountBalance(
      bettorAta,
      "confirmed",
    );
    balanceBase = BigInt(info.value.amount);
  } catch {
    // ATA doesn't exist (never bought this side, or already redeemed and
    // closed). Treat as zero balance.
    balanceBase = 0n;
  }

  const body: ClaimableResponse = {
    resolved: true,
    outcome,
    winnerShareMint: winnerMint.toBase58(),
    winnerShareBalance: balanceBase.toString(),
    // 1:1 with shares — same convention used by the on-chain redeem ix
    // when the vault holds exactly winning_supply collateral. Frontend
    // labels this "estimated" so a partially-funded vault doesn't make
    // the UI promise more than the program will pay.
    estimatedPayoutUsdc: balanceBase.toString(),
    alreadyRedeemed: balanceBase === 0n,
  };
  return c.json(body);
});

// ---------------------------------------------------------------------------
// Write routes — return UNSIGNED transactions for the client to sign + send.
//
// Mirrors the `Prepared` shape from @bundie/sol-cli/src/prepare.ts. The
// prediction-market program is Anchor 1.0; we hand-encode the 8-byte
// sha256("global:buy_shares") discriminator + Borsh args (outcome:u8 +
// amount:u64) so we don't need to thread a wallet through an AnchorProvider
// just to build an instruction.
// ---------------------------------------------------------------------------

interface PredictBuyBody {
  /** Buyer wallet — signs + pays fee. */
  wallet: string;
  /** "yes" or "no". */
  outcome: "yes" | "no";
  /** Whole-USDC amount to buy (× 1e6 base units on-chain). */
  amount: number;
  /** Strategy address the market predicts on. Required for the program's
   *  buyer ≠ strategy.authority self-exclusion check. The client gets this
   *  from `GET /api/markets/:id` (`market.strategy`). Falls back to the mock
   *  strategy address if the client omits it AND the market id is in our
   *  mock catalog. */
  strategy?: string;
  /** Collateral mint (defaults to devnet USDC). */
  collateral_mint?: string;
}

markets.post("/:id/buy", async (c) => {
  const { id } = c.req.param();

  let marketKey: PublicKey;
  try {
    marketKey = new PublicKey(id);
  } catch {
    return c.json({ error: `Invalid market address: ${id}` }, 400);
  }

  let body: PredictBuyBody;
  try {
    body = await c.req.json<PredictBuyBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.wallet) return c.json({ error: "`wallet` is required" }, 400);
  if (!body.outcome || !["yes", "no"].includes(body.outcome)) {
    return c.json({ error: "`outcome` must be 'yes' or 'no'" }, 400);
  }
  if (!body.amount || body.amount <= 0) {
    return c.json({ error: "`amount` must be a positive number" }, 400);
  }

  let payer: PublicKey;
  try {
    payer = new PublicKey(body.wallet);
  } catch {
    return c.json({ error: `Invalid wallet pubkey: ${body.wallet}` }, 400);
  }

  // Resolve strategy: explicit body field wins; else look up in mock catalog;
  // else 400. (Once we hydrate markets from chain we'll fetchMarket() here.)
  const fallback = MOCK_MARKETS.find((m) => m.address === id);
  const strategy = body.strategy ?? fallback?.strategy;
  if (!strategy) {
    return c.json(
      { error: "`strategy` is required (read from `GET /api/markets/:id`)" },
      400
    );
  }

  const collateralMint = body.collateral_mint ?? DEVNET_USDC.toBase58();

  try {
    const prepared = await buildPredictBuy(connection, payer, {
      market: marketKey.toBase58(),
      strategy,
      collateralMint,
      side: body.outcome,
      amount: body.amount,
    });
    return c.json(prepared);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      { error: "Failed to build prediction buy_shares tx", detail: message },
      500
    );
  }
});

// ---------------------------------------------------------------------------
// POST /api/markets/:marketPda/claim-recorded
//
// Off-chain ledger writer. The frontend calls this AFTER its own wallet
// signs + confirms a `redeem` tx. We insert one row per claim so agent
// profiles can render aggregate "paid out to bettors" totals without
// paging through chain history.
//
// Unauthenticated by design (see migration header). Idempotent on tx_sig:
// the redeem CTA may retry on a flaky network, so we ON CONFLICT DO NOTHING
// and surface `alreadyRecorded` in the response.
//
// All amounts are 6dp base units. Body fields are passed through as-is —
// no on-chain verification in this MVP. Caller has just signed the tx,
// their wallet wouldn't lie about its own claim.
// ---------------------------------------------------------------------------

interface ClaimRecordedBody {
  txSig: string;
  redeemer: string;
  shareMint: string;
  sharesRedeemed: string;
  payoutLamports: string;
}

markets.post("/:id/claim-recorded", async (c) => {
  const { id: marketPda } = c.req.param();

  let body: ClaimRecordedBody;
  try {
    body = await c.req.json<ClaimRecordedBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Validate every field is a non-empty string. Numeric strings are kept
  // as strings since Postgres bigint can hold values >2^53; parsing into
  // Number would lose precision on large payouts.
  const required: (keyof ClaimRecordedBody)[] = [
    "txSig",
    "redeemer",
    "shareMint",
    "sharesRedeemed",
    "payoutLamports",
  ];
  for (const k of required) {
    const v = body[k];
    if (typeof v !== "string" || v.length === 0) {
      return c.json({ error: `\`${k}\` must be a non-empty string` }, 400);
    }
  }

  if (!getPool()) {
    // Fail-open: no DB configured (local dev). Caller treats this as a
    // best-effort write so a 503 keeps the UI honest without breaking it.
    return c.json({ error: "Database not configured" }, 503);
  }

  try {
    const result = await dbQuery<{ id: string }>(
      `INSERT INTO claims
         (market_pda, redeemer, share_mint, shares_redeemed,
          payout_lamports, tx_sig)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tx_sig) DO NOTHING
         RETURNING id`,
      [
        marketPda,
        body.redeemer,
        body.shareMint,
        body.sharesRedeemed,
        body.payoutLamports,
        body.txSig,
      ],
    );
    // ON CONFLICT DO NOTHING returns 0 rows when the row was already
    // present — that's the "already recorded" case (caller retried).
    const alreadyRecorded = (result?.rowCount ?? 0) === 0;
    return c.json({ ok: true, alreadyRecorded });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Failed to record claim", detail: message }, 500);
  }
});

markets.post("/:id/resolve", async (c) => {
  const { id } = c.req.param();
  const market = MOCK_MARKETS.find((m) => m.address === id);

  if (!market) {
    return c.json({ error: "Market not found", id }, 404);
  }

  // Mock resolution based on current yes price being the "probability"
  const resolvedYes = market.yesPrice > 0.5;
  const response: ResolveResponse = {
    outcome: resolvedYes ? "yes" : "no",
    navAtResolution: resolvedYes ? 1.22 : 0.95,
    threshold: 1.0,
  };

  return c.json(response);
});
