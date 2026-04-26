/**
 * nav-resolution.spec.ts — End-to-end resolution test for kind=2
 * (RELATIVE / head-to-head) markets backed by BundieVault NAV.
 *
 * Exercises Phase B of the vault-NAV-resolution migration:
 *   1. init two BundieVaults at the same baseline NAV (1_000_000)
 *   2. create_market_v2 with kind=2, both vaults supplied as
 *      target_vault_a / target_vault_b — the program snapshots the
 *      baseline into market.initial_nav_a / market.initial_nav_b
 *   3. commit_nav on each vault with diverging NAVs (A: +10%, B: -5%)
 *   4. wait until current slot >= resolution_slot
 *   5. resolve_market_v2 with both vaults supplied — agent A wins
 *
 * The codebase pins anchor toolchain v1.0.0 → IDL is consumed via
 * `@anchor-lang/core`. As in bundie-vault.spec.ts we destructure the
 * default export to dodge the CJS named-export interop trap.
 */
import anchorPkg from "@anchor-lang/core";
import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";

const { AnchorProvider, setProvider, workspace } = anchorPkg as any;
type Program = any;

const MARKET_KIND_RELATIVE = 2;
const MARKET_PAYLOAD_LEN = 64;
const BASELINE_NAV = 1_000_000;
const NAV_AGENT_A = 1_100_000; // +10%
const NAV_AGENT_B = 950_000; // -5%

describe("NAV-based market resolution", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program: Program = workspace.PredictionMarket;
  const payer = (provider.wallet as any).payer as Keypair;

  const agentA = Keypair.generate();
  const agentB = Keypair.generate();

  const vaultPda = (auth: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("bundie_vault"), auth.toBuffer()],
      program.programId,
    )[0];

  const marketPda = (strategy: PublicKey, marketId: BN) => {
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(BigInt(marketId.toString()));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("market"), strategy.toBuffer(), idBuf],
      program.programId,
    )[0];
  };

  const childPda = (seed: string, market: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(seed), market.toBuffer()],
      program.programId,
    )[0];

  let collateralMint: PublicKey;
  let vaultA: PublicKey;
  let vaultB: PublicKey;
  let marketKey: PublicKey;
  let marketVault: PublicKey;
  let yesMint: PublicKey;
  let noMint: PublicKey;
  let marketId: BN;
  let strategyA: PublicKey;
  let strategyB: PublicKey;

  before(async () => {
    // Fund both agents from the test payer (devnet airdrops are heavily
    // rate-limited; fanning lamports from the configured wallet is more
    // robust).
    const fundIx = (kp: Keypair) =>
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: kp.publicKey,
        lamports: 200_000_000,
      });
    const tx = new Transaction().add(fundIx(agentA), fundIx(agentB));
    await provider.sendAndConfirm(tx, []);

    // Collateral mint for the market vault (test USDC, 6dp).
    collateralMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6,
    );

    vaultA = vaultPda(agentA.publicKey);
    vaultB = vaultPda(agentB.publicKey);

    // For kind=2 the `strategy` / `strategy_b` accounts are just identity
    // placeholders — the resolver reads vault NAV, not strategy data.
    strategyA = Keypair.generate().publicKey;
    strategyB = Keypair.generate().publicKey;

    marketId = new BN(Date.now());
    marketKey = marketPda(strategyA, marketId);
    marketVault = childPda("vault", marketKey);
    yesMint = childPda("yes_mint", marketKey);
    noMint = childPda("no_mint", marketKey);
  });

  it("init both BundieVaults at the same baseline NAV", async () => {
    // Phase J: init_vault now creates an associated treasury ATA. We
    // reuse `collateralMint` as the treasury mint — Phase B doesn't
    // exercise treasury balance, so any 6dp mint works.
    for (const [auth, vault] of [
      [agentA, vaultA],
      [agentB, vaultB],
    ] as const) {
      const treasuryAta = getAssociatedTokenAddressSync(
        collateralMint,
        vault,
        true,
      );
      await program.methods
        .initVault(new BN(BASELINE_NAV), auth.publicKey, collateralMint)
        .accounts({
          authority: auth.publicKey,
          vault,
          treasuryMint: collateralMint,
          treasuryAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([auth])
        .rpc();
    }

    const a = await program.account.bundieVault.fetch(vaultA);
    const b = await program.account.bundieVault.fetch(vaultB);
    expect(a.navLamports.toNumber()).to.equal(BASELINE_NAV);
    expect(b.navLamports.toNumber()).to.equal(BASELINE_NAV);
    expect(a.navEpoch.toNumber()).to.equal(0);
    expect(b.navEpoch.toNumber()).to.equal(0);
  });

  it("create_market_v2 (kind=2) snapshots both vault NAVs", async () => {
    const currentSlot = await provider.connection.getSlot();
    // Resolution far enough in the future that we can do commit_nav
    // before the resolve is even legal, but close enough that the
    // poll-loop below does not stall the suite.
    const resolutionSlot = currentSlot + 50;

    // Encode the kind=2 payload. For RELATIVE the resolver does not
    // read the payload — only the snapshotted vault NAVs and live
    // vault NAVs matter — but the create-time invariant requires the
    // 64-byte buffer.
    const payload = Buffer.alloc(MARKET_PAYLOAD_LEN);

    await program.methods
      .createMarketV2(
        "Will agent A outperform agent B?",
        marketId,
        MARKET_KIND_RELATIVE,
        Array.from(payload),
        new BN(resolutionSlot),
        new BN(5_000_000), // initial subsidy
        100, // 1% fee
        new BN(BASELINE_NAV), // legacy initial_nav_a (still required > 0 by kind=2 invariant)
        new BN(BASELINE_NAV), // legacy initial_nav_b
      )
      .accounts({
        creator: payer.publicKey,
        market: marketKey,
        strategy: strategyA,
        strategyB,
        collateralMint,
        vault: marketVault,
        yesMint,
        noMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        targetVaultA: vaultA,
        targetVaultB: vaultB,
      })
      .rpc();

    const market = await program.account.market.fetch(marketKey);
    expect(market.kind).to.equal(MARKET_KIND_RELATIVE);
    expect(market.initialNavA.toNumber()).to.equal(BASELINE_NAV);
    expect(market.initialNavB.toNumber()).to.equal(BASELINE_NAV);
  });

  it("commit_nav diverges the two vaults", async () => {
    const digest = Buffer.alloc(32, 1);
    await program.methods
      .commitNav(new BN(NAV_AGENT_A), new BN(1), Array.from(digest))
      .accounts({ authority: agentA.publicKey, vault: vaultA })
      .signers([agentA])
      .rpc();

    await program.methods
      .commitNav(new BN(NAV_AGENT_B), new BN(1), Array.from(digest))
      .accounts({ authority: agentB.publicKey, vault: vaultB })
      .signers([agentB])
      .rpc();

    const a = await program.account.bundieVault.fetch(vaultA);
    const b = await program.account.bundieVault.fetch(vaultB);
    expect(a.navLamports.toNumber()).to.equal(NAV_AGENT_A);
    expect(b.navLamports.toNumber()).to.equal(NAV_AGENT_B);
    expect(a.navEpoch.toNumber()).to.equal(1);
    expect(b.navEpoch.toNumber()).to.equal(1);
  });

  it("resolve_market_v2 picks YES (agent A's +10% beats agent B's -5%)", async () => {
    const market = await program.account.market.fetch(marketKey);
    const resolutionSlot: number = market.resolutionSlot.toNumber();

    // Wait until the validator has progressed past resolution_slot.
    // Localnet ticks at ~400ms/slot so this is bounded by ~50 * 0.4s.
    let currentSlot = await provider.connection.getSlot();
    while (currentSlot < resolutionSlot) {
      await new Promise((r) => setTimeout(r, 400));
      currentSlot = await provider.connection.getSlot();
    }

    await program.methods
      .resolveMarketV2()
      .accounts({
        resolver: payer.publicKey,
        market: marketKey,
        // Kind=2 does not read data_a/data_b — pass System program as a
        // placeholder UncheckedAccount, matching the v1 resolve test
        // pattern.
        dataA: SystemProgram.programId,
        dataB: SystemProgram.programId,
        targetVaultA: vaultA,
        targetVaultB: vaultB,
      })
      .rpc();

    const resolved = await program.account.market.fetch(marketKey);
    expect(resolved.status).to.deep.equal({ resolved: {} });
    expect(resolved.outcome).to.deep.equal({ yes: {} });
  });
});

/**
 * Negative test for the vault-substitution attack.
 *
 * A kind=2 market is created between agentA's and agentB's BundieVaults.
 * The market record pins `target_authority_a/b` at create-time. When the
 * resolver is called passing agentC's vault as `target_vault_a`, the
 * substitution guard MUST reject the tx — otherwise any caller could
 * force the outcome by supplying an attacker-controlled vault.
 */
describe("NAV-based market resolution — vault-substitution attack", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program: Program = workspace.PredictionMarket;
  const payer = (provider.wallet as any).payer as Keypair;

  const agentA = Keypair.generate();
  const agentB = Keypair.generate();
  const agentC = Keypair.generate(); // attacker-controlled vault

  const vaultPda = (auth: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("bundie_vault"), auth.toBuffer()],
      program.programId,
    )[0];

  const marketPda = (strategy: PublicKey, marketId: BN) => {
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(BigInt(marketId.toString()));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("market"), strategy.toBuffer(), idBuf],
      program.programId,
    )[0];
  };

  const childPda = (seed: string, market: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(seed), market.toBuffer()],
      program.programId,
    )[0];

  let collateralMint: PublicKey;
  let vaultA: PublicKey;
  let vaultB: PublicKey;
  let vaultC: PublicKey;
  let marketKey: PublicKey;
  let marketVault: PublicKey;
  let yesMint: PublicKey;
  let noMint: PublicKey;
  let marketId: BN;
  let strategyA: PublicKey;
  let strategyB: PublicKey;

  before(async () => {
    const fundIx = (kp: Keypair) =>
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: kp.publicKey,
        lamports: 200_000_000,
      });
    const tx = new Transaction().add(fundIx(agentA), fundIx(agentB), fundIx(agentC));
    await provider.sendAndConfirm(tx, []);

    collateralMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6,
    );

    vaultA = vaultPda(agentA.publicKey);
    vaultB = vaultPda(agentB.publicKey);
    vaultC = vaultPda(agentC.publicKey);

    strategyA = Keypair.generate().publicKey;
    strategyB = Keypair.generate().publicKey;

    marketId = new BN(Date.now() + 1);
    marketKey = marketPda(strategyA, marketId);
    marketVault = childPda("vault", marketKey);
    yesMint = childPda("yes_mint", marketKey);
    noMint = childPda("no_mint", marketKey);

    // init three BundieVaults at the same baseline NAV
    for (const [auth, vault] of [
      [agentA, vaultA],
      [agentB, vaultB],
      [agentC, vaultC],
    ] as const) {
      await program.methods
        .initVault(new BN(BASELINE_NAV))
        .accounts({
          authority: auth.publicKey,
          vault,
          systemProgram: SystemProgram.programId,
        })
        .signers([auth])
        .rpc();
    }

    // create kind=2 market pinned to agentA + agentB
    const currentSlot = await provider.connection.getSlot();
    const resolutionSlot = currentSlot + 30;
    const payload = Buffer.alloc(MARKET_PAYLOAD_LEN);

    await program.methods
      .createMarketV2(
        "Will agent A outperform agent B?",
        marketId,
        MARKET_KIND_RELATIVE,
        Array.from(payload),
        new BN(resolutionSlot),
        new BN(5_000_000),
        100,
        new BN(BASELINE_NAV),
        new BN(BASELINE_NAV),
      )
      .accounts({
        creator: payer.publicKey,
        market: marketKey,
        strategy: strategyA,
        strategyB,
        collateralMint,
        vault: marketVault,
        yesMint,
        noMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        targetVaultA: vaultA,
        targetVaultB: vaultB,
      })
      .rpc();

    // commit divergent NAVs so resolution would otherwise succeed
    const digest = Buffer.alloc(32, 1);
    await program.methods
      .commitNav(new BN(NAV_AGENT_A), new BN(1), Array.from(digest))
      .accounts({ authority: agentA.publicKey, vault: vaultA })
      .signers([agentA])
      .rpc();
    await program.methods
      .commitNav(new BN(NAV_AGENT_B), new BN(1), Array.from(digest))
      .accounts({ authority: agentB.publicKey, vault: vaultB })
      .signers([agentB])
      .rpc();

    // wait past resolution slot
    let currentSlotInner = await provider.connection.getSlot();
    while (currentSlotInner < resolutionSlot) {
      await new Promise((r) => setTimeout(r, 400));
      currentSlotInner = await provider.connection.getSlot();
    }
  });

  it("resolve rejects an attacker-substituted target_vault_a", async () => {
    let threw = false;
    try {
      await program.methods
        .resolveMarketV2()
        .accounts({
          resolver: payer.publicKey,
          market: marketKey,
          dataA: SystemProgram.programId,
          dataB: SystemProgram.programId,
          // attack: substitute agentC's vault for agentA's vault
          targetVaultA: vaultC,
          targetVaultB: vaultB,
        })
        .rpc();
    } catch (err: any) {
      threw = true;
      const msg = JSON.stringify(err?.error ?? err?.logs ?? err?.message ?? err);
      expect(msg).to.match(/WrongTargetVault/);
    }
    expect(threw, "resolve must fail when target_vault_a is substituted").to.equal(true);

    // Market must still be Active (untouched by the failed tx).
    const market = await program.account.market.fetch(marketKey);
    expect(market.status).to.deep.equal({ active: {} });
  });
});

/**
 * Tie / loss test for kind=2: agent A's NAV is FLAT and agent B's NAV
 * grows. The resolver must pick NO (agent A did not outperform).
 */
describe("NAV-based market resolution — kind=2 NO outcome", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program: Program = workspace.PredictionMarket;
  const payer = (provider.wallet as any).payer as Keypair;

  const agentA = Keypair.generate();
  const agentB = Keypair.generate();

  const vaultPda = (auth: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("bundie_vault"), auth.toBuffer()],
      program.programId,
    )[0];

  const marketPda = (strategy: PublicKey, marketId: BN) => {
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(BigInt(marketId.toString()));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("market"), strategy.toBuffer(), idBuf],
      program.programId,
    )[0];
  };

  const childPda = (seed: string, market: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from(seed), market.toBuffer()],
      program.programId,
    )[0];

  let collateralMint: PublicKey;
  let vaultA: PublicKey;
  let vaultB: PublicKey;
  let marketKey: PublicKey;
  let marketVault: PublicKey;
  let yesMint: PublicKey;
  let noMint: PublicKey;
  let marketId: BN;
  let strategyA: PublicKey;
  let strategyB: PublicKey;

  before(async () => {
    const fundIx = (kp: Keypair) =>
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: kp.publicKey,
        lamports: 200_000_000,
      });
    const tx = new Transaction().add(fundIx(agentA), fundIx(agentB));
    await provider.sendAndConfirm(tx, []);

    collateralMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6,
    );

    vaultA = vaultPda(agentA.publicKey);
    vaultB = vaultPda(agentB.publicKey);
    strategyA = Keypair.generate().publicKey;
    strategyB = Keypair.generate().publicKey;

    marketId = new BN(Date.now() + 2);
    marketKey = marketPda(strategyA, marketId);
    marketVault = childPda("vault", marketKey);
    yesMint = childPda("yes_mint", marketKey);
    noMint = childPda("no_mint", marketKey);

    for (const [auth, vault] of [
      [agentA, vaultA],
      [agentB, vaultB],
    ] as const) {
      await program.methods
        .initVault(new BN(BASELINE_NAV))
        .accounts({
          authority: auth.publicKey,
          vault,
          systemProgram: SystemProgram.programId,
        })
        .signers([auth])
        .rpc();
    }

    const currentSlot = await provider.connection.getSlot();
    const resolutionSlot = currentSlot + 30;
    const payload = Buffer.alloc(MARKET_PAYLOAD_LEN);

    await program.methods
      .createMarketV2(
        "Will agent A outperform agent B (NO case)?",
        marketId,
        MARKET_KIND_RELATIVE,
        Array.from(payload),
        new BN(resolutionSlot),
        new BN(5_000_000),
        100,
        new BN(BASELINE_NAV),
        new BN(BASELINE_NAV),
      )
      .accounts({
        creator: payer.publicKey,
        market: marketKey,
        strategy: strategyA,
        strategyB,
        collateralMint,
        vault: marketVault,
        yesMint,
        noMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        targetVaultA: vaultA,
        targetVaultB: vaultB,
      })
      .rpc();

    // Agent A flat (commit baseline again), agent B up +10%.
    const digest = Buffer.alloc(32, 1);
    await program.methods
      .commitNav(new BN(BASELINE_NAV), new BN(1), Array.from(digest))
      .accounts({ authority: agentA.publicKey, vault: vaultA })
      .signers([agentA])
      .rpc();
    await program.methods
      .commitNav(new BN(NAV_AGENT_A), new BN(1), Array.from(digest)) // 1_100_000 = +10%
      .accounts({ authority: agentB.publicKey, vault: vaultB })
      .signers([agentB])
      .rpc();

    let currentSlotInner = await provider.connection.getSlot();
    while (currentSlotInner < resolutionSlot) {
      await new Promise((r) => setTimeout(r, 400));
      currentSlotInner = await provider.connection.getSlot();
    }
  });

  it("resolves NO when agent A does not strictly beat agent B", async () => {
    await program.methods
      .resolveMarketV2()
      .accounts({
        resolver: payer.publicKey,
        market: marketKey,
        dataA: SystemProgram.programId,
        dataB: SystemProgram.programId,
        targetVaultA: vaultA,
        targetVaultB: vaultB,
      })
      .rpc();

    const resolved = await program.account.market.fetch(marketKey);
    expect(resolved.status).to.deep.equal({ resolved: {} });
    expect(resolved.outcome).to.deep.equal({ no: {} });
  });
});
