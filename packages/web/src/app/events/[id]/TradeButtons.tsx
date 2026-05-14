"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { isMobileWalletAdapter, sendTxViaMwa } from "@/lib/mwa-tx";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PREDICTION_PROGRAM_ID ??
    "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);

const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_DEVNET_USDC ??
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

// Anchor instruction discriminator for `buy_shares` = sha256("global:buy_shares")[..8].
// Computed once and inlined; the @coral-xyz/anchor client also generates this from the
// IDL, but we ship hand-encoded ix to avoid pulling the full Anchor client into the
// /events client bundle.
const BUY_SHARES_DISCRIMINATOR = Buffer.from([216, 187, 89, 50, 18, 144, 137, 232]);

interface TradeButtonsProps {
  /** Event ID slug from sources.json (used to derive the market PDA). */
  eventId: string;
  /** Pre-resolved market PDA (base58). If absent, the buttons render a
   *  "market not yet deployed" placeholder. */
  marketAddress?: string;
}

export function TradeButtons({ eventId, marketAddress }: TradeButtonsProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, connected, wallet: connectedWallet, sendTransaction } = wallet;
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [amount, setAmount] = useState("5");

  if (!marketAddress) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6 text-center">
        <p className="text-sm text-[var(--de-ink-2)]">
          Market not yet deployed for {eventId}.
        </p>
        <p className="mt-1 text-xs text-[var(--de-ink-3)]">
          Run <code className="font-mono text-[var(--de-lavender)]">./packages/programs/scripts/deploy-events-devnet.sh</code> to bootstrap.
        </p>
      </div>
    );
  }

  if (!connected || !publicKey) {
    return (
      <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6 text-center">
        <p className="mb-4 text-sm text-[var(--de-ink-2)]">
          Connect a wallet to trade.
        </p>
        <WalletMultiButton />
      </div>
    );
  }

  async function handleBuy(side: "yes" | "no") {
    if (!publicKey) return;
    setError(null);
    setTxSig(null);
    setBusy(side);

    try {
      const marketPubkey = new PublicKey(marketAddress!);
      const usdcAmount = parseFloat(amount);
      if (isNaN(usdcAmount) || usdcAmount <= 0) {
        throw new Error("Enter a positive USDC amount");
      }
      const amountLamports = BigInt(Math.round(usdcAmount * 1_000_000));

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), marketPubkey.toBuffer()],
        PROGRAM_ID,
      );
      const [yesMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("yes_mint"), marketPubkey.toBuffer()],
        PROGRAM_ID,
      );
      const [noMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("no_mint"), marketPubkey.toBuffer()],
        PROGRAM_ID,
      );

      const buildIx = async (signer: PublicKey): Promise<TransactionInstruction> => {
        const buyerUsdcAta = await getAssociatedTokenAddress(USDC_MINT, signer);
        const targetMint = side === "yes" ? yesMintPda : noMintPda;
        const buyerSharesAta = await getAssociatedTokenAddress(targetMint, signer, true);

        // ix data: discriminator || Outcome enum (1 byte) || u64 amount
        const data = Buffer.alloc(8 + 1 + 8);
        BUY_SHARES_DISCRIMINATOR.copy(data, 0);
        data.writeUInt8(side === "yes" ? 0 : 1, 8); // Outcome::Yes=0, Outcome::No=1
        data.writeBigUInt64LE(amountLamports, 9);

        return new TransactionInstruction({
          programId: PROGRAM_ID,
          data,
          // NOTE: Account ordering must match `BuyMarketShares` in
          // packages/programs/programs/prediction-market/src/instructions/buy_shares.rs.
          // The full account list is verified at runtime by the program; if the IDL
          // changes, regenerate from anchor build and update this list.
          keys: [
            { pubkey: signer, isSigner: true, isWritable: true },
            { pubkey: marketPubkey, isSigner: false, isWritable: true },
            { pubkey: yesMintPda, isSigner: false, isWritable: true },
            { pubkey: noMintPda, isSigner: false, isWritable: true },
            { pubkey: buyerSharesAta, isSigner: false, isWritable: true },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: buyerUsdcAta, isSigner: false, isWritable: true },
            { pubkey: USDC_MINT, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
        });
      };

      if (isMobileWalletAdapter(connectedWallet?.adapter?.name)) {
        const mwaResult = await sendTxViaMwa({
          connection,
          cluster: "solana:devnet",
          buildTx: async (signer, blockhash) => {
            const { lastValidBlockHeight } = await connection.getLatestBlockhash();
            const ix = await buildIx(signer);
            return new Transaction({
              feePayer: signer,
              blockhash,
              lastValidBlockHeight,
            }).add(ix);
          },
        });
        setTxSig(mwaResult.signature);
      } else {
        const ix = await buildIx(publicKey);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight }).add(ix);
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
        setTxSig(sig);
      }
    } catch (err) {
      setError((err as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6">
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="amount" className="text-xs uppercase tracking-wider text-[var(--de-ink-3)]">
          USDC
        </label>
        <input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-24 rounded-lg border border-[var(--de-line-2)] bg-[var(--de-bg-3)] px-3 py-1.5 font-mono text-sm text-[var(--de-ink)] focus:border-[var(--de-line-3)] focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => handleBuy("yes")}
          className="rounded-xl border border-[var(--de-line-2)] bg-[var(--de-bg-2)] py-3 text-sm font-medium text-[var(--de-mint)] transition hover:bg-[var(--de-bg-3)] disabled:opacity-50"
        >
          {busy === "yes" ? "Sending…" : "Buy YES"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => handleBuy("no")}
          className="rounded-xl border border-[var(--de-line-2)] bg-[var(--de-bg-2)] py-3 text-sm font-medium text-[var(--de-lavender)] transition hover:bg-[var(--de-bg-3)] disabled:opacity-50"
        >
          {busy === "no" ? "Sending…" : "Buy NO"}
        </button>
      </div>
      {error ? (
        <p className="mt-3 font-mono text-xs text-red-300">{error}</p>
      ) : null}
      {txSig ? (
        <p className="mt-3 text-xs text-[var(--de-ink-3)]">
          Tx{" "}
          <a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[var(--de-lavender)] hover:underline"
          >
            {txSig.slice(0, 10)}…
          </a>
        </p>
      ) : null}
    </div>
  );
}
