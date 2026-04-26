import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { writeFileSync, existsSync, readFileSync } from "fs";

async function main() {
  const conn = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Reuse payer keypair if present so failed runs can be resumed after manual funding.
  const payerPath = "./busd-payer.json";
  let payer: Keypair;
  if (existsSync(payerPath)) {
    payer = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf-8"))),
    );
    console.log("Reusing existing payer:", payer.publicKey.toBase58());
  } else {
    payer = Keypair.generate();
    writeFileSync(payerPath, JSON.stringify(Array.from(payer.secretKey)));
    console.log("Generated new payer:", payer.publicKey.toBase58());
  }

  // Ensure payer has enough lamports; try airdrop first, fall back to manual instructions.
  const minLamports = 100_000_000; // 0.1 SOL is plenty for one mint
  const balance = await conn.getBalance(payer.publicKey);
  if (balance < minLamports) {
    try {
      console.log("Requesting airdrop for payer...");
      const airdropSig = await conn.requestAirdrop(payer.publicKey, 2_000_000_000);
      await conn.confirmTransaction(airdropSig, "confirmed");
    } catch (err) {
      console.error("Airdrop failed (likely rate-limited).");
      console.error(`Manually fund the payer with at least 0.1 SOL, then re-run:`);
      console.error(`  solana transfer ${payer.publicKey.toBase58()} 0.5 --url devnet --allow-unfunded-recipient`);
      throw err;
    }
  } else {
    console.log("Payer already funded:", balance / 1e9, "SOL");
  }

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
