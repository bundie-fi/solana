/**
 * mwa-tx.ts — canonical Mobile Wallet Adapter signing path used by every
 * wizard / market flow that needs the user's wallet to sign a tx on
 * Seeker (or any Android Chrome MWA path).
 *
 * Why this exists:
 *
 * The wallet-adapter-react abstraction (publicKey + sendTransaction)
 * silently drops the active-account contract on MWA. The adapter caches
 * a publicKey at connect time, but the underlying mobile wallet may sign
 * with a different account at sign time (most commonly when the user has
 * multiple accounts and one is currently selected in the wallet UI).
 * Result: broadcast tx has feePayer=cached but signature for a different
 * account, validator rejects with "missing signature for public key X".
 *
 * The fix per docs.solanamobile.com (§"Sign and Send Transaction") is to
 * use `transact()` from @solana-mobile/mobile-wallet-adapter-protocol-
 * web3js directly, read the active pubkey from `authorize().accounts[0]`
 * INSIDE the transact session, and sign within the same session. Atomic
 * — the account that authorizes is the account that signs.
 *
 * This module exposes one function: `sendTxViaMwa`. The caller passes a
 * builder function `(authedSigner, blockhash) => Promise<Transaction>`
 * which is invoked WITH the freshly authorized pubkey. Use that pubkey
 * for any field that bakes a signer into the instruction (deposit
 * `ownerWallet`, buy_shares `buyer`, redeem `redeemer`, etc.) — using
 * the wallet adapter's stale publicKey would re-introduce the same
 * mismatch even if signing works.
 */
import { Buffer } from "buffer";
import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

const APP_IDENTITY = {
  name: "Bundie",
  uri: "https://app.solana.bundie.fi",
  icon: "/icons/icon-192.png",
} as const;

/** Mobile Wallet Adapter wallet name registered by
 *  @solana-mobile/wallet-standard-mobile (verbatim, both variants). */
export function isMobileWalletAdapter(name: string | undefined | null): boolean {
  if (!name) return false;
  return name.startsWith("Mobile Wallet Adapter") ||
    name.startsWith("Remote Mobile Wallet Adapter");
}

export interface SendTxViaMwaArgs {
  connection: Connection;
  /** Build the unsigned tx using the freshly-authorized signer pubkey
   *  and the supplied blockhash. The returned tx must include any
   *  ix-level fields that depend on the signer (e.g. buyer, owner,
   *  payer ATAs derived off the signer). */
  buildTx: (signer: PublicKey, blockhash: string) => Promise<Transaction>;
  /** Solana cluster identifier as recognised by MWA's authorize, e.g.
   *  "solana:devnet" or "solana:mainnet". Defaults to devnet. */
  cluster?: "solana:devnet" | "solana:mainnet" | "solana:testnet";
  /** Optional console-log prefix for diagnostic lines so multi-flow
   *  debugging can tell the user which surface was the source. */
  logPrefix?: string;
}

/**
 * Sign and send a tx via MWA. Confirmation is the caller's
 * responsibility — we return as soon as the wallet broadcasts so the
 * caller can choose its commitment level.
 */
export async function sendTxViaMwa({
  connection,
  buildTx,
  cluster = "solana:devnet",
  logPrefix = "[mwa-tx]",
}: SendTxViaMwaArgs): Promise<{ signature: string; blockhash: string; lastValidBlockHeight: number }> {
  const { transact } = await import(
    "@solana-mobile/mobile-wallet-adapter-protocol-web3js"
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
    "confirmed",
  );

  const signature = await transact(async (mobileWallet) => {
    const auth = await mobileWallet.authorize({
      chain: cluster,
      identity: APP_IDENTITY,
    });
    const authPubkey = new PublicKey(
      Buffer.from(auth.accounts[0].address, "base64"),
    );

    console.log(`${logPrefix} transact session`, {
      authorizedPubkey: authPubkey.toBase58(),
      authorizedLabel: auth.accounts[0].label ?? "<no-label>",
      cluster,
    });

    const tx = await buildTx(authPubkey, blockhash);
    // Defensive: builder may forget to set these. Doesn't hurt to set
    // both — overwriting with the same values is a no-op.
    tx.feePayer = authPubkey;
    tx.recentBlockhash = blockhash;

    const result = await mobileWallet.signAndSendTransactions({
      transactions: [tx],
    });
    return result[0];
  });

  return { signature, blockhash, lastValidBlockHeight };
}
