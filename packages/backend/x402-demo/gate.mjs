// Local ENFORCED x402 gate for filming a real X-PAYMENT round-trip.
// Mirrors packages/backend/src/v1/x402.ts verification EXACTLY, but runs
// locally so the live web app + MCP (which don't pay) keep working.
// On valid payment it proxies the REAL signed price from the deployed backend,
// so the data on camera is genuine.
import http from "node:http";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

const UPSTREAM = "https://backend.solana.bundie.fi";
const TREASURY = process.env.DEMO_TREASURY; // any pubkey; required to enforce
const PORT = Number(process.env.DEMO_GATE_PORT || 4021);
const FLOOR = 100; // 100 base units = $0.0001, matches READ_PRICE_FLOOR
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_TRANSFER_IX = 3;

function verifyPaymentTx(b64, required) {
  if (!TREASURY) return { ok: false, reason: "DEMO_TREASURY not configured" };
  let tx;
  try { tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64")); }
  catch (e) { return { ok: false, reason: `invalid tx encoding: ${e.message}` }; }
  const feePayer = tx.message.staticAccountKeys[0];
  if (!feePayer) return { ok: false, reason: "no fee payer" };
  const sig = tx.signatures[0];
  if (!sig || sig.every((b) => b === 0)) return { ok: false, reason: "missing fee-payer signature" };
  const ok = nacl.sign.detached.verify(tx.message.serialize(), sig, feePayer.toBytes());
  if (!ok) return { ok: false, reason: "fee-payer signature invalid" };
  let amountPaid = 0;
  for (const ix of tx.message.compiledInstructions) {
    const pid = tx.message.staticAccountKeys[ix.programIdIndex];
    if (!pid || !pid.equals(TOKEN_PROGRAM_ID)) continue;
    const data = ix.data;
    if (data.length < 9 || data[0] !== TOKEN_TRANSFER_IX) continue;
    amountPaid += Number(Buffer.from(data).readBigUInt64LE(1));
  }
  if (amountPaid < required) return { ok: false, reason: `paid ${amountPaid} < required ${required}` };
  return { ok: true, amountPaid };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/v1/event-price") { res.writeHead(404).end("not found"); return; }
  const id = url.searchParams.get("id") || "";
  const pay = req.headers["x-payment"];
  const j = (code, obj, extra = {}) => {
    res.writeHead(code, { "content-type": "application/json", ...extra });
    res.end(JSON.stringify(obj, null, 2));
  };
  if (!pay) {
    return j(402, {
      error: "Payment required",
      endpoint: "/v1/event-price",
      price_usdc_base_units: FLOOR,
      pricing_mode: "dynamic_by_depth",
      accepted_methods: ["x402"],
      treasury: TREASURY,
    });
  }
  const v = verifyPaymentTx(String(pay), FLOOR);
  if (!v.ok) return j(402, { error: "Payment verification failed", reason: v.reason });
  // Paid → fetch the REAL signed price from the deployed backend.
  const up = await fetch(`${UPSTREAM}/v1/event-price?id=${encodeURIComponent(id)}`);
  const body = await up.text();
  res.writeHead(up.status, {
    "content-type": "application/json",
    "x-x402-tier": "paid",
    "x-x402-amount-paid": String(v.amountPaid),
  });
  res.end(body);
}).listen(PORT, () => console.log(`x402 ENFORCED gate on http://localhost:${PORT}  treasury=${TREASURY}`));
