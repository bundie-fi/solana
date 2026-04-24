/**
 * /api/sns/sign-as-root — server-side parent_owner signature for `.bundie`
 * subdomain registrations.
 *
 * Why this exists
 * ───────────────
 * Subdomain creation under our owned `.bundie` root needs TWO signatures:
 *   - the user's wallet (payer + name_owner) — signed in the browser
 *   - the bundie-root-owner (parent_owner) — signed here
 *
 * The root-owner secret key never reaches the browser. It lives in the
 * server-only env var `BUNDIE_ROOT_OWNER_SECRET_KEY` (JSON array of 64
 * bytes, exactly the format `solana-keygen new` writes).
 *
 * Contract
 * ────────
 * POST { tx: <base64 partially-or-un-signed Transaction> }
 *
 * The server:
 *   1. Decodes the tx.
 *   2. Calls `partialSign(rootOwnerKp)` — adds the parent_owner signature
 *      without disturbing existing signatures (the wallet may have signed
 *      first; the order doesn't matter).
 *   3. Re-serializes with `requireAllSignatures: false` so the still-
 *      missing wallet signature isn't an error.
 *
 * Returns: { tx: <base64 partially-signed Transaction> }
 *
 * Hard rules:
 *   - This route NEVER submits to RPC. Submission is the wallet's job.
 *   - DENY-by-default: if the env var is missing, return 500 — never fall
 *     back to a generated keypair.
 *   - We do NOT validate the tx contents. The on-chain SPL Name Service
 *     processor enforces all the structural rules (correct accounts list,
 *     correct PDA seeds, correct rent). Adding off-chain validation here
 *     would let bugs in the validator silently break valid registrations
 *     while contributing nothing to security — the root-owner's signature
 *     is only useful for the SPL `Create` ix anyway, so a malicious tx
 *     would just waste devnet rent without unlocking anything else.
 */
import { NextResponse } from "next/server";
import { Keypair, Transaction } from "@solana/web3.js";

export const runtime = "nodejs";

let cachedKeypair: Keypair | null = null;

function loadRootOwnerKeypair(): Keypair {
  if (cachedKeypair) return cachedKeypair;
  const raw = process.env.BUNDIE_ROOT_OWNER_SECRET_KEY;
  if (!raw) {
    throw new Error(
      "BUNDIE_ROOT_OWNER_SECRET_KEY is not set. Copy keys/bundie-root-owner.json (the JSON array form) into the env var to enable .bundie subdomain registration.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `BUNDIE_ROOT_OWNER_SECRET_KEY is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error(
      "BUNDIE_ROOT_OWNER_SECRET_KEY must be a 64-element JSON number array (the solana-keygen secret-key format).",
    );
  }
  cachedKeypair = Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  return cachedKeypair;
}

export async function POST(req: Request): Promise<Response> {
  let body: { tx?: string };
  try {
    body = (await req.json()) as { tx?: string };
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }
  const txB64 = body.tx;
  if (typeof txB64 !== "string" || !txB64) {
    return NextResponse.json(
      { error: "Missing `tx` (base64 string) in request body." },
      { status: 400 },
    );
  }

  let kp: Keypair;
  try {
    kp = loadRootOwnerKeypair();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }

  let tx: Transaction;
  try {
    const bytes = Buffer.from(txB64, "base64");
    tx = Transaction.from(bytes);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not decode tx: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  // partialSign tolerates an already-partially-signed tx — it just adds
  // our signature to the matching slot. If the root_owner pubkey isn't
  // listed as a required signer, web3.js throws "unknown signer" — that's
  // the right error to surface (means the client built a tx that doesn't
  // need us, so something is wrong with their ix).
  try {
    tx.partialSign(kp);
  } catch (err) {
    return NextResponse.json(
      { error: `partialSign failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const signedB64 = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  return NextResponse.json({ tx: signedB64 });
}
