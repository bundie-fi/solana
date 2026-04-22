/**
 * create-strategy — creates an Agent strategy on the strategy-token program.
 *
 * Instruction 0: create_strategy
 *   data = [ 0x00 (disc) | strategy_type:u8 | fee_bps:u16le | min_deposit:u64le | name:[u8;32] ]
 *
 * If --deposit > 0, a second transaction calls buy_shares (instruction 1).
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
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
import { strategyPDA, walletPDA, navOraclePDA, encodeName } from '../pda.js';

const ST_PROGRAM = PROGRAM_IDS.strategyToken;

/** Known protocol program IDs (mainnet + devnet share these) */
const PROTOCOL_MAP: Record<string, string> = {
  kamino:    'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
  marginfi:  'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
  jupiter:   'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
};

/** On-chain strategy_type discriminator. Must match state::strategy in the pinocchio program. */
export const STRATEGY_TYPE_YIELD = 0;
export const STRATEGY_TYPE_AGENT = 1;

/** Devnet USDC mint (Circle) */
export const DEVNET_USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

export interface CreateStrategyOptions {
  name: string;
  protocol: string;
  feeBps: number;
  deposit: number;
  minDeposit: number;
  usdcMint: string;
  /** 'yield' (0) routes deposits through Beethoven CPI; 'agent' (1) keeps funds in the wallet PDA. */
  strategyType?: 'yield' | 'agent';
  keypair?: string;
  rpc?: string;
}

export async function createStrategy(
  conn: Connection,
  payer: Keypair,
  opts: CreateStrategyOptions,
): Promise<{ strategyAddress: PublicKey; mintAddress: PublicKey }> {
  const { name, protocol, feeBps, deposit, minDeposit, usdcMint } = opts;
  const strategyType = opts.strategyType === 'agent' ? STRATEGY_TYPE_AGENT : STRATEGY_TYPE_YIELD;

  // Resolve protocol address
  const protocolKey = new PublicKey(
    PROTOCOL_MAP[protocol.toLowerCase()] ?? protocol,
  );
  const depositMint = new PublicKey(usdcMint);

  // Encode name as [u8; 32]
  const name32 = encodeName(name);

  // Derive PDAs
  const [strategyKey] = strategyPDA(payer.publicKey, name32);
  const [walletKey] = walletPDA(strategyKey);
  const [navKey] = navOraclePDA(strategyKey);

  // Fresh mint keypair (strategy shares)
  const mintKp = Keypair.generate();

  // ── Build create_strategy instruction ──
  // data layout: [disc=0, strategy_type u8, fee_bps u16le, min_deposit u64le, name[32]]
  const ixData = Buffer.allocUnsafe(1 + 1 + 2 + 8 + 32);
  let off = 0;
  ixData.writeUInt8(0, off++);                             // disc: instruction 0
  ixData.writeUInt8(strategyType, off++);                  // strategy_type: 0 = YIELD, 1 = AGENT
  ixData.writeUInt16LE(feeBps, off); off += 2;             // fee_bps
  ixData.writeBigUInt64LE(BigInt(minDeposit * 1_000_000), off); off += 8; // min_deposit (USDC base units)
  name32.copy(ixData, off);                                // name [u8; 32]

  const createIx = new TransactionInstruction({
    programId: ST_PROGRAM,
    keys: [
      { pubkey: payer.publicKey, isSigner: true,  isWritable: true  }, // creator
      { pubkey: strategyKey,     isSigner: false, isWritable: true  }, // strategy
      { pubkey: mintKp.publicKey,isSigner: true,  isWritable: true  }, // mint
      { pubkey: walletKey,       isSigner: false, isWritable: false }, // wallet
      { pubkey: navKey,          isSigner: false, isWritable: true  }, // nav_oracle
      { pubkey: depositMint,     isSigner: false, isWritable: false }, // deposit_mint (USDC)
      { pubkey: protocolKey,     isSigner: false, isWritable: false }, // protocol
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // reserve placeholder
      { pubkey: TOKEN_PROGRAM_ID,       isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,     isSigner: false, isWritable: false },
    ],
    data: ixData,
  });

  const tx1 = new Transaction().add(createIx);
  const sig1 = await sendAndConfirmTransaction(conn, tx1, [payer, mintKp]);
  console.log(`  create_strategy: ${sig1}`);
  console.log(`  strategy: ${strategyKey.toBase58()}`);
  console.log(`  mint:     ${mintKp.publicKey.toBase58()}`);

  // ── Optional initial deposit via buy_shares (instruction 1) ──
  if (deposit > 0) {
    const depositAmount = BigInt(Math.round(deposit * 1_000_000)); // USDC → base units

    const buyerSharesAta = getAssociatedTokenAddressSync(mintKp.publicKey, payer.publicKey);
    const walletTokenAta = getAssociatedTokenAddressSync(depositMint, walletKey, true);
    const buyerTokenAta  = getAssociatedTokenAddressSync(depositMint, payer.publicKey);

    // data layout: [disc=1, amount u64le]
    const buyData = Buffer.allocUnsafe(9);
    buyData.writeUInt8(1, 0);                         // disc: instruction 1
    buyData.writeBigUInt64LE(depositAmount, 1);       // amount

    const buyIx = new TransactionInstruction({
      programId: ST_PROGRAM,
      keys: [
        { pubkey: payer.publicKey,      isSigner: true,  isWritable: true  }, // buyer
        { pubkey: strategyKey,          isSigner: false, isWritable: true  }, // strategy
        { pubkey: mintKp.publicKey,     isSigner: false, isWritable: true  }, // mint
        { pubkey: buyerSharesAta,       isSigner: false, isWritable: true  }, // buyer_shares_ata
        { pubkey: walletKey,            isSigner: false, isWritable: false }, // wallet
        { pubkey: walletTokenAta,       isSigner: false, isWritable: true  }, // wallet_token_ata
        { pubkey: buyerTokenAta,        isSigner: false, isWritable: true  }, // buyer_token_ata
        { pubkey: TOKEN_PROGRAM_ID,     isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: depositMint,          isSigner: false, isWritable: false }, // deposit_mint
      ],
      data: buyData,
    });

    const tx2 = new Transaction().add(buyIx);
    const sig2 = await sendAndConfirmTransaction(conn, tx2, [payer]);
    console.log(`  buy_shares:      ${sig2}`);
    console.log(`  deposited:       ${deposit} USDC`);
  }

  return { strategyAddress: strategyKey, mintAddress: mintKp.publicKey };
}
