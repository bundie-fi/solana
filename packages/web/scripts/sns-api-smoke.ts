/**
 * sns-api-smoke.mjs — round-trip a register tx through /api/sns/sign-as-root.
 *
 * Run AFTER `pnpm dev` is up. Picks the port off the dev log if needed.
 *
 * Usage:
 *   node scripts/sns-api-smoke.mjs                     (default :3000)
 *   PORT=3002 node scripts/sns-api-smoke.mjs           (override)
 *
 * Asserts:
 *   1. /api/sns/sign-as-root returns 200 + JSON with `tx` field.
 *   2. The returned tx has BUNDIE_ROOT_OWNER's signature slot filled.
 *   3. The user's signer slot remains empty (wallet still needs to sign).
 */
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import {
  buildRegisterTx,
  BUNDIE_ROOT_OWNER,
} from "../src/lib/sns-register.ts";

async function main(): Promise<void> {
  const PORT = process.env.PORT || "3000";
  const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

  const conn = new Connection(RPC, "confirmed");
  const fakeOwner = Keypair.generate().publicKey;

  console.log(`Building register tx (owner=${fakeOwner.toBase58()})...`);
  const built = await buildRegisterTx("smoke-test-bundie", fakeOwner, conn);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  built.tx.recentBlockhash = blockhash;
  built.tx.feePayer = fakeOwner;
  const partialB64 = built.tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  console.log(`Posting to http://localhost:${PORT}/api/sns/sign-as-root...`);

  const res = await fetch(`http://localhost:${PORT}/api/sns/sign-as-root`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx: partialB64 }),
  });

  if (!res.ok) {
    console.error(`status: ${res.status}`);
    console.error(await res.text());
    process.exit(1);
  }

  const json = await res.json();
  if (!json.tx) {
    console.error("response missing `tx` key:", json);
    process.exit(1);
  }

  const signed = Transaction.from(Buffer.from(json.tx, "base64"));
  console.log(`signature slots: ${signed.signatures.length}`);
  let ownerSlot = null;
  let rootSlot = null;
  for (const s of signed.signatures) {
    const tag =
      s.publicKey.equals(BUNDIE_ROOT_OWNER) ? "ROOT" :
        s.publicKey.equals(fakeOwner) ? "OWNER" : "?";
    console.log(`  - [${tag}] ${s.publicKey.toBase58()} signed=${s.signature !== null}`);
    if (s.publicKey.equals(BUNDIE_ROOT_OWNER)) rootSlot = s;
    if (s.publicKey.equals(fakeOwner)) ownerSlot = s;
  }

  if (!rootSlot || rootSlot.signature === null) {
    console.error("FAIL: bundie-root-owner slot is not signed");
    process.exit(1);
  }
  if (!ownerSlot || ownerSlot.signature !== null) {
    console.error("FAIL: owner slot should still be unsigned (wallet signs later)");
    process.exit(1);
  }
  console.log("PASS: root_owner signed, owner slot still empty for wallet to fill.");
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
