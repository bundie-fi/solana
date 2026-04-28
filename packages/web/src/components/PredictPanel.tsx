"use client";

import { useState, useCallback } from "react";
import {
  useWallet,
  useConnection,
} from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const PREDICTION_PROGRAM_ID = new PublicKey(
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4"
);

// TOKEN_PROGRAM_ID and ASSOCIATED_TOKEN_PROGRAM_ID
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

// Hardcoded sha256("global:buy_shares")[0..8]
// Computed via: node -e "const c=require('crypto');console.log([...c.createHash('sha256').update('global:buy_shares').digest().slice(0,8)])"
const BUY_SHARES_DISCRIMINATOR = new Uint8Array([
  40, 239, 138, 154, 8, 37, 106, 108,
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

function serializeBuySharesData(outcome: 0 | 1, amount: bigint): Uint8Array {
  const buf = new ArrayBuffer(8 + 1 + 8);
  const view = new DataView(buf);

  // discriminator (8 bytes)
  BUY_SHARES_DISCRIMINATOR.forEach((b, i) => view.setUint8(i, b));

  // outcome: 1 byte (0 = Yes, 1 = No)
  view.setUint8(8, outcome);

  // amount: u64 LE (8 bytes)
  view.setBigUint64(9, amount, true);

  return new Uint8Array(buf);
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PredictPanelProps {
  marketAddress: string;
  yesMintAddress: string;
  noMintAddress: string;
  vaultAddress: string;
  yesPrice: number;
  noPrice: number;
  collateralMint: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PredictPanel({
  marketAddress,
  yesMintAddress,
  noMintAddress,
  vaultAddress,
  yesPrice,
  noPrice,
  collateralMint,
}: PredictPanelProps) {
  const { publicKey, sendTransaction, signTransaction, connected } =
    useWallet();
  const { connection } = useConnection();

  const [selected, setSelected] = useState<"yes" | "no">("yes");
  const [usdcAmount, setUsdcAmount] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [txSig, setTxSig] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedPrice = selected === "yes" ? yesPrice : noPrice;
  const estimatedShares =
    usdcAmount && parseFloat(usdcAmount) > 0 && selectedPrice > 0
      ? (parseFloat(usdcAmount) / selectedPrice).toFixed(4)
      : "-";

  const handleSubmit = useCallback(async () => {
    if (!publicKey || !connected) return;
    const amount = parseFloat(usdcAmount);
    if (!amount || amount <= 0) {
      setErrorMsg("Enter a valid bUSD amount");
      return;
    }

    setStatus("sending");
    setErrorMsg(null);
    setTxSig(null);

    try {
      const marketPk = new PublicKey(marketAddress);
      const yesMintPk = new PublicKey(yesMintAddress);
      const noMintPk = new PublicKey(noMintAddress);
      const vaultPk = new PublicKey(vaultAddress);
      const collateralMintPk = new PublicKey(collateralMint);

      const outcome: 0 | 1 = selected === "yes" ? 0 : 1;
      // USDC has 6 decimals
      const amountLamports = BigInt(Math.round(amount * 1_000_000));

      const data = serializeBuySharesData(outcome, amountLamports);

      const buyerCollateral = getAssociatedTokenAddress(
        collateralMintPk,
        publicKey
      );
      const buyerYesAta = getAssociatedTokenAddress(yesMintPk, publicKey);
      const buyerNoAta = getAssociatedTokenAddress(noMintPk, publicKey);

      const instruction = new TransactionInstruction({
        programId: PREDICTION_PROGRAM_ID,
        keys: [
          { pubkey: publicKey,       isSigner: true,  isWritable: true  }, // 0: buyer
          { pubkey: marketPk,        isSigner: false, isWritable: true  }, // 1: market
          { pubkey: yesMintPk,       isSigner: false, isWritable: true  }, // 2: yes_mint
          { pubkey: noMintPk,        isSigner: false, isWritable: true  }, // 3: no_mint
          { pubkey: vaultPk,         isSigner: false, isWritable: true  }, // 4: vault
          { pubkey: buyerCollateral, isSigner: false, isWritable: true  }, // 5: buyer_collateral
          { pubkey: buyerYesAta,     isSigner: false, isWritable: true  }, // 6: buyer_yes_ata
          { pubkey: buyerNoAta,      isSigner: false, isWritable: true  }, // 7: buyer_no_ata
          { pubkey: TOKEN_PROGRAM_ID,              isSigner: false, isWritable: false }, // 8
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,   isSigner: false, isWritable: false }, // 9
          { pubkey: SystemProgram.programId,       isSigner: false, isWritable: false }, // 10
        ],
        data: Buffer.from(data),
      });

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: publicKey,
      });
      tx.add(instruction);

      // Surface the actual reason for any preflight failure. Phantom's
      // `sendTransaction` wraps preflight errors as the opaque
      // `WalletSendTransactionError: Unexpected error` and swallows the
      // logs — so a user with no bUSD or no SOL can't tell what's wrong.
      // Sign locally, simulate explicitly to extract the underlying
      // error, then broadcast via sendRawTransaction (preflight already
      // done, skip it).
      let sig: string;
      if (signTransaction) {
        const presigned = await signTransaction(tx);
        const sim = await connection.simulateTransaction(presigned);
        if (sim.value.err) {
          const logs = (sim.value.logs ?? []).join("\n");
          // Token program 0x1 inside the prediction program's CPI =
          // buyer's collateral ATA is short on bUSD.
          if (
            logs.includes("Tokenkeg") &&
            (logs.includes("Error: insufficient funds") ||
              logs.includes("custom program error: 0x1"))
          ) {
            throw new Error(
              "Not enough bUSD to bet that amount. Use the wizard's faucet step or lower your bet size.",
            );
          }
          // System Program rent shortage = need devnet SOL.
          if (
            logs.includes("Transfer: insufficient lamports") ||
            JSON.stringify(sim.value.err).includes("AccountNotFound")
          ) {
            throw new Error(
              "Not enough devnet SOL to pay tx fees. Get some at https://faucet.solana.com (paste your wallet, select Devnet, request 1 SOL).",
            );
          }
          throw new Error(
            `Preflight failed: ${JSON.stringify(sim.value.err)}\n  ${(sim.value.logs ?? []).slice(-6).join("\n  ")}`,
          );
        }
        sig = await connection.sendRawTransaction(presigned.serialize(), {
          skipPreflight: true,
        });
      } else {
        // Wallets without signTransaction (rare) — fall back to the old
        // path; user gets the opaque error but at least the bet works.
        sig = await sendTransaction(tx, connection, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
      }

      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
      );

      setTxSig(sig);
      setStatus("success");
      setUsdcAmount("");
    } catch (err: unknown) {
      console.error("buy_shares error:", err);
      setErrorMsg(
        err instanceof Error ? err.message : "Transaction failed",
      );
      setStatus("error");
    }
  }, [
    publicKey,
    connected,
    usdcAmount,
    selected,
    marketAddress,
    yesMintAddress,
    noMintAddress,
    vaultAddress,
    collateralMint,
    connection,
    sendTransaction,
    signTransaction,
  ]);

  if (!connected) {
    return (
      <div className="mt-4 pt-4 border-t border-neutral-300 flex flex-col items-center gap-3">
        <p className="text-xs text-neutral-800">Connect wallet to predict</p>
        <WalletMultiButton
          style={{
            background: "rgba(109,40,217,0.28)",
            border: "1px solid rgba(109,40,217,0.55)",
            borderRadius: "8px",
            color: "#c4b5fd",
            fontSize: "13px",
            height: "36px",
            padding: "0 16px",
          }}
        />
      </div>
    );
  }

  if (status === "success" && txSig) {
    return (
      <div className="mt-4 pt-4 border-t border-neutral-300 text-center">
        <p className="text-green-400 font-semibold text-sm mb-2">
          Prediction placed!
        </p>
        <a
          href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-predict-purple underline underline-offset-2 hover:text-purple-300 transition-colors"
          style={{ color: "var(--gold)", display: "inline-block" }}
        >
          View on Solana Explorer →
        </a>
        <button
          onClick={() => { setStatus("idle"); setTxSig(null); }}
          className="block mt-3 mx-auto text-xs text-neutral-800 hover:text-neutral-900 transition-colors"
        >
          Place another
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-neutral-300 space-y-3">
      {/* YES / NO toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setSelected("yes")}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
            selected === "yes"
              ? "bg-green-500/20 border border-green-500/50 text-green-400"
              : "bg-surface border border-neutral-300 text-neutral-800 hover:border-green-500/30"
          }`}
        >
          YES &nbsp;{Math.round(yesPrice * 100)}¢
        </button>
        <button
          onClick={() => setSelected("no")}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
            selected === "no"
              ? "bg-red-500/20 border border-red-500/50 text-red-400"
              : "bg-surface border border-neutral-300 text-neutral-800 hover:border-red-500/30"
          }`}
        >
          NO &nbsp;{Math.round(noPrice * 100)}¢
        </button>
      </div>

      {/* bUSD amount input */}
      <div className="relative">
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={usdcAmount}
          onChange={(e) => {
            setUsdcAmount(e.target.value);
            setErrorMsg(null);
          }}
          className="w-full bg-background border border-neutral-300 rounded-lg px-3 py-2 pr-14 text-sm text-neutral-900 placeholder-neutral-800 focus:outline-none focus:border-predict-purple/50 transition-colors"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-800 font-mono">
          bUSD
        </span>
      </div>

      {/* Estimated payout */}
      <div className="flex justify-between text-xs text-neutral-800">
        <span>Estimated shares</span>
        <span className={selected === "yes" ? "text-green-400" : "text-red-400"}>
          {estimatedShares}
        </span>
      </div>

      {/* Error */}
      {errorMsg && (
        <p className="text-xs text-red-400 break-words">{errorMsg}</p>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={status === "sending" || !usdcAmount}
        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors ${
          status === "sending" || !usdcAmount
            ? "bg-predict-purple/20 text-predict-purple/40 cursor-not-allowed"
            : "bg-predict-purple/20 border border-predict-purple/40 text-predict-purple hover:bg-predict-purple/30"
        }`}
      >
        {status === "sending" ? "Sending…" : "Place Prediction"}
      </button>
    </div>
  );
}
