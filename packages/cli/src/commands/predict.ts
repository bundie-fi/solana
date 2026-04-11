/**
 * predict — buy YES or NO shares on a prediction market.
 *
 * Uses the prediction-market program's buy_shares instruction (Anchor 1.0).
 * Discriminator = sha256("global:buy_shares")[0..8] = [40,239,138,154,8,37,106,108]
 * Args (Borsh): outcome:u8 (0=Yes, 1=No), amount:u64
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { PROGRAM_IDS } from '../constants.js';
import { fetchMarket } from '../accounts.js';
import { DISC } from '../borsh.js';
import { yesMintPDA, noMintPDA, vaultPDA } from '../pda.js';

const PM_PROGRAM = PROGRAM_IDS.predictionMarket;

export async function predict(
  conn: Connection,
  payer: Keypair,
  marketAddress: PublicKey,
  side: 'yes' | 'no',
  amountUsdc: number,
): Promise<string> {
  const market = await fetchMarket(conn, marketAddress);
  const outcome = side === 'yes' ? 0 : 1; // Borsh enum: 0=Yes, 1=No
  const amount = BigInt(Math.round(amountUsdc * 1_000_000));

  const [yesMint]  = yesMintPDA(marketAddress);
  const [noMint]   = noMintPDA(marketAddress);
  const [vault]    = vaultPDA(marketAddress);

  const buyerCollateral = getAssociatedTokenAddressSync(market.collateralMint, payer.publicKey);
  const buyerYesAta     = getAssociatedTokenAddressSync(yesMint, payer.publicKey);
  const buyerNoAta      = getAssociatedTokenAddressSync(noMint,  payer.publicKey);

  // Instruction data: [disc(8), outcome(1), amount(8)] = 17 bytes
  const data = Buffer.allocUnsafe(17);
  DISC.buyShares.copy(data, 0);        // 8-byte Anchor discriminator
  data.writeUInt8(outcome, 8);         // outcome enum u8
  data.writeBigUInt64LE(amount, 9);    // amount u64

  const ix = new TransactionInstruction({
    programId: PM_PROGRAM,
    keys: [
      { pubkey: payer.publicKey,             isSigner: true,  isWritable: true  }, // buyer
      { pubkey: marketAddress,               isSigner: false, isWritable: true  }, // market
      { pubkey: yesMint,                     isSigner: false, isWritable: true  }, // yes_mint
      { pubkey: noMint,                      isSigner: false, isWritable: true  }, // no_mint
      { pubkey: vault,                       isSigner: false, isWritable: true  }, // vault
      { pubkey: buyerCollateral,             isSigner: false, isWritable: true  }, // buyer_collateral
      { pubkey: buyerYesAta,                 isSigner: false, isWritable: true  }, // buyer_yes_ata
      { pubkey: buyerNoAta,                  isSigner: false, isWritable: true  }, // buyer_no_ata
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, tx, [payer]);

  // Compute current implied probability (simple 50/50 estimate if market is fresh)
  const total = market.yesShares + market.noShares + amount;
  const implied = total > 0n
    ? Number(side === 'yes' ? market.yesShares + amount : market.noShares + amount) / Number(total)
    : 0.5;

  console.log(`  market:   ${marketAddress.toBase58()}`);
  console.log(`  side:     ${side.toUpperCase()}`);
  console.log(`  amount:   ${amountUsdc} USDC`);
  console.log(`  implied:  ${(implied * 100).toFixed(1)}%`);
  console.log(`  tx:       ${sig}`);
  return sig;
}
