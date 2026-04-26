/**
 * bundie-vault.spec.ts — Lifecycle tests for BundieVault PDA.
 *
 * Covers Phase A of the vault-NAV-resolution migration:
 *   1. init_vault creates a vault at epoch 0
 *   2. commit_nav with epoch=1 succeeds and bumps state
 *   3. stale epoch reverts with StaleNavEpoch
 *   4. non-authority commit reverts (has_one / seeds / signer mismatch)
 *
 * Phase J extended `init_vault` with `owner_wallet` + `treasury_mint`
 * args plus a treasury ATA. These tests now spin up a throwaway SPL
 * mint per `init_vault` call and pass the matching ATA accounts; the
 * monotonic-epoch and has_one assertions remain intact.
 *
 * The codebase pins anchor toolchain v1.0.0, which generates IDL consumed
 * by `@anchor-lang/core`. Mocha 10 loads `.ts` files via the ESM loader,
 * but `@anchor-lang/core` only exposes named exports through its CJS
 * entry — so we import its default export and destructure, matching the
 * pattern Node's own diagnostic suggests when the named-export form
 * fails. `BN` comes straight from `bn.js` (which has a proper default
 * export) to avoid the same CJS interop trap.
 */
import anchorPkg from "@anchor-lang/core";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";

const { AnchorProvider, setProvider, workspace } = anchorPkg as any;
type Program = any;

describe("bundie_vault lifecycle", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program: Program = workspace.PredictionMarket;
  const authority = Keypair.generate();
  let treasuryMint: PublicKey;
  let treasuryAta: PublicKey;

  const vaultPda = (auth: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("bundie_vault"), auth.toBuffer()],
      program.programId,
    )[0];

  before(async () => {
    const sig = await provider.connection.requestAirdrop(
      authority.publicKey,
      2_000_000_000,
    );
    await provider.connection.confirmTransaction(sig);

    // Throwaway 6-decimal SPL mint to stand in for bUSD. The mint
    // authority is the test authority — Phase J only needs a mint that
    // exists; balance flows are exercised in vault-treasury.spec.ts.
    treasuryMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6,
    );
    const vault = vaultPda(authority.publicKey);
    treasuryAta = getAssociatedTokenAddressSync(treasuryMint, vault, true);
  });

  it("init_vault creates a vault at epoch 0", async () => {
    const [vault, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("bundie_vault"), authority.publicKey.toBuffer()],
      program.programId,
    );
    await program.methods
      .initVault(new BN(1_000_000), authority.publicKey, treasuryMint)
      .accounts({
        authority: authority.publicKey,
        vault,
        treasuryMint,
        treasuryAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    const acc = await program.account.bundieVault.fetch(vault);
    expect(acc.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(acc.ownerWallet.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(acc.treasuryMint.toBase58()).to.equal(treasuryMint.toBase58());
    expect(acc.treasuryAta.toBase58()).to.equal(treasuryAta.toBase58());
    expect(acc.navLamports.toNumber()).to.equal(1_000_000);
    expect(acc.navEpoch.toNumber()).to.equal(0);
    expect(acc.navSlot.toNumber()).to.be.greaterThan(0);
    expect(acc.bump).to.equal(expectedBump);
  });

  it("commit_nav with epoch=1 succeeds", async () => {
    const vault = vaultPda(authority.publicKey);
    const digest = Buffer.alloc(32, 7);
    const before = await program.account.bundieVault.fetch(vault);
    await program.methods
      .commitNav(new BN(1_050_000), new BN(1), Array.from(digest))
      .accounts({ authority: authority.publicKey, vault })
      .signers([authority])
      .rpc();

    const after = await program.account.bundieVault.fetch(vault);
    expect(after.navLamports.toNumber()).to.equal(1_050_000);
    expect(after.navEpoch.toNumber()).to.equal(1);
    expect(
      Buffer.from(after.commitDigest).every((b: number) => b === 7),
    ).to.equal(true);
    expect(after.navSlot.toNumber()).to.be.gte(before.navSlot.toNumber());
  });

  it("commit_nav with stale epoch reverts with StaleNavEpoch", async () => {
    const vault = vaultPda(authority.publicKey);
    const digest = Buffer.alloc(32, 8);
    try {
      await program.methods
        .commitNav(new BN(2_000_000), new BN(1), Array.from(digest))
        .accounts({ authority: authority.publicKey, vault })
        .signers([authority])
        .rpc();
      throw new Error("expected revert");
    } catch (e: any) {
      expect(String(e)).to.include("StaleNavEpoch");
    }
  });

  it("commit_nav from non-authority reverts", async () => {
    const vault = vaultPda(authority.publicKey);
    const intruder = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      intruder.publicKey,
      1_000_000_000,
    );
    await provider.connection.confirmTransaction(sig);
    const digest = Buffer.alloc(32, 9);
    try {
      await program.methods
        .commitNav(new BN(2_000_000), new BN(2), Array.from(digest))
        .accounts({ authority: intruder.publicKey, vault })
        .signers([intruder])
        .rpc();
      throw new Error("expected revert");
    } catch (e: any) {
      expect(String(e)).to.match(/Unauthorized|ConstraintSeeds|has_one/);
    }
  });
});
