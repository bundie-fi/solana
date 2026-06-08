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
import { BUSD_MINT } from "@bundie/common";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PREDICTION_PROGRAM_ID ??
    "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
);

// Markets are bUSD-collateralized (the faucet mints bUSD, and `buy_event_shares`
// enforces `buyer_collateral.mint == market.collateral_mint`). This MUST be the
// same mint the faucet dispenses — sourced from @bundie/common like BettorFaucetCTA.
// Using a different "USDC" mint here makes every buy/sell/redeem revert with
// ConstraintRaw (2003), which Phantom surfaces as "Unexpected error".
const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_BUSD_MINT ?? BUSD_MINT,
);

// Anchor discriminators — sha256("global:<ix_name>")[..8].
const DISCRIMINATOR = {
  BUY: Buffer.from([205, 39, 9, 22, 245, 91, 127, 61]),
  SELL: Buffer.from([137, 168, 108, 109, 165, 108, 7, 232]),
  REDEEM: Buffer.from([97, 251, 103, 148, 202, 54, 93, 203]),
} as const;

interface TradeButtonsProps {
  eventId: string;
  marketAddress?: string;
  /** Live YES share price [0,1] from /v1/event-price. Used for the cost preview. */
  yesPrice?: number;
}

type Mode = "buy" | "sell" | "redeem";

const MODES: { id: Mode; label: string }[] = [
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
  { id: "redeem", label: "Redeem" },
];

export function TradeButtons({
  eventId,
  marketAddress,
  yesPrice = 0.5,
}: TradeButtonsProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const {
    publicKey,
    connected,
    wallet: connectedWallet,
    sendTransaction,
  } = wallet;

  const [mode, setMode] = useState<Mode>("buy");
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [amount, setAmount] = useState("5");

  if (!marketAddress) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          Pre-deploy
        </p>
        <p className="mt-2 text-sm text-[var(--de-ink-2)]">
          Market for {eventId} isn’t on-chain yet.
        </p>
        <p className="mt-2 text-xs text-[var(--de-ink-3)]">
          Bootstrap with{" "}
          <code className="font-mono text-[var(--de-lavender)]">
            scripts/deploy-events-devnet.sh
          </code>
          .
        </p>
      </div>
    );
  }

  if (!connected || !publicKey) {
    return (
      <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          Connect to trade
        </p>
        <p className="mt-2 mb-4 text-sm text-[var(--de-ink-2)]">
          Wallet required for YES / NO position changes.
        </p>
        <div className="flex justify-center">
          <WalletMultiButton />
        </div>
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

  const parsedAmount = parseFloat(amount);
  const validAmount = !isNaN(parsedAmount) && parsedAmount > 0;
  const noPrice = 1 - yesPrice;
  // The on-chain `amount` is the number of SHARES to mint (not USDC to spend).
  // Approximate cost ≈ shares × price, ignoring LMSR slippage + fee; the
  // program prices the exact cost on execution.
  const previewYesCost = validAmount ? parsedAmount * yesPrice : 0;
  const previewNoCost = validAmount ? parsedAmount * noPrice : 0;

  async function buildBuyIx(
    signer: PublicKey,
    side: "yes" | "no",
    amountLamports: bigint,
    eventIdHash: Uint8Array,
  ): Promise<TransactionInstruction> {
    const buyerUsdcAta = await getAssociatedTokenAddress(USDC_MINT, signer);
    const buyerYesAta = await getAssociatedTokenAddress(yesMintPda, signer);
    const buyerNoAta = await getAssociatedTokenAddress(noMintPda, signer);

    const data = Buffer.alloc(49);
    DISCRIMINATOR.BUY.copy(data, 0);
    Buffer.from(eventIdHash).copy(data, 8);
    data.writeUInt8(side === "yes" ? 0 : 1, 40);
    data.writeBigUInt64LE(amountLamports, 41);

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
    const sellerSharesAta = await getAssociatedTokenAddress(
      outcomeMint,
      signer,
    );
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
    const redeemerSharesAta = await getAssociatedTokenAddress(
      winnerMint,
      signer,
    );
    const redeemerUsdcAta = await getAssociatedTokenAddress(USDC_MINT, signer);

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

  async function dispatch(side: "yes" | "no") {
    if (!publicKey) return;
    setError(null);
    setTxSig(null);
    setBusy(side);

    try {
      const eventIdHash = await computeEventIdHash(eventId);
      if (mode !== "redeem" && !validAmount) {
        throw new Error("Enter a positive amount.");
      }
      const amountLamports = BigInt(Math.round(parsedAmount * 1_000_000));

      const buildIx = async (
        signer: PublicKey,
      ): Promise<TransactionInstruction> => {
        if (mode === "buy") {
          return buildBuyIx(signer, side, amountLamports, eventIdHash);
        }
        if (mode === "sell") {
          return buildSellIx(signer, side, amountLamports, eventIdHash);
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
      setError(humanizeError((err as Error).message));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6">
      {/* Mode tabs — full-width segmented control with mint/rose context line */}
      <div
        role="tablist"
        aria-label="Trade mode"
        className="mb-5 grid grid-cols-3 gap-1 rounded-lg border border-[var(--de-line)] bg-[var(--de-bg-3)] p-1"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => {
              setMode(m.id);
              setError(null);
            }}
            className={`min-h-9 rounded-md font-mono text-xs uppercase tracking-[0.16em] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--de-lavender)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--de-bg-raised)] ${
              mode === m.id
                ? "bg-[var(--de-bg-raised)] text-[var(--de-ink)] shadow-[inset_0_0_0_1px_var(--de-line-2)]"
                : "text-[var(--de-ink-3)] hover:text-[var(--de-ink-2)]"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode !== "redeem" && (
        <div className="mb-4">
          <label
            htmlFor="amount"
            className="mb-1.5 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]"
          >
            <span>{mode === "buy" ? "Buy (shares)" : "Sell (shares)"}</span>
            <span className="text-[var(--de-ink-4)] normal-case tracking-normal">
              LS-LMSR · slippage applies
            </span>
          </label>
          <div className="relative">
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-[var(--de-line-2)] bg-[var(--de-bg-3)] px-4 py-3 font-mono text-lg tabular-nums text-[var(--de-ink)] placeholder:text-[var(--de-ink-4)] focus:border-[var(--de-line-3)] focus:outline-none focus:ring-2 focus:ring-[var(--de-lavender-glow)]"
              placeholder="0.0"
              aria-describedby="amount-hint"
            />
          </div>
          {mode === "buy" && validAmount ? (
            <p
              id="amount-hint"
              className="mt-2 font-mono text-[11px] tabular-nums text-[var(--de-ink-3)]"
            >
              {parsedAmount} shares ≈{" "}
              <span className="text-[var(--de-mint)]">
                ${previewYesCost.toFixed(2)} YES
              </span>{" "}
              <span className="text-[var(--de-ink-5)]">/</span>{" "}
              <span className="text-[var(--de-rose)]">
                ${previewNoCost.toFixed(2)} NO
              </span>{" "}
              at current price
            </p>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <OutcomeButton
          accent="mint"
          label={
            mode === "redeem" ? "Redeem YES" : `${actionLabel(mode)} YES`
          }
          busy={busy === "yes"}
          disabled={busy !== null}
          onClick={() => dispatch("yes")}
          subtle={
            mode === "redeem"
              ? "If YES won"
              : `${(yesPrice * 100).toFixed(1)}%`
          }
        />
        <OutcomeButton
          accent="rose"
          label={
            mode === "redeem" ? "Redeem NO" : `${actionLabel(mode)} NO`
          }
          busy={busy === "no"}
          disabled={busy !== null}
          onClick={() => dispatch("no")}
          subtle={
            mode === "redeem"
              ? "If NO won"
              : `${(noPrice * 100).toFixed(1)}%`
          }
        />
      </div>

      {mode === "redeem" && (
        <p className="mt-3 text-xs leading-relaxed text-[var(--de-ink-3)]">
          Click the side that won. Payout is your share of the winning
          supply against the vault balance.
        </p>
      )}

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-[var(--de-rose-tint)] bg-[var(--de-rose-tint)] px-3 py-2 font-mono text-[11px] text-[var(--de-rose)]"
        >
          {error}
        </div>
      ) : null}

      {txSig ? (
        <a
          href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex items-center justify-between rounded-lg border border-[var(--de-mint-tint)] bg-[var(--de-mint-tint)] px-3 py-2 font-mono text-[11px] text-[var(--de-mint)] transition-colors duration-150 ease-out hover:bg-[var(--de-mint-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--de-mint)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--de-bg-raised)]"
        >
          <span>Confirmed on devnet</span>
          <span className="text-[var(--de-mint-2)]">
            {txSig.slice(0, 8)}… ↗
          </span>
        </a>
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

function humanizeError(raw: string): string {
  const truncated = raw.slice(0, 200);
  if (/User rejected/i.test(truncated)) return "Signature declined.";
  if (/insufficient/i.test(truncated))
    return "Insufficient USDC. Top up from the devnet faucet.";
  if (/blockhash not found/i.test(truncated))
    return "Network hiccup — try again in a second.";
  return truncated;
}

interface OutcomeButtonProps {
  accent: "mint" | "rose";
  label: string;
  subtle: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

function OutcomeButton({
  accent,
  label,
  subtle,
  busy,
  disabled,
  onClick,
}: OutcomeButtonProps) {
  const text = accent === "mint" ? "var(--de-mint)" : "var(--de-rose)";
  const border =
    accent === "mint" ? "var(--de-mint-tint)" : "var(--de-rose-tint)";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-busy={busy}
      className="group flex flex-col items-stretch gap-1 rounded-xl border bg-[var(--de-bg-2)] px-4 py-3 text-left transition-[transform,background-color,border-color] duration-150 ease-out hover:bg-[var(--de-bg-3)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--de-bg-raised)] disabled:opacity-50 disabled:active:translate-y-0"
      style={
        {
          borderColor: border,
          color: text,
          // Inline so the focus ring inherits the accent without a new utility.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ["--tw-ring-color" as any]: text,
        } as React.CSSProperties
      }
    >
      <span className="flex items-center gap-2 font-mono text-sm font-medium uppercase tracking-[0.12em]">
        {busy ? (
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : null}
        <span>{label}</span>
      </span>
      <span className="font-mono text-[11px] tabular-nums text-[var(--de-ink-3)] group-hover:text-[var(--de-ink-2)]">
        {subtle}
      </span>
    </button>
  );
}
