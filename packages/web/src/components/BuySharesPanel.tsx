'use client'

import { useState } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'

const PROGRAM_ID = new PublicKey('Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV')
const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

interface BuySharesPanelProps {
  strategyAddress: string
  mintAddress: string
}

export function BuySharesPanel({
  strategyAddress,
  mintAddress,
}: BuySharesPanelProps) {
  const { connection } = useConnection()
  const wallet = useWallet()
  const { publicKey, sendTransaction, connected } = wallet

  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txSig, setTxSig] = useState<string | null>(null)

  async function handleBuy() {
    if (!publicKey || !connected) return
    const parsed = parseFloat(amount)
    if (isNaN(parsed) || parsed <= 0) {
      setError('Enter a valid USDC amount.')
      return
    }

    setError(null)
    setTxSig(null)
    setLoading(true)

    try {
      const strategyPubkey = new PublicKey(strategyAddress)
      const mintPubkey = new PublicKey(mintAddress)

      // Account 4: wallet PDA
      const [walletPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('wallet'), strategyPubkey.toBuffer()],
        PROGRAM_ID,
      )

      // Derive ATAs
      const buyerSharesAta = await getAssociatedTokenAddress(
        mintPubkey,
        publicKey,
      )
      const walletTokenAta = await getAssociatedTokenAddress(
        USDC_MINT,
        walletPDA,
        true, // allowOwnerOffCurve — PDA owner
      )
      const buyerTokenAta = await getAssociatedTokenAddress(
        USDC_MINT,
        publicKey,
      )

      // Instruction data: discriminator (1) + u64 LE amount
      const amountLamports = BigInt(Math.round(parsed * 1_000_000))
      const data = Buffer.alloc(9)
      data.writeUInt8(1, 0) // buy_shares discriminator
      data.writeBigUInt64LE(amountLamports, 1)

      const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        data,
        keys: [
          { pubkey: publicKey,       isSigner: true,  isWritable: true  }, // 0: buyer
          { pubkey: strategyPubkey,  isSigner: false, isWritable: true  }, // 1: strategy PDA
          { pubkey: mintPubkey,      isSigner: false, isWritable: true  }, // 2: share mint
          { pubkey: buyerSharesAta,  isSigner: false, isWritable: true  }, // 3: buyer_shares_ata
          { pubkey: walletPDA,       isSigner: false, isWritable: false }, // 4: wallet PDA
          { pubkey: walletTokenAta,  isSigner: false, isWritable: true  }, // 5: wallet_token_ata
          { pubkey: buyerTokenAta,   isSigner: false, isWritable: true  }, // 6: buyer_token_ata
          { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false }, // 7
          { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false }, // 8
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 9
          { pubkey: USDC_MINT,                   isSigner: false, isWritable: false }, // 10
        ],
      })

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash()

      const tx = new Transaction({
        feePayer: publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(ix)

      const sig = await sendTransaction(tx, connection)
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight })

      setTxSig(sig)
      setAmount('')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('insufficient')) {
        setError('Insufficient USDC balance.')
      } else if (msg.includes('User rejected')) {
        setError('Transaction rejected.')
      } else {
        setError(msg.slice(0, 120))
      }
    } finally {
      setLoading(false)
    }
  }

  if (!connected) {
    return (
      <div className="rounded-xl border border-neutral-300 bg-surface p-6 flex flex-col items-center gap-4">
        <p className="text-sm text-neutral-700 text-center">
          Connect your wallet to buy shares in this strategy.
        </p>
        <WalletMultiButton className="!bg-amber-600 !text-neutral-900 !font-semibold !rounded-lg !py-2 !px-4 !text-sm hover:!bg-amber-500" />
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-neutral-300 bg-surface p-6 space-y-4">
      <h2 className="font-mono text-[11px] font-medium text-neutral-600 uppercase tracking-[0.18em]">
        Buy shares
      </h2>

      <div className="space-y-1">
        <label htmlFor="usdc-amount" className="text-xs text-neutral-600">
          USDC Amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-700 text-sm pointer-events-none">
            $
          </span>
          <input
            id="usdc-amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={e => {
              setAmount(e.target.value)
              setError(null)
              setTxSig(null)
            }}
            disabled={loading}
            className="w-full rounded-lg border border-neutral-300 bg-background pl-7 pr-4 py-2.5 text-sm text-neutral-900 placeholder-neutral-500 focus:outline-none focus:border-earn-gold/60 transition-colors disabled:opacity-50"
          />
        </div>
      </div>

      <button
        onClick={handleBuy}
        disabled={loading || !amount || parseFloat(amount) <= 0}
        className="w-full rounded-lg bg-amber-600 text-neutral-900 font-semibold py-2.5 text-sm hover:bg-amber-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-neutral-900/30 border-t-neutral-900 rounded-full animate-spin" />
            Confirming…
          </>
        ) : (
          'Buy Shares'
        )}
      </button>

      {error && (
        <p className="text-xs text-danger-400 rounded-lg border border-danger-400/30 bg-danger-400/10 px-3 py-2">
          {error}
        </p>
      )}

      {txSig && (
        <div className="text-xs rounded-lg border border-success-400/30 bg-success-400/10 px-3 py-2 space-y-1">
          <p className="text-success-400 font-medium">Transaction confirmed!</p>
          <a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:underline block truncate font-mono"
          >
            {txSig.slice(0, 20)}…{txSig.slice(-8)}
          </a>
        </div>
      )}

      <p className="text-xs text-neutral-500 text-center">
        Connected: {publicKey?.toBase58().slice(0, 8)}…{publicKey?.toBase58().slice(-4)}
      </p>
    </div>
  )
}
