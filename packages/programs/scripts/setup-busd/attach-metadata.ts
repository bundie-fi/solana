/**
 * Attach Metaplex Token Metadata to the existing bUSD mint so explorers
 * (Solana Explorer, Solscan, SolanaFM) display "bUSD" / "Bundie USD" with
 * an icon instead of a generic SPL-token row.
 *
 * Idempotent: if a metadata account already exists for the mint this script
 * issues an `updateV1` instead of `createV1`. Re-run after editing
 * busd-metadata.json (the off-chain JSON pointed to by `uri`) to refresh
 * the on-chain pointer.
 *
 * Run with:
 *   pnpm tsx packages/programs/scripts/setup-busd/attach-metadata.ts
 *
 * Pre-reqs:
 *   - busd-mint.json (mint authority keypair) at packages/programs/
 *   - busd-metadata.json hosted at NEXT_PUBLIC_BACKEND_URL/assets/busd-metadata.json
 *     (or wherever METADATA_URI points to)
 *   - mint authority funded with ~0.01 SOL on devnet
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createV1,
  fetchMetadataFromSeeds,
  mplTokenMetadata,
  TokenStandard,
  updateV1,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  keypairIdentity,
  percentAmount,
  publicKey,
  some,
} from "@metaplex-foundation/umi";

const RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const METADATA_URI =
  process.env.BUSD_METADATA_URI ??
  "https://solana.bundie.fi/assets/busd-metadata.json";

async function main() {
  const mintFilePath = resolve(__dirname, "../../busd-mint.json");
  const mintFile = JSON.parse(readFileSync(mintFilePath, "utf-8")) as {
    mint: string;
    authority: string;
    secret: number[];
  };

  const umi = createUmi(RPC_URL).use(mplTokenMetadata());
  const authority = umi.eddsa.createKeypairFromSecretKey(
    Uint8Array.from(mintFile.secret),
  );
  umi.use(keypairIdentity(authority));

  const mint = publicKey(mintFile.mint);
  console.log("RPC:        ", RPC_URL);
  console.log("Mint:       ", mint);
  console.log("Authority:  ", authority.publicKey);
  console.log("URI:        ", METADATA_URI);

  // Check whether a metadata PDA already exists for this mint.
  let exists = false;
  try {
    await fetchMetadataFromSeeds(umi, { mint });
    exists = true;
  } catch {
    exists = false;
  }

  if (exists) {
    console.log("\nMetadata account already exists — issuing updateV1...");
    const sig = await updateV1(umi, {
      mint,
      authority,
      data: some({
        name: "Bundie USD",
        symbol: "bUSD",
        uri: METADATA_URI,
        sellerFeeBasisPoints: 0,
        creators: null,
      }),
      primarySaleHappened: null,
      isMutable: some(true),
    }).sendAndConfirm(umi);
    console.log("updated:", Buffer.from(sig.signature).toString("base64"));
  } else {
    console.log("\nNo metadata account — issuing createV1...");
    const sig = await createV1(umi, {
      mint,
      authority,
      name: "Bundie USD",
      symbol: "bUSD",
      uri: METADATA_URI,
      sellerFeeBasisPoints: percentAmount(0),
      tokenStandard: TokenStandard.Fungible,
      isMutable: true,
    }).sendAndConfirm(umi);
    console.log("created:", Buffer.from(sig.signature).toString("base64"));
  }

  console.log(
    `\nVerify in explorer:\n  https://explorer.solana.com/address/${mintFile.mint}?cluster=devnet`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
