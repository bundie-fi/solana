/**
 * lib/sns-register.ts — client-side SNS registration helpers (devnet only).
 *
 * Mirrors the chaos-sim canonical path
 * (packages/programs/scripts/chaos-sim/src/sns.ts::registerNameOnDevnet) but
 * adapted for the browser:
 *   - Wallet Adapter signs (no server keypair).
 *   - Connection comes from NEXT_PUBLIC_RPC_URL (devnet by default).
 *   - All Bonfida SDK access happens behind a lazy dynamic import so the SSR
 *     bundle stays small.
 *
 * DENY-by-default: name validation runs BEFORE we ever touch the SDK.
 *
 * Devnet cost (per chaos-sim/sns.ts): ~0.011 SOL of rent for a 1kB name
 * account + tx fee + a small Bonfida USDC fee on the devnet registrar. The
 * caller must ensure the wallet has a devnet USDC ATA (see Bundie devnet
 * faucet flow). Failures here are surfaced — never auto-retried.
 */
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const DEVNET_RPC =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

// Bonfida devnet USDC mint — same as chaos-sim's funding flow. Bonfida
// charges this token on its devnet registrar. Surface as a constant so
// downstream UI ("you'll spend a small amount of mock USDC") stays honest.
export const BONFIDA_DEVNET_USDC_MINT = new PublicKey(
  "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
);

// 1kB name account — matches the chaos-sim default. Larger spaces cost
// more rent without giving us anything extra for a profile-only use case.
const NAME_ACCOUNT_SPACE = 1_000;

// Approx devnet cost — surfaced so the UI can warn before the user signs.
// Source: chaos-sim/sns.ts comments + actual on-chain rent calc for 1kB.
export const DEVNET_REGISTRATION_COST_SOL = 0.011;

// Name validity rules (kept narrow for v1 — Bonfida's protocol is more
// permissive but our UX surface is "lowercase alphanumeric + dashes",
// matches the chaos-pool naming style and avoids confusable unicode):
//   - 3–32 chars
//   - lowercase a-z, 0-9, single dashes
//   - no leading or trailing dash
//   - no consecutive dashes
const NAME_MIN_LEN = 3;
const NAME_MAX_LEN = 32;
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface NameValidation {
  ok: boolean;
  reason?: string;
}

/** Sync validator. Pure function — safe to call from any render. */
export function validateName(raw: string): NameValidation {
  const name = raw.trim().toLowerCase();
  if (!name) return { ok: false, reason: "Enter a name." };
  if (name.length < NAME_MIN_LEN)
    return { ok: false, reason: `Too short (min ${NAME_MIN_LEN}).` };
  if (name.length > NAME_MAX_LEN)
    return { ok: false, reason: `Too long (max ${NAME_MAX_LEN}).` };
  if (!NAME_RE.test(name))
    return {
      ok: false,
      reason: "Lowercase letters, numbers, and single dashes only.",
    };
  return { ok: true };
}

export type AvailabilityResult =
  | { state: "available"; name: string }
  | { state: "taken"; name: string; owner: string }
  | { state: "invalid"; name: string; reason: string }
  | { state: "error"; name: string; reason: string };

/**
 * checkAvailability — does the `<name>.sol` registry account already exist
 * on devnet? Three states:
 *   - 'invalid'  → fails our name regex (no RPC call)
 *   - 'taken'    → on-chain registry exists; surfaces owner pubkey
 *   - 'available'→ no registry, claim is open
 *   - 'error'    → RPC failure (caller should retry / show transient banner)
 */
export async function checkAvailability(
  raw: string,
): Promise<AvailabilityResult> {
  const v = validateName(raw);
  const name = raw.trim().toLowerCase();
  if (!v.ok) return { state: "invalid", name, reason: v.reason ?? "Invalid." };

  try {
    // Lazy-load the bonfida SDK — keeps the home-page bundle thin.
    const { getDomainKeySync, NameRegistryState } = await import(
      "@bonfida/spl-name-service"
    );
    const { pubkey } = getDomainKeySync(name);
    const conn = new Connection(DEVNET_RPC, "confirmed");
    try {
      const { registry, nftOwner } = await NameRegistryState.retrieve(
        conn,
        pubkey,
      );
      const owner = (nftOwner ?? registry.owner).toBase58();
      return { state: "taken", name, owner };
    } catch {
      // retrieve() throws when the account doesn't exist → free.
      return { state: "available", name };
    }
  } catch (err) {
    return {
      state: "error",
      name,
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export interface BuiltRegistration {
  /** The Transaction with all Bonfida ixs flattened. Owner must sign + pay. */
  tx: Transaction;
  /** The deterministic PDA for `<name>.sol`. */
  namePda: string;
  /** The buyer's USDC ATA we computed (passed to Bonfida). */
  buyerUsdcAta: string;
}

/**
 * Build a registration transaction for `<name>.sol` owned by `owner`. The
 * caller is responsible for signing + sending. We DO NOT auto-send.
 *
 * The buyer's USDC ATA must exist (or be createable) — Bonfida devnet
 * registrar pulls a fee in mock USDC. We compute the ATA address but do
 * not pre-create it; if the wallet has no USDC, sendTx will revert and the
 * caller surfaces the error.
 */
export async function buildRegisterTx(
  name: string,
  owner: PublicKey,
  conn?: Connection,
): Promise<BuiltRegistration> {
  const v = validateName(name);
  if (!v.ok) throw new Error(v.reason ?? "Invalid name");
  const bare = name.trim().toLowerCase();

  const { devnet, getDomainKeySync } = await import(
    "@bonfida/spl-name-service"
  );
  const { pubkey: namePda } = getDomainKeySync(bare);

  const buyerUsdcAta = getAssociatedTokenAddressSync(
    BONFIDA_DEVNET_USDC_MINT,
    owner,
    /* allowOwnerOffCurve */ false,
  );

  const c = conn ?? new Connection(DEVNET_RPC, "confirmed");

  const ixGroups = await devnet.bindings.registerDomainName(
    c,
    bare,
    NAME_ACCOUNT_SPACE,
    owner,
    buyerUsdcAta,
    BONFIDA_DEVNET_USDC_MINT,
  );
  const ixs = ixGroups.flat();

  const tx = new Transaction().add(...ixs);
  tx.feePayer = owner;
  // recentBlockhash assigned at send-time by the wallet adapter helper. We
  // could pre-fill it here, but that adds a 30s expiry race that's painful
  // when the user lingers on the confirmation modal. Let the executor stamp
  // it just before signing.

  return {
    tx,
    namePda: namePda.toBase58(),
    buyerUsdcAta: buyerUsdcAta.toBase58(),
  };
}

/**
 * Minimal wallet adapter shape we need — keeps this module decoupled from
 * the exact `@solana/wallet-adapter-react` types so unit tests can pass a
 * plain stub.
 */
export interface SnsSigningWallet {
  publicKey: PublicKey | null;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  sendTransaction?: (
    tx: Transaction,
    connection: Connection,
  ) => Promise<string>;
}

export interface RegistrationOutcome {
  namePda: string;
  signature: string;
  domain: string; // "<name>.sol"
}

/**
 * executeRegistration — wires a connected wallet adapter to the build +
 * send path. The wallet's `sendTransaction` does the recent-blockhash +
 * sign + submit dance for us.
 *
 * Throws on:
 *   - wallet not connected
 *   - invalid name (validateName failure, before RPC)
 *   - already-registered name (we check and refuse to spend)
 *   - any RPC / send error
 */
export async function executeRegistration(
  wallet: SnsSigningWallet,
  name: string,
  conn?: Connection,
): Promise<RegistrationOutcome> {
  if (!wallet?.publicKey) throw new Error("Wallet not connected");
  if (!wallet.sendTransaction)
    throw new Error("Wallet does not support sendTransaction");

  const v = validateName(name);
  if (!v.ok) throw new Error(v.reason ?? "Invalid name");
  const bare = name.trim().toLowerCase();

  const c = conn ?? new Connection(DEVNET_RPC, "confirmed");

  // Refuse to register a taken name. The /identity UI also gates this with
  // its live availability check, but we belt-and-brace at the boundary in
  // case the user clicks fast or the cache is stale.
  const avail = await checkAvailability(bare);
  if (avail.state === "taken")
    throw new Error(`${bare}.sol is already taken (owner: ${avail.owner}).`);
  if (avail.state === "invalid") throw new Error(avail.reason);
  // 'error' state → keep going; build/send will surface the real RPC error.

  const { tx, namePda } = await buildRegisterTx(bare, wallet.publicKey, c);
  const signature = await wallet.sendTransaction(tx, c);
  await c.confirmTransaction(signature, "confirmed").catch(() => {
    /* don't throw — caller can poll if they care; tx is already submitted */
  });

  return { namePda, signature, domain: `${bare}.sol` };
}

// Test-only helpers — kept so the smoke test can probe internals without
// importing the bonfida SDK.
export const _internals = {
  NAME_RE,
  NAME_ACCOUNT_SPACE,
  validateName,
};
