/**
 * buy-shares — buy strategy shares (invest in a strategy).
 *
 * Instruction 1: buy_shares on strategy-token program
 *   data = [ 0x01 (disc) | amount:u64le ]
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
import { fetchStrategy } from '../accounts.js';

const ST_PROGRAM = PROGRAM_IDS.strategyToken;

export async function buyStrategyShares(
  conn: Connection,
  payer: Keypair,
  strategyAddress: PublicKey,
  amountUsdc: number,
): Promise<string> {
  const strategy = await fetchStrategy(conn, strategyAddress);
  const amount = BigInt(Math.round(amountUsdc * 1_000_000));

  const buyerSharesAta = getAssociatedTokenAddressSync(strategy.mint, payer.publicKey);
  const walletTokenAta = getAssociatedTokenAddressSync(strategy.depositMint, strategy.wallet, true);
  const buyerTokenAta  = getAssociatedTokenAddressSync(strategy.depositMint, payer.publicKey);

  const data = Buffer.allocUnsafe(9);
  data.writeUInt8(1, 0);            // disc: buy_shares
  data.writeBigUInt64LE(amount, 1); // amount

  const ix = new TransactionInstruction({
    programId: ST_PROGRAM,
    keys: [
      { pubkey: payer.publicKey,          isSigner: true,  isWritable: true  },
      { pubkey: strategyAddress,          isSigner: false, isWritable: true  },
      { pubkey: strategy.mint,            isSigner: false, isWritable: true  },
      { pubkey: buyerSharesAta,           isSigner: false, isWritable: true  },
      { pubkey: strategy.wallet,          isSigner: false, isWritable: false },
      { pubkey: walletTokenAta,           isSigner: false, isWritable: true  },
      { pubkey: buyerTokenAta,            isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,         isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,  isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: strategy.depositMint,     isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, tx, [payer]);

  console.log(`  strategy: ${strategyAddress.toBase58()}`);
  console.log(`  amount:   ${amountUsdc} USDC`);
  console.log(`  tx:       ${sig}`);
  return sig;
}
