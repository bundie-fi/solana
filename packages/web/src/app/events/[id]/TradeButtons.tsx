"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { isMobileWalletAdapter, sendTxViaMwa } from "@/lib/mwa-tx";
import { computeEventIdHash } from "@/lib/events";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PREDICTION_PROGRAM_ID ??
    "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);

const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_DEVNET_USDC ??
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

// Anchor discriminators — sha256("global:<ix_name>")[..8].
// Verified against the Rust source at:
//   packages/programs/programs/prediction-market/src/lib.rs
// Recomputed via:
//   node -e "console.log(require('crypto').createHash('sha256').update('global:buy_event_shares').digest().slice(0,8))"
const DISCRIMINATOR = {
  BUY: Buffer.from([205, 39, 9, 22, 245, 91, 127, 61]),
  SELL: Buffer.from([137, 168, 108, 109, 165, 108, 7, 232]),
  REDEEM: Buffer.from([97, 251, 103, 148, 202, 54, 93, 203]),
} as const;

interface TradeButtonsProps {
  eventId: string;
  /** Market PDA from /v1/event-detail, or null if no market exists yet. */
  marketAddress?: string;
}

type Mode = "buy" | "sell" | "redeem";

export function TradeButtons({ eventId, marketAddress }: TradeButtonsProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const {
    publicKey,
    connected,
    wallet: connectedWallet,
    sendTransaction,
  } = wallet;

  const [mode, setMode] = useState<Mode>("buy");
  const [busy, setBusy] = useState<"yes" | "no" | "redeem" | null>(null);
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
          Run{" "}
          <code className="font-mono text-[var(--de-lavender)]">
            ./packages/programs/scripts/deploy-events-devnet.sh
          </code>{" "}
          to bootstrap.
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

  const marketPubkey = new PublicKey(marketAddress);

  function derivePda(seedPrefix: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(seedPrefix), marketPubkey.toBuffer()],
      PROGRAM_ID,
    )[0];
  }
  const vaultPda = derivePda("vault");
  const yesMintPda = derivePda("yes_mint");
  const noMintPda = derivePda("no_mint");

  async function buildBuyIx(
    signer: PublicKey,
    side: "yes" | "no",
    amountLamports: bigint,
    eventIdHash: Uint8Array,
  ): Promise<TransactionInstruction> {
    const buyerUsdcAta = await getAssociatedTokenAddress(USDC_MINT, signer);
    const buyerYesAta = await getAssociatedTokenAddress(yesMintPda, signer);
    const buyerNoAta = await getAssociatedTokenAddress(noMintPda, signer);

    // ix data: discriminator (8) + event_id_hash (32) + Outcome (1) + amount (8) = 49 bytes
    const data = Buffer.alloc(49);
    DISCRIMINATOR.BUY.copy(data, 0);
    Buffer.from(eventIdHash).copy(data, 8);
    data.writeUInt8(side === "yes" ? 0 : 1, 40);
    data.writeBigUInt64LE(amountLamports, 41);

    // Account ordering MUST match `BuyEventShares` in
    // packages/programs/programs/prediction-market/src/instructions/buy_event_shares.rs.
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      data,
      keys: [
        { pubkey: signer, isSigner: true, isWritable: true },
        { pubkey: marketPubkey, isSigner: false, isWritable: true },
        { pubkey: yesMintPda, isSigner: false, isWritable: true },
        { pubkey: noMintPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: buyerUsdcAta, isSigner: false, isWritable: true },
        { pubkey: buyerYesAta, isSigner: false, isWritable: true },
        { pubkey: buyerNoAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
    });
  }

  async function buildSellIx(
    signer: PublicKey,
    side: "yes" | "no",
    shares: bigint,
    eventIdHash: Uint8Array,
  ): Promise<TransactionInstruction> {
    const outcomeMint = side === "yes" ? yesMintPda : noMintPda;
    const sellerSharesAta = await getAssociatedTokenAddress(outcomeMint, signer);
    const sellerUsdcAta = await getAssociatedTokenAddress(USDC_MINT, signer);

    const data = Buffer.alloc(49);
    DISCRIMINATOR.SELL.copy(data, 0);
    Buffer.from(eventIdHash).copy(data, 8);
    data.writeUInt8(side === "yes" ? 0 : 1, 40);
    data.writeBigUInt64LE(shares, 41);

    return new TransactionInstruction({
      programId: PROGRAM_ID,
      data,
      keys: [
        { pubkey: signer, isSigner: true, isWritable: true },
        { pubkey: marketPubkey, isSigner: false, isWritable: true },
        { pubkey: outcomeMint, isSigner: false, isWritable: true },
        { pubkey: sellerSharesAta, isSigner: false, isWritable: true },
        { pubkey: sellerUsdcAta, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    });
  }

  async function buildRedeemIx(
    signer: PublicKey,
    winnerSide: "yes" | "no",
    eventIdHash: Uint8Array,
  ): Promise<TransactionInstruction> {
    const winnerMint = winnerSide === "yes" ? yesMintPda : noMintPda;
    const redeemerSharesAta = await getAssociatedTokenAddress(winnerMint, signer);
    const redeemerUsdcAta = await getAssociatedTokenAddress(USDC_MINT, signer);

    // ix data: discriminator (8) + event_id_hash (32) = 40 bytes
    const data = Buffer.alloc(40);
    DISCRIMINATOR.REDEEM.copy(data, 0);
    Buffer.from(eventIdHash).copy(data, 8);

    return new TransactionInstruction({
      programId: PROGRAM_ID,
      data,
      keys: [
        { pubkey: signer, isSigner: true, isWritable: true },
        { pubkey: marketPubkey, isSigner: false, isWritable: true },
        { pubkey: winnerMint, isSigner: false, isWritable: true },
        { pubkey: redeemerSharesAta, isSigner: false, isWritable: true },
        { pubkey: redeemerUsdcAta, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    });
  }

  async function dispatch(side: "yes" | "no" | "redeem") {
    if (!publicKey) return;
    setError(null);
    setTxSig(null);
    setBusy(side);

    try {
      const eventIdHash = await computeEventIdHash(eventId);
      const parsed = parseFloat(amount);
      if (mode !== "redeem" && (isNaN(parsed) || parsed <= 0)) {
        throw new Error("Enter a positive amount");
      }
      const amountLamports = BigInt(Math.round(parsed * 1_000_000));

      const buildIx = async (
        signer: PublicKey,
      ): Promise<TransactionInstruction> => {
        if (mode === "buy" && side !== "redeem") {
          return buildBuyIx(signer, side, amountLamports, eventIdHash);
        }
        if (mode === "sell" && side !== "redeem") {
          return buildSellIx(signer, side, amountLamports, eventIdHash);
        }
        // redeem — `side` is the winning side
        if (side === "redeem") {
          // We need the winning side; let the user click YES or NO redeem
          // explicitly. This branch shouldn't fire in the new UX (redeem
          // mode renders two separate buttons).
          throw new Error("Redeem requires a winning side");
        }
        return buildRedeemIx(signer, side, eventIdHash);
      };

      if (isMobileWalletAdapter(connectedWallet?.adapter?.name)) {
        const mwaResult = await sendTxViaMwa({
          connection,
          cluster: "solana:devnet",
          buildTx: async (signer, blockhash) => {
            const { lastValidBlockHeight } =
              await connection.getLatestBlockhash();
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
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash();
        const tx = new Transaction({
          feePayer: publicKey,
          blockhash,
          lastValidBlockHeight,
        }).add(ix);
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction({
          signature: sig,
          blockhash,
          lastValidBlockHeight,
        });
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
      <div className="mb-4 flex items-center gap-2">
        {(["buy", "sell", "redeem"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-lg px-3 py-1 text-xs uppercase tracking-wider transition ${
              mode === m
                ? "bg-[var(--de-lavender-tint)] text-[var(--de-lavender)]"
                : "text-[var(--de-ink-3)] hover:text-[var(--de-ink)]"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode !== "redeem" && (
        <div className="mb-4 flex items-center gap-3">
          <label
            htmlFor="amount"
            className="text-xs uppercase tracking-wider text-[var(--de-ink-3)]"
          >
            {mode === "buy" ? "USDC" : "Shares"}
          </label>
          <input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-24 rounded-lg border border-[var(--de-line-2)] bg-[var(--de-bg-3)] px-3 py-1.5 font-mono text-sm text-[var(--de-ink)] focus:border-[var(--de-line-3)] focus:outline-none"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => dispatch("yes")}
          className="rounded-xl border border-[var(--de-line-2)] bg-[var(--de-bg-2)] py-3 text-sm font-medium text-[var(--de-mint)] transition hover:bg-[var(--de-bg-3)] disabled:opacity-50"
        >
          {busy === "yes" ? "Sending…" : `${actionLabel(mode)} YES`}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => dispatch("no")}
          className="rounded-xl border border-[var(--de-line-2)] bg-[var(--de-bg-2)] py-3 text-sm font-medium text-[var(--de-lavender)] transition hover:bg-[var(--de-bg-3)] disabled:opacity-50"
        >
          {busy === "no" ? "Sending…" : `${actionLabel(mode)} NO`}
        </button>
      </div>

      {mode === "redeem" && (
        <p className="mt-3 text-xs text-[var(--de-ink-3)]">
          Click the side that won. If you hold winning shares, your USDC
          payout is proportional to your share of the winning supply.
        </p>
      )}

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

function actionLabel(mode: Mode): string {
  switch (mode) {
    case "buy":
      return "Buy";
    case "sell":
      return "Sell";
    case "redeem":
      return "Redeem";
  }
}
