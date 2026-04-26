/**
 * bundie-vault.spec.ts — Lifecycle tests for BundieVault PDA.
 *
 * Covers Phase A of the vault-NAV-resolution migration:
 *   1. init_vault creates a vault at epoch 0
 *   2. commit_nav with epoch=1 succeeds and bumps state
 *   3. stale epoch reverts with StaleNavEpoch
 *   4. non-authority commit reverts (has_one / seeds / signer mismatch)
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
import { expect } from "chai";

const { AnchorProvider, setProvider, workspace } = anchorPkg as any;
type Program = any;

describe("bundie_vault lifecycle", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program: Program = workspace.PredictionMarket;
  const authority = Keypair.generate();

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
  });

  it("init_vault creates a vault at epoch 0", async () => {
    const vault = vaultPda(authority.publicKey);
    await program.methods
      .initVault(new BN(1_000_000))
      .accounts({
        authority: authority.publicKey,
        vault,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const acc = await program.account.bundieVault.fetch(vault);
    expect(acc.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(acc.navLamports.toNumber()).to.equal(1_000_000);
    expect(acc.navEpoch.toNumber()).to.equal(0);
  });

  it("commit_nav with epoch=1 succeeds", async () => {
    const vault = vaultPda(authority.publicKey);
    const digest = Buffer.alloc(32, 7);
    await program.methods
      .commitNav(new BN(1_050_000), new BN(1), Array.from(digest))
      .accounts({ authority: authority.publicKey, vault })
      .signers([authority])
      .rpc();

    const acc = await program.account.bundieVault.fetch(vault);
    expect(acc.navLamports.toNumber()).to.equal(1_050_000);
    expect(acc.navEpoch.toNumber()).to.equal(1);
    expect(
      Buffer.from(acc.commitDigest).every((b: number) => b === 7),
    ).to.equal(true);
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
