/**
 * On-chain read helpers for the v1 event-price API.
 *
 * Wraps the Anchor program with a thin cache so the /v1/event-price route
 * doesn't re-fetch the same Market account on every query. Stub responses
 * are served from `event-price.ts` when no on-chain market exists yet for
 * an event_id.
 */

import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import idlJson from "../idl/prediction_market.json" with { type: "json" };

const PREDICTION_PROGRAM_ID = new PublicKey(
  process.env.PREDICTION_PROGRAM_ID ??
    "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

let cachedProgram: Program | null = null;

/** Lazily build a read-only Anchor program. */
function getProgram(): Program {
  if (cachedProgram) return cachedProgram;
  const connection = new Connection(RPC_URL, "confirmed");
  const kp = Keypair.generate();
  const wallet = {
    publicKey: kp.publicKey,
    payer: kp,
    async signTransaction<T>(_tx: T): Promise<T> {
      throw new Error("read-only wallet");
    },
    async signAllTransactions<T>(_txs: T[]): Promise<T[]> {
      throw new Error("read-only wallet");
    },
  } as unknown as Wallet;
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cachedProgram = new Program(idlJson as any as Idl, provider);
  return cachedProgram;
}

/** Compute the sha256 of an event_id for use as the market PDA seed. */
export function eventIdHash(eventId: string): Buffer {
  return createHash("sha256").update(eventId).digest();
}

/**
 * Derive the market PDA for a given event_id + market_id. The market_id
 * is auto-incremented during demo creation (MARKET_ID_PREFIX..PREFIX+N);
 * for the v1 read path we scan a small range to find any deployed market
 * for an event_id.
 */
export function deriveMarketPda(eventId: string, marketId: number): PublicKey {
  const hash = eventIdHash(eventId);
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(marketId), 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("event_market"), hash, idBuf],
    PREDICTION_PROGRAM_ID,
  );
  return pda;
}

/**
 * In-memory cache for resolved market addresses per event_id. Cleared
 * on backend restart; the demo deploy script runs at most once per
 * deployment so the cache is effectively permanent within a run.
 */
const marketAddressCache = new Map<string, PublicKey | null>();

/**
 * Find the deployed Market account for an event_id by scanning a small
 * range of market_ids (the demo deploy uses MARKET_ID_PREFIX..PREFIX+N
 * sequentially). Returns null if no market exists for this event yet.
 */
export async function findMarketForEvent(
  eventId: string,
  searchRange = 50,
): Promise<PublicKey | null> {
  const cached = marketAddressCache.get(eventId);
  if (cached !== undefined) return cached;

  const program = getProgram();
  const startId = Number(process.env.MARKET_ID_PREFIX ?? "100");
  for (let i = 0; i < searchRange; i++) {
    const pda = deriveMarketPda(eventId, startId + i);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const account = await (program.account as any).market.fetchNullable(pda);
      if (account) {
        marketAddressCache.set(eventId, pda);
        return pda;
      }
    } catch {
      // continue scanning
    }
  }
  marketAddressCache.set(eventId, null);
  return null;
}

/** Decoded fields we care about for the v1 price response. */
export interface OnchainMarketSnapshot {
  marketAddress: string;
  yesShares: number;
  noShares: number;
  liquidityParam: number;
  totalVolumeUsd: number;
  status: "active" | "resolved" | "scheduled";
  resolutionSlot: number;
  collateralMint: string;
}

/**
 * Read the current Market account state and return the fields the v1 API
 * surfaces. Returns null if no market exists for the event_id (caller
 * falls back to the stub response).
 */
export async function readMarketSnapshot(
  eventId: string,
): Promise<OnchainMarketSnapshot | null> {
  const marketPda = await findMarketForEvent(eventId);
  if (!marketPda) return null;
  const program = getProgram();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const account = (await (program.account as any).market.fetch(marketPda)) as {
    yesShares: { toNumber: () => number };
    noShares: { toNumber: () => number };
    liquidityParam: { toNumber: () => number };
    totalVolume: { toNumber: () => number };
    status: { active?: object; resolved?: object };
    resolutionSlot: { toNumber: () => number };
    collateralMint: PublicKey;
  };
  return {
    marketAddress: marketPda.toBase58(),
    yesShares: account.yesShares.toNumber(),
    noShares: account.noShares.toNumber(),
    liquidityParam: account.liquidityParam.toNumber(),
    totalVolumeUsd: account.totalVolume.toNumber() / 1_000_000,
    status: account.status.resolved ? "resolved" : "active",
    resolutionSlot: account.resolutionSlot.toNumber(),
    collateralMint: account.collateralMint.toBase58(),
  };
}
