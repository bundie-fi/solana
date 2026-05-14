/**
 * Ed25519 signed-attestation for v1 oracle responses.
 *
 * Every price payload returned by /v1/event-price is signed by Bundie's
 * attestation key so agents can verify the data came from us (and wasn't
 * tampered with by a transparent proxy or caching layer in between).
 *
 * The signing scheme is deliberately simple:
 *   1. Canonicalise the response body — sort keys, no whitespace.
 *   2. Sign the canonical bytes with ed25519.
 *   3. Encode the signature as base64 in the `signed_attestation` field.
 *
 * Verifiers re-canonicalise the response (excluding the attestation field
 * itself), then verify against Bundie's published public key.
 *
 * The signing key is loaded from BUNDIE_ATTESTATION_KEY (path to a JSON
 * array of 64 bytes — same format as Solana keypair files). If the env
 * var isn't set, we generate an ephemeral key at boot and log its public
 * counterpart; that's fine for dev but for production set the env var
 * so the public key stays stable across restarts.
 */

import { readFileSync } from "node:fs";
import nacl from "tweetnacl";

interface AttestationKey {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  /** base58 form of publicKey, for /health and debug responses. */
  publicKeyBase58: string;
}

let cachedKey: AttestationKey | null = null;

function loadOrGenerateKey(): AttestationKey {
  if (cachedKey) return cachedKey;
  const path = process.env.BUNDIE_ATTESTATION_KEY;
  if (path) {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const secret = new Uint8Array(raw);
    const kp = nacl.sign.keyPair.fromSecretKey(secret);
    cachedKey = {
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
      publicKeyBase58: encodeBase58(kp.publicKey),
    };
  } else {
    const kp = nacl.sign.keyPair();
    cachedKey = {
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
      publicKeyBase58: encodeBase58(kp.publicKey),
    };
    console.warn(
      `[attestation] BUNDIE_ATTESTATION_KEY not set — using ephemeral key. publicKey=${cachedKey.publicKeyBase58}`,
    );
  }
  return cachedKey;
}

/**
 * Canonicalise a JSON-shaped value into a stable byte sequence.
 * - Object keys sorted alphabetically.
 * - No whitespace.
 * - The `signed_attestation` field is excluded from the canonical form
 *   so signing/verifying doesn't depend on the field that holds the
 *   signature itself.
 */
function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => k !== "signed_attestation")
    .sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalise(obj[k])}`);
  return `{${pairs.join(",")}}`;
}

/**
 * Sign a response object, returning the original object with the
 * `signed_attestation` field populated with a base64 ed25519 signature.
 */
export function signResponse<T extends { signed_attestation: string }>(body: T): T {
  const key = loadOrGenerateKey();
  const canonical = canonicalise(body);
  const sig = nacl.sign.detached(
    new TextEncoder().encode(canonical),
    key.secretKey,
  );
  return { ...body, signed_attestation: Buffer.from(sig).toString("base64") };
}

/** Public key for verifiers — exposed via /v1/attestation-key. */
export function publicKeyBase58(): string {
  return loadOrGenerateKey().publicKeyBase58;
}

// ---- tiny base58 encoder (avoid pulling in bs58 just for this) ------------
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encodeBase58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n = n / 58n;
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out = "1" + out;
  return out;
}
