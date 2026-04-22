/**
 * snapshot-positions — permissionless keeper instruction.
 *
 * Calls strategy-token's snapshot_positions (discriminator 5) which reads
 * the Strategy account's current composition (protocol, reserve, portfolio
 * value, shares, NAV) and writes it into the PositionSnapshots PDA.
 *
 * First call for a strategy allocates + initializes the PDA. Subsequent
 * calls must be at least ~24h (216_000 slots) after the previous snapshot,
 * otherwise the program reverts with ERROR_SNAPSHOT_TOO_SOON.
 *
 * v5 §5.6.
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
import { PROGRAM_IDS } from '../constants.js';
import { positionSnapshotsPDA } from '../pda.js';

const ST_PROGRAM = PROGRAM_IDS.strategyToken;

export async function snapshotPositions(
  conn: Connection,
  keeper: Keypair,
  strategy: PublicKey,
): Promise<string> {
  const [snapshots] = positionSnapshotsPDA(strategy);

  // Instruction data: single-byte discriminator (pinocchio style). disc = 5.
  const data = Buffer.from([5]);

  const ix = new TransactionInstruction({
    programId: ST_PROGRAM,
    keys: [
      { pubkey: keeper.publicKey,        isSigner: true,  isWritable: true  }, // keeper
      { pubkey: strategy,                isSigner: false, isWritable: false }, // strategy (read)
      { pubkey: snapshots,               isSigner: false, isWritable: true  }, // position_snapshots PDA
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, tx, [keeper]);

  console.log(`  strategy:  ${strategy.toBase58()}`);
  console.log(`  snapshot:  ${snapshots.toBase58()}`);
  console.log(`  tx:        ${sig}`);
  return sig;
}
