/**
 * seed-devnet.ts — Bootstrap one strategy + one prediction market on devnet.
 *
 * Usage:
 *   npx ts-node scripts/seed-devnet.ts
 *
 * Prerequisites:
 *   - ANCHOR_WALLET set (or ~/.config/solana/id.json)
 *   - Wallet has SOL (for rent) and USDC on devnet
 *   - Both programs deployed
 */

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ── Constants ──────────────────────────────────────────────────────────────
const STRATEGY_TOKEN_PROGRAM_ID = new PublicKey(
  "Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV"
);
const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i"
);
const DEVNET_USDC = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
// Kamino not deployed on devnet — use SystemProgram as placeholder for seed
const KAMINO_PROGRAM = SystemProgram.programId;

const RPC = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";

// ── Helpers ────────────────────────────────────────────────────────────────
function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function encodeName(name: string): Buffer {
  const buf = Buffer.alloc(32);
  Buffer.from(name.substring(0, 32), "utf-8").copy(buf);
  return buf;
}

function strategyPDA(creator: PublicKey, name32: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), creator.toBuffer(), name32],
    STRATEGY_TOKEN_PROGRAM_ID
  );
}

function walletPDA(strategy: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("wallet"), strategy.toBuffer()],
    STRATEGY_TOKEN_PROGRAM_ID
  );
}

function navOraclePDA(strategy: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nav"), strategy.toBuffer()],
    STRATEGY_TOKEN_PROGRAM_ID
  );
}

function marketPDA(
  strategy: PublicKey,
  marketId: bigint
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(marketId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), strategy.toBuffer(), idBuf],
    PREDICTION_MARKET_PROGRAM_ID
  );
}

function vaultPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID
  );
}

function yesMintPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), market.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID
  );
}

function noMintPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), market.toBuffer()],
    PREDICTION_MARKET_PROGRAM_ID
  );
}

// ── Step 1: Create strategy ────────────────────────────────────────────────
async function createStrategy(
  conn: Connection,
  payer: Keypair
): Promise<{ strategyKey: PublicKey; mintKp: Keypair }> {
  const name = "Kamino Seed Strategy";
  const feeBps = 500; // 5%
  const minDeposit = 1_000_000; // 1 USDC
  const depositAmount = 10_000_000; // 10 USDC

  const name32 = encodeName(name);
  const [strategyKey] = strategyPDA(payer.publicKey, name32);
  const [walletKey] = walletPDA(strategyKey);
  const [navKey] = navOraclePDA(strategyKey);
  const mintKp = Keypair.generate();

  console.log("\n── Creating strategy ──");
  console.log("  strategy:", strategyKey.toBase58());
  console.log("  mint:    ", mintKp.publicKey.toBase58());

  // create_strategy instruction
  // data: [disc=0, type=1 (AGENT), fee_bps u16le, min_deposit u64le, name[32]]
  const ixData = Buffer.allocUnsafe(1 + 1 + 2 + 8 + 32);
  let off = 0;
  ixData.writeUInt8(0, off++);
  ixData.writeUInt8(1, off++); // AGENT type
  ixData.writeUInt16LE(feeBps, off); off += 2;
  ixData.writeBigUInt64LE(BigInt(minDeposit), off); off += 8;
  name32.copy(ixData, off);

  const createIx = new TransactionInstruction({
    programId: STRATEGY_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey,    isSigner: true,  isWritable: true  },
      { pubkey: strategyKey,        isSigner: false, isWritable: true  },
      { pubkey: mintKp.publicKey,   isSigner: true,  isWritable: true  },
      { pubkey: walletKey,          isSigner: false, isWritable: false },
      { pubkey: navKey,             isSigner: false, isWritable: true  },
      { pubkey: DEVNET_USDC,        isSigner: false, isWritable: false },
      { pubkey: KAMINO_PROGRAM,     isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,   isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: ixData,
  });

  const tx1 = new Transaction().add(createIx);
  const sig1 = await sendAndConfirmTransaction(conn, tx1, [payer, mintKp]);
  console.log("  create_strategy tx:", sig1);

  // Skipping initial buy_shares — payer has no devnet USDC yet.
  // Use the CLI or faucet USDC to deposit after seeding.

  return { strategyKey, mintKp };
}

// ── Step 2: Create prediction market ──────────────────────────────────────
async function createMarket(
  conn: Connection,
  payer: Keypair,
  provider: anchor.AnchorProvider,
  strategyKey: PublicKey
): Promise<PublicKey> {
  const idlPath = path.join(__dirname, "../target/idl/prediction_market.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  const marketId = BigInt(Date.now()); // unique ID
  const question = "Will this Kamino strategy exceed 20% APY?";
  const thresholdBps = 2000n; // 20% APY
  const currentSlot = await conn.getSlot();
  const resolutionSlot = currentSlot + 200_000; // ~27 hours at 400ms/slot
  const initialSubsidy = 5_000_000n; // 5 USDC liquidity floor
  const feeBps = 100; // 1%
  const initialNavPerShare = 1_000_000n; // 1.0 USDC (initial NAV)

  const [marketKey] = marketPDA(strategyKey, marketId);
  const [vaultKey] = vaultPDA(marketKey);
  const [yesMint] = yesMintPDA(marketKey);
  const [noMint] = noMintPDA(marketKey);

  console.log("\n── Creating prediction market ──");
  console.log("  market:  ", marketKey.toBase58());
  console.log("  vault:   ", vaultKey.toBase58());
  console.log("  yes_mint:", yesMint.toBase58());
  console.log("  no_mint: ", noMint.toBase58());

  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(marketId);

  const tx = await program.methods
    .createMarket(
      question,
      new anchor.BN(marketId.toString()),
      { absolute: {} }, // MarketType::Absolute
      new anchor.BN(thresholdBps.toString()),
      new anchor.BN(resolutionSlot.toString()),
      new anchor.BN(initialSubsidy.toString()),
      feeBps,
      new anchor.BN(initialNavPerShare.toString()),
      new anchor.BN(0) // initialNavPerShareB — 0 for Absolute markets
    )
    .accounts({
      creator: payer.publicKey,
      market: marketKey,
      strategy: strategyKey,
      strategyB: SystemProgram.programId, // placeholder for Absolute markets
      collateralMint: DEVNET_USDC,
      vault: vaultKey,
      yesMint,
      noMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log("  create_market tx:", tx);
  return marketKey;
}

// ── Step 3: Buy YES shares ────────────────────────────────────────────────
async function buyYesShares(
  conn: Connection,
  payer: Keypair,
  provider: anchor.AnchorProvider,
  marketKey: PublicKey
): Promise<void> {
  const idlPath = path.join(__dirname, "../target/idl/prediction_market.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  const [yesMint] = yesMintPDA(marketKey);
  const [noMint] = noMintPDA(marketKey);
  const [vault] = vaultPDA(marketKey);
  const buyerCollateral = getAssociatedTokenAddressSync(DEVNET_USDC, payer.publicKey);
  const buyerYesAta = getAssociatedTokenAddressSync(yesMint, payer.publicKey);
  const buyerNoAta = getAssociatedTokenAddressSync(noMint, payer.publicKey);

  const amount = 5_000_000; // 5 USDC worth of YES shares

  console.log("\n── Buying YES shares ──");
  console.log("  amount:  5 USDC");

  const tx = await program.methods
    .buyShares({ yes: {} }, new anchor.BN(amount))
    .accounts({
      buyer: payer.publicKey,
      market: marketKey,
      yesMint,
      noMint,
      vault,
      buyerCollateral,
      buyerYesAta,
      buyerNoAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("  buy_shares tx:", tx);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const keypairPath =
    process.env.ANCHOR_WALLET ||
    `${process.env.HOME}/.config/solana/id.json`;
  const payer = loadKeypair(keypairPath);
  const conn = new Connection(RPC, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(conn, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  console.log("Payer:", payer.publicKey.toBase58());
  console.log("RPC:  ", RPC);

  const balance = await conn.getBalance(payer.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  // Strategy already created in prior run — reuse it
  const EXISTING_STRATEGY = process.env.SEED_STRATEGY;
  let strategyKey: PublicKey;
  if (EXISTING_STRATEGY) {
    strategyKey = new PublicKey(EXISTING_STRATEGY);
    console.log("Reusing existing strategy:", strategyKey.toBase58());
  } else {
    ({ strategyKey } = await createStrategy(conn, payer));
  }
  const marketKey = await createMarket(conn, payer, provider, strategyKey);
  // Skip buyYesShares — payer has no devnet USDC

  console.log("\n── Seed complete ──");
  console.log("Strategy:", strategyKey.toBase58());
  console.log("Market:  ", marketKey.toBase58());
  console.log(
    "\nAdd these to your .env.local:\n" +
    `NEXT_PUBLIC_SEED_STRATEGY=${strategyKey.toBase58()}\n` +
    `NEXT_PUBLIC_SEED_MARKET=${marketKey.toBase58()}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
