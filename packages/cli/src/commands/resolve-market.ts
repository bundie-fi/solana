/**
 * resolve-market — permissionless resolve of a prediction market.
 *
 * Any wallet can call this after `market.resolution_slot` is reached. The
 * program reads the strategy's NavOracle account via manual deserialization
 * (no external oracle in the resolution path) and sets market.outcome.
 *
 * Demo Scene 5 of the v5 storyboard.
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
import { fetchMarket } from '../accounts.js';
import { DISC } from '../borsh.js';
import { navOraclePDA } from '../pda.js';

const PM_PROGRAM = PROGRAM_IDS.predictionMarket;

export async function resolveMarket(
  conn: Connection,
  resolver: Keypair,
  marketAddress: PublicKey,
): Promise<{ outcome: 'YES' | 'NO' | 'UNKNOWN'; sig: string }> {
  const market = await fetchMarket(conn, marketAddress);

  const currentSlot = await conn.getSlot('confirmed');
  if (BigInt(currentSlot) < market.resolutionSlot) {
    throw new Error(
      `Market not yet resolvable — resolution_slot=${market.resolutionSlot}, current=${currentSlot}`,
    );
  }
  if (market.status !== 0) {
    throw new Error(`Market is not Active (status=${market.status})`);
  }

  const [navOracle] = navOraclePDA(market.strategy);
  const navOracleB = market.strategyB
    ? navOraclePDA(market.strategyB)[0]
    : SystemProgram.programId;

  // Instruction data: disc only (no args)
  const data = Buffer.from(DISC.resolve);

  const ix = new TransactionInstruction({
    programId: PM_PROGRAM,
    keys: [
      { pubkey: resolver.publicKey, isSigner: true,  isWritable: true  }, // resolver
      { pubkey: marketAddress,      isSigner: false, isWritable: true  }, // market
      { pubkey: navOracle,          isSigner: false, isWritable: false }, // nav_oracle
      { pubkey: navOracleB,         isSigner: false, isWritable: false }, // nav_oracle_b
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, tx, [resolver]);

  // Re-read market to get outcome
  const resolved = await fetchMarket(conn, marketAddress);
  const outcomeLabel: 'YES' | 'NO' | 'UNKNOWN' =
    resolved.outcome === 0 ? 'YES' : resolved.outcome === 1 ? 'NO' : 'UNKNOWN';

  console.log(`  market:   ${marketAddress.toBase58()}`);
  console.log(`  strategy: ${market.strategy.toBase58()}`);
  console.log(`  outcome:  ${outcomeLabel}`);
  console.log(`  tx:       ${sig}`);

  return { outcome: outcomeLabel, sig };
}
