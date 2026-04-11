import { PublicKey } from '@solana/web3.js';
import { PROGRAM_IDS } from './constants.js';

const ST = PROGRAM_IDS.strategyToken;
const PM = PROGRAM_IDS.predictionMarket;

/** strategy PDA: seeds = ["strategy", creator, name32] */
export function strategyPDA(creator: PublicKey, name32: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('strategy'), creator.toBuffer(), name32],
    ST,
  );
}

/** wallet PDA: seeds = ["wallet", strategy] */
export function walletPDA(strategy: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('wallet'), strategy.toBuffer()],
    ST,
  );
}

/** nav oracle PDA: seeds = ["nav", strategy] */
export function navOraclePDA(strategy: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('nav'), strategy.toBuffer()],
    ST,
  );
}

/** market PDA: seeds = ["market", strategy, market_id_le8] */
export function marketPDA(strategy: PublicKey, marketId: bigint): [PublicKey, number] {
  const idBuf = Buffer.allocUnsafe(8);
  idBuf.writeBigUInt64LE(marketId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), strategy.toBuffer(), idBuf],
    PM,
  );
}

/** vault PDA: seeds = ["vault", market] */
export function vaultPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), market.toBuffer()],
    PM,
  );
}

/** yes_mint PDA: seeds = ["yes_mint", market] */
export function yesMintPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('yes_mint'), market.toBuffer()],
    PM,
  );
}

/** no_mint PDA: seeds = ["no_mint", market] */
export function noMintPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('no_mint'), market.toBuffer()],
    PM,
  );
}

/** zero-pad a UTF-8 name string to exactly 32 bytes */
export function encodeName(name: string): Buffer {
  const buf = Buffer.alloc(32, 0);
  const encoded = Buffer.from(name, 'utf8');
  encoded.copy(buf, 0, 0, Math.min(32, encoded.length));
  return buf;
}
