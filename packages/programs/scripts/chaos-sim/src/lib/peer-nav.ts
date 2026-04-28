/**
 * peer-nav.ts — read a peer agent's SOL balance (as a stand-in for vault
 * NAV) from any connection.
 *
 * The Option-X pivot scrapped the strategy-token program, so the only
 * on-chain number we can observe per agent without a vault-composition
 * account is the raw SOL balance. That's fine for the daemon's "peer NAV
 * signal" — it gives Redpill a relative sense of which peer is more/less
 * resourced this tick.
 *
 * Keeping the function name `readVaultNav` so future NAV accounts can slot
 * in without touching the daemon.
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

export interface VaultNav {
  owner: string;
  lamports: number;
  sol: number;
}

export async function readVaultNav(
  conn: Connection,
  owner: PublicKey,
): Promise<VaultNav> {
  try {
    const lamports = await conn.getBalance(owner, "confirmed");
    return {
      owner: owner.toBase58(),
      lamports,
      sol: lamports / LAMPORTS_PER_SOL,
    };
  } catch {
    return { owner: owner.toBase58(), lamports: 0, sol: 0 };
  }
}

export async function readPeerNavs(
  conn: Connection,
  peers: Array<{ name: string; pubkey: PublicKey }>,
  selfPubkey: PublicKey,
): Promise<Array<{ name: string; owner: string } & VaultNav>> {
  const filtered = peers.filter((p) => !p.pubkey.equals(selfPubkey));
  const navs = await Promise.all(
    filtered.map(async (p) => ({
      name: p.name,
      // `owner` is the peer's vault PDA encoded as a base58 string. The
      // brain prompt instructs the LLM to use `peers[].owner` as the
      // `targetAgentA` for create_market — emitting it here keeps the
      // prompt and the runtime consistent. (Field was previously
      // missing; the brain saw `peers[].owner === undefined` and
      // serialised the literal string "undefined" into create_market
      // payloads, which the executor rejected as an invalid pubkey.)
      owner: p.pubkey.toBase58(),
      ...(await readVaultNav(conn, p.pubkey)),
    })),
  );
  return navs;
}
