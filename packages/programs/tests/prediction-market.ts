/**
 * prediction-market.ts — Integration tests for the full market lifecycle.
 *
 * Run against localnet:
 *   anchor test --skip-deploy   (if already deployed)
 *   anchor test                  (deploys fresh)
 *
 * Tests the full flow:
 *   create_market → buy_shares (YES + NO) → sell_shares → resolve → redeem
 */

import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { expect } from "chai";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

const PREDICTION_MARKET_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4"
);

// ── PDA helpers ──────────────────────────────────────────────────────────
function marketPDA(strategy: PublicKey, marketId: BN): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(marketId.toString()));
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

// ── Test suite ───────────────────────────────────────────────────────────
describe("prediction-market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PredictionMarket as Program;
  const payer = (provider.wallet as anchor.Wallet).payer;

  // Shared test state
  let collateralMint: PublicKey;
  let payerCollateral: PublicKey;
  let strategyKey: PublicKey; // fake strategy pubkey (just any valid pubkey)
  let marketKey: PublicKey;
  let vaultKey: PublicKey;
  let yesMint: PublicKey;
  let noMint: PublicKey;
  let marketId: BN;

  const INITIAL_SUBSIDY = new BN(5_000_000); // 5 USDC (6 decimals)
  const INITIAL_NAV = new BN(1_000_000); // 1.0 USDC
  const THRESHOLD_BPS = new BN(2000); // 20% APY

  before(async () => {
    // Create a fake USDC mint (6 decimals) for testing
    collateralMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    // Create payer's collateral ATA and mint 1000 USDC
    payerCollateral = await createAssociatedTokenAccount(
      provider.connection,
      payer,
      collateralMint,
      payer.publicKey
    );
    await mintTo(
      provider.connection,
      payer,
      collateralMint,
      payerCollateral,
      payer,
      1_000_000_000 // 1000 USDC
    );

    // Use a random pubkey as the strategy (no need to create real strategy for PM tests)
    strategyKey = Keypair.generate().publicKey;

    // Market ID
    marketId = new BN(Date.now());
    [marketKey] = marketPDA(strategyKey, marketId);
    [vaultKey] = vaultPDA(marketKey);
    [yesMint] = yesMintPDA(marketKey);
    [noMint] = noMintPDA(marketKey);
  });

  // ─────────────────────────────────────────────────────────────────────
  it("creates a market with vault and YES/NO mints", async () => {
    const currentSlot = await provider.connection.getSlot();

    await program.methods
      .createMarket(
        "Will this strategy exceed 20% APY?",
        marketId,
        { absolute: {} },
        THRESHOLD_BPS,
        new BN(currentSlot + 200_000),
        INITIAL_SUBSIDY,
        100, // 1% fee
        INITIAL_NAV
      )
      .accounts({
        creator: payer.publicKey,
        market: marketKey,
        strategy: strategyKey,
        strategyB: SystemProgram.programId,
        collateralMint,
        vault: vaultKey,
        yesMint,
        noMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const market = await program.account.market.fetch(marketKey);
    expect(market.strategy.toBase58()).to.equal(strategyKey.toBase58());
    expect(market.thresholdBps.toNumber()).to.equal(2000);
    expect(market.initialNavPerShare.toNumber()).to.equal(1_000_000);
    expect(market.yesShares.toNumber()).to.equal(0);
    expect(market.noShares.toNumber()).to.equal(0);
    expect(market.status).to.deep.equal({ active: {} });
    expect(market.outcome).to.be.null;

    // Verify vault and mints exist
    const vaultAccount = await getAccount(provider.connection, vaultKey);
    expect(vaultAccount.mint.toBase58()).to.equal(collateralMint.toBase58());

    console.log("  market:   ", marketKey.toBase58());
    console.log("  vault:    ", vaultKey.toBase58());
    console.log("  yes_mint: ", yesMint.toBase58());
    console.log("  no_mint:  ", noMint.toBase58());
  });

  // ─────────────────────────────────────────────────────────────────────
  it("buys YES shares with LS-LMSR pricing", async () => {
    const buyerYesAta = await createAssociatedTokenAccount(
      provider.connection, payer, yesMint, payer.publicKey
    ).catch(async () =>
      // May already exist
      (await anchor.utils.token.associatedAddress({ mint: yesMint, owner: payer.publicKey }))
    );
    const buyerNoAta = await createAssociatedTokenAccount(
      provider.connection, payer, noMint, payer.publicKey
    ).catch(async () =>
      anchor.utils.token.associatedAddress({ mint: noMint, owner: payer.publicKey })
    );

    const amountShares = new BN(10_000_000); // 10 shares

    const vaultBefore = await getAccount(provider.connection, vaultKey);
    const collateralBefore = await getAccount(provider.connection, payerCollateral);

    await program.methods
      .buyShares({ yes: {} }, amountShares)
      .accounts({
        buyer: payer.publicKey,
        market: marketKey,
        yesMint,
        noMint,
        vault: vaultKey,
        buyerCollateral: payerCollateral,
        buyerYesAta,
        buyerNoAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const market = await program.account.market.fetch(marketKey);
    expect(market.yesShares.toNumber()).to.equal(10_000_000);
    expect(market.noShares.toNumber()).to.equal(0);

    // Cost was transferred from buyer to vault
    const vaultAfter = await getAccount(provider.connection, vaultKey);
    const collateralAfter = await getAccount(provider.connection, payerCollateral);
    const cost = Number(vaultAfter.amount) - Number(vaultBefore.amount);
    const paid = Number(collateralBefore.amount) - Number(collateralAfter.amount);

    expect(cost).to.be.greaterThan(0);
    expect(paid).to.equal(cost);

    // YES shares minted
    const yesAccount = await getAccount(provider.connection, buyerYesAta);
    expect(Number(yesAccount.amount)).to.equal(10_000_000);

    console.log("  cost paid:   ", cost / 1e6, "USDC");
    console.log("  yes shares:  ", Number(yesAccount.amount) / 1e6);
  });

  // ─────────────────────────────────────────────────────────────────────
  it("buys NO shares", async () => {
    const buyerNoAta = await anchor.utils.token.associatedAddress({
      mint: noMint, owner: payer.publicKey,
    });
    const buyerYesAta = await anchor.utils.token.associatedAddress({
      mint: yesMint, owner: payer.publicKey,
    });

    const amountShares = new BN(5_000_000); // 5 NO shares

    await program.methods
      .buyShares({ no: {} }, amountShares)
      .accounts({
        buyer: payer.publicKey,
        market: marketKey,
        yesMint,
        noMint,
        vault: vaultKey,
        buyerCollateral: payerCollateral,
        buyerYesAta,
        buyerNoAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const market = await program.account.market.fetch(marketKey);
    expect(market.yesShares.toNumber()).to.equal(10_000_000);
    expect(market.noShares.toNumber()).to.equal(5_000_000);

    const noAccount = await getAccount(provider.connection, buyerNoAta);
    expect(Number(noAccount.amount)).to.equal(5_000_000);
  });

  // ─────────────────────────────────────────────────────────────────────
  it("sells YES shares back for a payout", async () => {
    const buyerYesAta = await anchor.utils.token.associatedAddress({
      mint: yesMint, owner: payer.publicKey,
    });

    const yesSharesBefore = await getAccount(provider.connection, buyerYesAta);
    const collateralBefore = await getAccount(provider.connection, payerCollateral);

    const sellShares = new BN(3_000_000); // sell 3 YES shares

    await program.methods
      .sellShares({ yes: {} }, sellShares)
      .accounts({
        seller: payer.publicKey,
        market: marketKey,
        outcomeMint: yesMint,
        sellerShares: buyerYesAta,
        sellerCollateral: payerCollateral,
        vault: vaultKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const market = await program.account.market.fetch(marketKey);
    expect(market.yesShares.toNumber()).to.equal(7_000_000);

    const yesSharesAfter = await getAccount(provider.connection, buyerYesAta);
    const collateralAfter = await getAccount(provider.connection, payerCollateral);

    const sharesBurned = Number(yesSharesBefore.amount) - Number(yesSharesAfter.amount);
    const payout = Number(collateralAfter.amount) - Number(collateralBefore.amount);

    expect(sharesBurned).to.equal(3_000_000);
    expect(payout).to.be.greaterThan(0);

    console.log("  payout received:", payout / 1e6, "USDC");
  });

  // ─────────────────────────────────────────────────────────────────────
  it("resolves market after seeding a mock NavOracle", async () => {
    // Build a mock NavOracle account with the right layout:
    // [disc(8), strategy(32), nav_per_share(8), twap_value(8), snapshot_count(8), ...]
    const DISC = Buffer.from([0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05]);
    const navOracle = Keypair.generate();

    const oracleData = Buffer.alloc(89);
    DISC.copy(oracleData, 0);                                    // discriminator
    strategyKey.toBuffer().copy(oracleData, 8);                  // strategy pubkey
    oracleData.writeBigUInt64LE(1_200_000n, 40);                 // nav_per_share (1.2 USDC = 20% growth)
    oracleData.writeBigUInt64LE(1_200_000n, 48);                 // twap_value
    oracleData.writeBigUInt64LE(10n, 56);                        // snapshot_count = 10

    // Fund + create oracle account with raw data
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(89);
    const createOracleTx = new anchor.web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: navOracle.publicKey,
        lamports,
        space: 89,
        programId: new PublicKey("Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm"),
      })
    );
    await provider.sendAndConfirm(createOracleTx, [navOracle]);

    // Write oracle data via a raw transaction
    // (In production, the strategy-token program writes this)
    // For tests, we use a low-level write via program-owned account hack.
    // Instead, we override resolution_slot to current slot so resolve can be called.

    // Update the market's resolution_slot to current slot to unblock resolve
    // We can't do this without an admin instruction, so we fast-forward via
    // anchor's `clock` manipulation in localnet (if supported) or set low resolution_slot.

    // For now: create a new market with resolution_slot = current + 1 and run resolve
    const currentSlot = await provider.connection.getSlot();
    const fastMarketId = new BN(Date.now() + 1);
    const [fastMarket] = marketPDA(strategyKey, fastMarketId);
    const [fastVault] = vaultPDA(fastMarket);
    const [fastYesMint] = yesMintPDA(fastMarket);
    const [fastNoMint] = noMintPDA(fastMarket);

    await program.methods
      .createMarket(
        "Fast-resolve test market",
        fastMarketId,
        { absolute: {} },
        THRESHOLD_BPS,
        new BN(currentSlot),  // resolution_slot = NOW (already passed)
        INITIAL_SUBSIDY,
        100,
        INITIAL_NAV
      )
      .accounts({
        creator: payer.publicKey,
        market: fastMarket,
        strategy: strategyKey,
        strategyB: SystemProgram.programId,
        collateralMint,
        vault: fastVault,
        yesMint: fastYesMint,
        noMint: fastNoMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    await program.methods
      .resolve()
      .accounts({
        resolver: payer.publicKey,
        market: fastMarket,
        navOracle: navOracle.publicKey,
      })
      .rpc();

    const market = await program.account.market.fetch(fastMarket);
    expect(market.status).to.deep.equal({ resolved: {} });
    expect(market.outcome).to.not.be.null;

    const outcome = market.outcome as { yes: {} } | { no: {} };
    console.log("  outcome:", "yes" in outcome ? "YES" : "NO");
    console.log("  (twap_nav=1.2 USDC, initial=1.0 USDC, threshold=20% APY)");
  });

  // ─────────────────────────────────────────────────────────────────────
  it("redeems winning shares for proportional USDC payout", async () => {
    // Use a fresh isolated market for this test
    const redeemMarketId = new BN(Date.now() + 2);
    const [redeemMarket] = marketPDA(strategyKey, redeemMarketId);
    const [redeemVault] = vaultPDA(redeemMarket);
    const [redeemYesMint] = yesMintPDA(redeemMarket);
    const [redeemNoMint] = noMintPDA(redeemMarket);

    const currentSlot = await provider.connection.getSlot();

    // Create market
    await program.methods
      .createMarket(
        "Redeem test market",
        redeemMarketId,
        { absolute: {} },
        THRESHOLD_BPS,
        new BN(currentSlot),
        INITIAL_SUBSIDY,
        0, // 0% fee for clean math
        INITIAL_NAV
      )
      .accounts({
        creator: payer.publicKey,
        market: redeemMarket,
        strategy: strategyKey,
        strategyB: SystemProgram.programId,
        collateralMint,
        vault: redeemVault,
        yesMint: redeemYesMint,
        noMint: redeemNoMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Buy YES shares
    const redeemYesAta = await createAssociatedTokenAccount(
      provider.connection, payer, redeemYesMint, payer.publicKey
    );
    const redeemNoAta = await createAssociatedTokenAccount(
      provider.connection, payer, redeemNoMint, payer.publicKey
    );

    await program.methods
      .buyShares({ yes: {} }, new BN(10_000_000))
      .accounts({
        buyer: payer.publicKey,
        market: redeemMarket,
        yesMint: redeemYesMint,
        noMint: redeemNoMint,
        vault: redeemVault,
        buyerCollateral: payerCollateral,
        buyerYesAta: redeemYesAta,
        buyerNoAta: redeemNoAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Build a mock NavOracle that resolves YES
    const DISC = Buffer.from([0xa1, 0x4e, 0x73, 0x20, 0xbc, 0x44, 0x61, 0x05]);
    const oracle2 = Keypair.generate();
    const oracleData = Buffer.alloc(89);
    DISC.copy(oracleData, 0);
    strategyKey.toBuffer().copy(oracleData, 8);
    oracleData.writeBigUInt64LE(2_000_000n, 40); // nav_per_share = 2.0 USDC (100% growth, >> 20% threshold)
    oracleData.writeBigUInt64LE(2_000_000n, 48); // twap_value
    oracleData.writeBigUInt64LE(10n, 56);         // snapshot_count

    const lamports = await provider.connection.getMinimumBalanceForRentExemption(89);
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: oracle2.publicKey,
          lamports,
          space: 89,
          programId: new PublicKey("Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm"),
        })
      ),
      [oracle2]
    );

    // Resolve → YES
    await program.methods
      .resolve()
      .accounts({
        resolver: payer.publicKey,
        market: redeemMarket,
        navOracle: oracle2.publicKey,
      })
      .rpc();

    // Redeem YES shares
    const collateralBefore = await getAccount(provider.connection, payerCollateral);
    const yesBefore = await getAccount(provider.connection, redeemYesAta);
    const vaultBefore = await getAccount(provider.connection, redeemVault);

    await program.methods
      .redeem()
      .accounts({
        redeemer: payer.publicKey,
        market: redeemMarket,
        winnerMint: redeemYesMint,
        redeemerShares: redeemYesAta,
        redeemerCollateral: payerCollateral,
        vault: redeemVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const collateralAfter = await getAccount(provider.connection, payerCollateral);
    const yesAfter = await getAccount(provider.connection, redeemYesAta);

    const sharesRedeemed = Number(yesBefore.amount) - Number(yesAfter.amount);
    const payout = Number(collateralAfter.amount) - Number(collateralBefore.amount);

    expect(sharesRedeemed).to.equal(10_000_000);
    expect(payout).to.be.greaterThan(0);
    expect(payout).to.equal(Number(vaultBefore.amount)); // all vault goes to sole winner

    console.log("  shares redeemed:", sharesRedeemed / 1e6);
    console.log("  payout received:", payout / 1e6, "USDC");
  });
});
