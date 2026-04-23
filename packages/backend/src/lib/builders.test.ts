/**
 * Smoke tests for the unsigned-tx builders.
 *
 * These don't hit RPC — we stub `getLatestBlockhash` so the tests are
 * deterministic and offline. The goal is to assert:
 *   1. The base64 tx round-trips through `Transaction.from`.
 *   2. The fee payer + recent blockhash are set.
 *   3. The instruction data starts with the correct discriminator byte/8-byte.
 *   4. The PreparedTx surface matches `@bundie/sol-cli`'s `Prepared` shape.
 */
import { describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  buildBuyStrategyShares,
  buildCreateStrategy,
  buildPredictBuy,
} from "./builders.js";
import { anchorDisc } from "./solana.js";

function fakeConn(): Connection {
  // We never want a real network round-trip in unit tests.
  const conn = new Connection("http://127.0.0.1:8899", "confirmed");
  // Stub the only RPC method our builders touch.
  (conn as unknown as { getLatestBlockhash: () => Promise<unknown> }).getLatestBlockhash =
    async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1,
    });
  return conn;
}

const PAYER = new Keypair().publicKey;
const STRATEGY = new Keypair().publicKey;
const SHARE_MINT = new Keypair().publicKey;
const WALLET_PDA = new Keypair().publicKey;
const DEPOSIT_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const MARKET = new Keypair().publicKey;

describe("buildCreateStrategy", () => {
  it("returns a base64 tx with discriminator byte 0", async () => {
    const prepared = await buildCreateStrategy(fakeConn(), PAYER, {
      name: "test-strategy",
      protocol: "kamino",
      feeBps: 100,
      minDeposit: 1,
    });

    // Shape parity with @bundie/sol-cli `PreparedTx`
    expect(prepared.tx).toBeTruthy();
    expect(prepared.blockhash).toBe("11111111111111111111111111111111");
    expect(prepared.lastValidBlockHeight).toBe(1);
    expect(prepared.preparedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(prepared.strategyAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(prepared.mintAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);

    // Round-trip the tx and inspect the instruction data
    const tx = Transaction.from(Buffer.from(prepared.tx, "base64"));
    expect(tx.feePayer?.toBase58()).toBe(PAYER.toBase58());
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0]!.data[0]).toBe(0); // create_strategy disc
  });
});

describe("buildBuyStrategyShares", () => {
  it("returns a base64 tx with discriminator byte 1", async () => {
    const prepared = await buildBuyStrategyShares(fakeConn(), PAYER, {
      strategy: STRATEGY.toBase58(),
      shareMint: SHARE_MINT.toBase58(),
      walletPda: WALLET_PDA.toBase58(),
      depositMint: DEPOSIT_MINT.toBase58(),
      amount: 5,
    });

    const tx = Transaction.from(Buffer.from(prepared.tx, "base64"));
    expect(tx.feePayer?.toBase58()).toBe(PAYER.toBase58());
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0]!.data[0]).toBe(1); // buy_shares disc
    // amount = 5 USDC = 5_000_000 base units, little-endian u64 follows disc
    const amount = tx.instructions[0]!.data.readBigUInt64LE(1);
    expect(amount).toBe(5_000_000n);
  });
});

describe("buildPredictBuy", () => {
  it("returns a base64 tx with the Anchor buy_shares discriminator", async () => {
    const prepared = await buildPredictBuy(fakeConn(), PAYER, {
      market: MARKET.toBase58(),
      strategy: STRATEGY.toBase58(),
      collateralMint: DEPOSIT_MINT.toBase58(),
      side: "yes",
      amount: 10,
    });

    const tx = Transaction.from(Buffer.from(prepared.tx, "base64"));
    expect(tx.feePayer?.toBase58()).toBe(PAYER.toBase58());
    expect(tx.instructions).toHaveLength(1);

    const data = tx.instructions[0]!.data;
    const disc = anchorDisc("buy_shares");
    expect(data.subarray(0, 8).equals(disc)).toBe(true);
    expect(data.readUInt8(8)).toBe(0); // outcome: yes = 0
    expect(data.readBigUInt64LE(9)).toBe(10_000_000n);
  });

  it("encodes outcome=1 for 'no'", async () => {
    const prepared = await buildPredictBuy(fakeConn(), PAYER, {
      market: MARKET.toBase58(),
      strategy: STRATEGY.toBase58(),
      collateralMint: DEPOSIT_MINT.toBase58(),
      side: "no",
      amount: 1,
    });
    const tx = Transaction.from(Buffer.from(prepared.tx, "base64"));
    expect(tx.instructions[0]!.data.readUInt8(8)).toBe(1);
  });
});
