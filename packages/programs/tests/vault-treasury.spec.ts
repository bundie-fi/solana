/**
 * vault-treasury.spec.ts — Phase J coverage for the BundieVault
 * treasury extension.
 *
 * Exercises:
 *   1. init_vault wires owner_wallet + treasury_mint + treasury_ata
 *      and the freshly-minted treasury ATA starts at zero balance.
 *   2. deposit_to_vault moves SPL into treasury_ata.
 *   3. close_vault drains treasury → owner_ata, closes the treasury
 *      ATA, and closes the BundieVault PDA itself.
 *   4. close_vault from a non-owner reverts (UnauthorizedVaultClose
 *      address constraint OR a seeds/has_one mismatch — both are
 *      acceptable rejections).
 *   5. deposit_to_vault with amount=0 reverts with InvalidPayload.
 *
 * Pattern mirrors bundie-vault.spec.ts: destructure the @anchor-lang/core
 * default export to dodge the CJS named-export interop trap, BN comes
 * from bn.js directly.
 */
import anchorPkg from "@anchor-lang/core";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

const { AnchorProvider, setProvider, workspace } = anchorPkg as any;
type Program = any;

const DEPOSIT_AMOUNT = 50_000_000; // 50 tokens at 6 decimals

describe("bundie_vault treasury (Phase J)", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program: Program = workspace.PredictionMarket;

  // userKp doubles as authority + owner_wallet for the happy path.
  const userKp = Keypair.generate();
  let treasuryMint: PublicKey;
  let vault: PublicKey;
  let treasuryAta: PublicKey;
  let userAta: PublicKey;

  const vaultPda = (auth: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("bundie_vault"), auth.toBuffer()],
      program.programId,
    )[0];

  before(async () => {
    const sig = await provider.connection.requestAirdrop(
      userKp.publicKey,
      3_000_000_000,
    );
    await provider.connection.confirmTransaction(sig);

    // 6dp test mint stands in for bUSD; userKp is mint authority so
    // we can mint deposit funds straight into the user's ATA.
    treasuryMint = await createMint(
      provider.connection,
      userKp,
      userKp.publicKey,
      null,
      6,
    );
    userAta = await createAssociatedTokenAccount(
      provider.connection,
      userKp,
      treasuryMint,
      userKp.publicKey,
    );
    await mintTo(
      provider.connection,
      userKp,
      treasuryMint,
      userAta,
      userKp,
      DEPOSIT_AMOUNT,
    );

    vault = vaultPda(userKp.publicKey);
    treasuryAta = getAssociatedTokenAddressSync(treasuryMint, vault, true);
  });

  it("init_vault wires treasury fields and ATA starts empty", async () => {
    await program.methods
      .initVault(new BN(1_000_000), userKp.publicKey, treasuryMint)
      .accounts({
        authority: userKp.publicKey,
        vault,
        treasuryMint,
        treasuryAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([userKp])
      .rpc();

    const acc = await program.account.bundieVault.fetch(vault);
    expect(acc.ownerWallet.toBase58()).to.equal(userKp.publicKey.toBase58());
    expect(acc.treasuryMint.toBase58()).to.equal(treasuryMint.toBase58());
    expect(acc.treasuryAta.toBase58()).to.equal(treasuryAta.toBase58());

    const ata = await getAccount(provider.connection, treasuryAta);
    expect(ata.amount.toString()).to.equal("0");
  });

  it("deposit_to_vault increases treasury balance", async () => {
    await program.methods
      .depositToVault(new BN(DEPOSIT_AMOUNT))
      .accounts({
        depositor: userKp.publicKey,
        depositorAta: userAta,
        vault,
        treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userKp])
      .rpc();

    const ata = await getAccount(provider.connection, treasuryAta);
    expect(ata.amount.toString()).to.equal(String(DEPOSIT_AMOUNT));
  });

  it("deposit_to_vault with amount=0 reverts", async () => {
    try {
      await program.methods
        .depositToVault(new BN(0))
        .accounts({
          depositor: userKp.publicKey,
          depositorAta: userAta,
          vault,
          treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([userKp])
        .rpc();
      throw new Error("expected revert");
    } catch (e: any) {
      expect(String(e)).to.include("InvalidPayload");
    }
  });

  it("close_vault from a non-owner reverts", async () => {
    const intruder = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      intruder.publicKey,
      1_000_000_000,
    );
    await provider.connection.confirmTransaction(sig);
    // Intruder also needs an ATA to satisfy the Accounts struct, even
    // though we expect the call to bail before any transfer happens.
    const intruderAta = await createAssociatedTokenAccount(
      provider.connection,
      intruder,
      treasuryMint,
      intruder.publicKey,
    );
    try {
      await program.methods
        .closeVault()
        .accounts({
          owner: intruder.publicKey,
          vault,
          treasuryAta,
          ownerAta: intruderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([intruder])
        .rpc();
      throw new Error("expected revert");
    } catch (e: any) {
      expect(String(e)).to.match(
        /UnauthorizedVaultClose|ConstraintAddress|ConstraintSeeds|has_one/,
      );
    }
  });

  it("close_vault drains treasury and closes accounts", async () => {
    const userBefore = await getAccount(provider.connection, userAta);
    expect(userBefore.amount.toString()).to.equal("0");

    await program.methods
      .closeVault()
      .accounts({
        owner: userKp.publicKey,
        vault,
        treasuryAta,
        ownerAta: userAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userKp])
      .rpc();

    // owner_ata grew by full treasury balance
    const userAfter = await getAccount(provider.connection, userAta);
    expect(userAfter.amount.toString()).to.equal(String(DEPOSIT_AMOUNT));

    // treasury_ata closed
    const treasuryInfo = await provider.connection.getAccountInfo(treasuryAta);
    expect(treasuryInfo).to.equal(null);

    // BundieVault PDA closed
    const vaultInfo = await provider.connection.getAccountInfo(vault);
    expect(vaultInfo).to.equal(null);
  });
});
