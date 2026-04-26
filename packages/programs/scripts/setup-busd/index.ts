import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { writeFileSync } from "fs";

async function main() {
  const conn = new Connection(clusterApiUrl("devnet"), "confirmed");
  const payer = Keypair.generate();

  // Airdrop 2 SOL to the payer (one-time setup; if rate-limited, user must fund manually)
  console.log("Requesting airdrop for payer:", payer.publicKey.toBase58());
  const airdropSig = await conn.requestAirdrop(payer.publicKey, 2_000_000_000);
  await conn.confirmTransaction(airdropSig, "confirmed");

  // Create the mint with payer as mint authority, no freeze authority, 6 decimals.
  const mint = await createMint(conn, payer, payer.publicKey, null, 6);

  const out = {
    mint: mint.toBase58(),
    authority: payer.publicKey.toBase58(),
    secret: Array.from(payer.secretKey),
    network: "devnet",
    createdAt: new Date().toISOString(),
  };
  writeFileSync("./busd-mint.json", JSON.stringify(out, null, 2));
  console.log("\nbUSD mint:", out.mint);
  console.log("Mint authority:", out.authority);
  console.log("\nSet these env vars on backend (Railway):");
  console.log(`  BUSD_MINT=${out.mint}`);
  console.log(`  BUSD_MINT_AUTHORITY_SECRET=${JSON.stringify(out.secret)}`);
  console.log("\nSet on web (Next.js):");
  console.log(`  NEXT_PUBLIC_BUSD_MINT=${out.mint}`);
  console.log("\nbusd-mint.json saved (DO NOT COMMIT — secret key inside)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
