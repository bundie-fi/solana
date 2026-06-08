// A paying x402 agent — the real "oracle moment" you film for Shot B.
// 1) GET the price with no payment        -> 402 challenge (price + treasury)
// 2) Build + sign a bUSD transfer tx       -> X-PAYMENT (binding signed Solana tx)
// 3) GET again with X-PAYMENT               -> 200 + the signed price
// 4) Verify the ed25519 attestation locally -> tamper-proof
//
// The signed tx is binding (settles on broadcast) but never broadcast here —
// the gate verifies the agent CAN pay, exactly like the production middleware.
import {
  Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import nacl from "tweetnacl";

const GATE = process.env.DEMO_GATE_URL || "http://localhost:4021";
const UPSTREAM = "https://backend.solana.bundie.fi";
const EVENT = process.env.DEMO_EVENT || "kamino_main_tvl_drop_50m_24h_90d";
const RPC = process.env.DEMO_RPC || "https://api.devnet.solana.com";
const BUSD = new PublicKey("42LaRiwvuxfQv5rfHMmk9wU3K2nRxMGzgukNJztydpiB");
const TREASURY = new PublicKey(process.env.DEMO_TREASURY);
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const agent = Keypair.generate(); // ephemeral agent wallet

const ata = (mint, owner) => PublicKey.findProgramAddressSync(
  [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATA_PROGRAM_ID)[0];

function tokenTransferIx(source, dest, authority, amount) {
  const data = Buffer.alloc(9);
  data[0] = 3; // SPL Token Transfer
  data.writeBigUInt64LE(BigInt(amount), 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function buildPayment(amount) {
  const conn = new Connection(RPC, "confirmed");
  const { blockhash } = await conn.getLatestBlockhash();
  const ix = tokenTransferIx(ata(BUSD, agent.publicKey), ata(BUSD, TREASURY), agent.publicKey, amount);
  const msg = new TransactionMessage({
    payerKey: agent.publicKey, recentBlockhash: blockhash, instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([agent]);
  return Buffer.from(tx.serialize()).toString("base64");
}

async function main() {
  console.log(`\n[agent ${agent.publicKey.toBase58().slice(0, 8)}…] wants the price of "${EVENT}"\n`);

  // 1) No payment → 402
  let r = await fetch(`${GATE}/v1/event-price?id=${EVENT}`);
  const challenge = await r.json();
  console.log(`STEP 1 — GET without payment → HTTP ${r.status}`);
  console.log(`         price: ${challenge.price_usdc_base_units} base units ($${(challenge.price_usdc_base_units / 1e6).toFixed(4)})  pay → ${challenge.treasury?.slice(0,8)}…\n`);

  // 2) Build + sign the payment
  const xpayment = await buildPayment(challenge.price_usdc_base_units);
  console.log(`STEP 2 — built + signed bUSD transfer tx (X-PAYMENT, ${xpayment.length} b64 chars)\n`);

  // 3) Retry with X-PAYMENT → 200
  r = await fetch(`${GATE}/v1/event-price?id=${EVENT}`, { headers: { "X-PAYMENT": xpayment } });
  const price = await r.json();
  console.log(`STEP 3 — GET with X-PAYMENT → HTTP ${r.status}  (X-X402-Tier: ${r.headers.get("x-x402-tier")}, paid: ${r.headers.get("x-x402-amount-paid")} units)`);
  console.log(`         YES ${(price.price * 100).toFixed(1)}%  depth $${price.depth_usd}  resolver: ${price.resolver_class}\n`);

  // 4) Verify the signature
  const keyResp = await (await fetch(`${UPSTREAM}/v1/attestation-key`)).json();
  const pub = bs58Decode(keyResp.public_key_base58);
  const { signed_attestation, ...body } = price;
  const canonical = canon(body);
  const valid = nacl.sign.detached.verify(
    new TextEncoder().encode(canonical),
    Buffer.from(signed_attestation, "base64"), pub);
  console.log(`STEP 4 — ed25519 verify against ${keyResp.public_key_base58.slice(0,8)}… → ${valid ? "VALID ✓ tamper-proof" : "INVALID ✗"}\n`);
}

// recursively sorted-keys, no whitespace, excluding signed_attestation
function canon(o) {
  if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
  if (o && typeof o === "object")
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  return JSON.stringify(o);
}
function bs58Decode(s) {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let bytes = [0];
  for (const c of s) {
    let carry = A.indexOf(c);
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const c of s) { if (c === "1") bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}
main().catch((e) => { console.error(e); process.exit(1); });
