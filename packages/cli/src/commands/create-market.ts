/**
 * create-market — open a prediction market on an existing strategy.
 *
 * Uses the prediction-market program's create_market instruction.
 * Discriminator = sha256("global:create_market")[0..8]
 *
 * Args (Borsh):
 *   question: String  (length-prefixed u32 + utf-8 bytes, max 128)
 *   market_id: u64
 *   market_type: u8   (0 = Absolute, 1 = Relative)
 *   threshold_bps: u64
 *   resolution_slot: u64
 *   initial_subsidy: u64
 *   fee_bps: u16
 *   initial_nav_per_share: u64
 *   initial_nav_per_share_b: u64
 *
 * Demo Scene 2/3 of the v5 storyboard: the market-maker agent runs this
 * against a strategy the strategy-creator agent just minted.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PROGRAM_IDS } from '../constants.js';
import { fetchStrategy } from '../accounts.js';
import { DISC } from '../borsh.js';
import { marketPDA, vaultPDA, yesMintPDA, noMintPDA } from '../pda.js';

const PM_PROGRAM = PROGRAM_IDS.predictionMarket;
const DEVNET_USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const MARKET_TYPE_ABSOLUTE = 0;
const MARKET_TYPE_RELATIVE = 1;

export interface CreateMarketOptions {
  strategy: PublicKey;
  question: string;
  thresholdBps: number;
  resolutionSlot: bigint;
  initialSubsidy: number; // USDC units
  feeBps: number;
  strategyB?: PublicKey; // for Relative markets
  collateralMint?: PublicKey; // defaults to devnet USDC
}

export async function createMarket(
  conn: Connection,
  creator: Keypair,
  opts: CreateMarketOptions,
): Promise<{ market: PublicKey; marketId: bigint; sig: string }> {
  if (opts.question.length > 128) {
    throw new Error(`Question too long: ${opts.question.length} chars (max 128)`);
  }
  if (opts.initialSubsidy <= 0) {
    throw new Error('Initial subsidy must be positive');
  }

  const collateralMint = opts.collateralMint ?? DEVNET_USDC;
  const marketType = opts.strategyB ? MARKET_TYPE_RELATIVE : MARKET_TYPE_ABSOLUTE;

  // Read strategy current NAV for initial_nav_per_share
  const strategy = await fetchStrategy(conn, opts.strategy);
  const initialNavPerShare = strategy.currentNav;

  let initialNavPerShareB = 0n;
  if (opts.strategyB) {
    const strategyB = await fetchStrategy(conn, opts.strategyB);
    initialNavPerShareB = strategyB.currentNav;
    if (initialNavPerShareB === 0n) {
      throw new Error('Strategy B has no NAV yet — cannot open Relative market');
    }
  }

  const marketId = BigInt(Date.now());
  const [market] = marketPDA(opts.strategy, marketId);
  const [vault] = vaultPDA(market);
  const [yesMint] = yesMintPDA(market);
  const [noMint] = noMintPDA(market);

  // Instruction data: disc(8) + borsh(args)
  const questionBuf = Buffer.from(opts.question, 'utf8');
  const subsidy = BigInt(Math.round(opts.initialSubsidy * 1_000_000));

  // Compute total size: disc + u32 len + question bytes + 8+1+8+8+8+2+8+8 = fixed 51 + q
  const data = Buffer.alloc(8 + 4 + questionBuf.length + 8 + 1 + 8 + 8 + 8 + 2 + 8 + 8);
  let o = 0;
  DISC.createMarket.copy(data, o); o += 8;
  data.writeUInt32LE(questionBuf.length, o); o += 4;
  questionBuf.copy(data, o); o += questionBuf.length;
  data.writeBigUInt64LE(marketId, o); o += 8;
  data.writeUInt8(marketType, o); o += 1;
  data.writeBigUInt64LE(BigInt(opts.thresholdBps), o); o += 8;
  data.writeBigUInt64LE(opts.resolutionSlot, o); o += 8;
  data.writeBigUInt64LE(subsidy, o); o += 8;
  data.writeUInt16LE(opts.feeBps, o); o += 2;
  data.writeBigUInt64LE(initialNavPerShare, o); o += 8;
  data.writeBigUInt64LE(initialNavPerShareB, o); o += 8;

  const strategyBKey = opts.strategyB ?? SystemProgram.programId;

  const ix = new TransactionInstruction({
    programId: PM_PROGRAM,
    keys: [
      { pubkey: creator.publicKey,        isSigner: true,  isWritable: true  }, // creator
      { pubkey: market,                   isSigner: false, isWritable: true  }, // market PDA
      { pubkey: opts.strategy,            isSigner: false, isWritable: false }, // strategy
      { pubkey: strategyBKey,             isSigner: false, isWritable: false }, // strategy_b
      { pubkey: collateralMint,           isSigner: false, isWritable: false }, // collateral_mint
      { pubkey: vault,                    isSigner: false, isWritable: true  }, // vault
      { pubkey: yesMint,                  isSigner: false, isWritable: true  }, // yes_mint
      { pubkey: noMint,                   isSigner: false, isWritable: true  }, // no_mint
      { pubkey: TOKEN_PROGRAM_ID,         isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,  isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,       isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, tx, [creator]);

  console.log(`  strategy:        ${opts.strategy.toBase58()}`);
  console.log(`  market:          ${market.toBase58()}`);
  console.log(`  market_id:       ${marketId}`);
  console.log(`  type:            ${opts.strategyB ? 'Relative' : 'Absolute'}`);
  console.log(`  threshold:       ${opts.thresholdBps} bps (${opts.thresholdBps / 100}% APY)`);
  console.log(`  resolution_slot: ${opts.resolutionSlot}`);
  console.log(`  initial_subsidy: ${opts.initialSubsidy} USDC`);
  console.log(`  fee:             ${opts.feeBps} bps (${opts.feeBps / 100}%)`);
  console.log(`  tx:              ${sig}`);

  return { market, marketId, sig };
}
