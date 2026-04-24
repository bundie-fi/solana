/**
 * vault-signer.ts — shell out to `zerion-bundie agent sign` for
 * vault-managed Bundie agents.
 *
 * Why a separate module? Two callers (sns.ts, cli-runner.ts) need the
 * same primitive: take a base64 unsigned tx + role → get back a base64
 * signed tx. Centralising here avoids drift.
 *
 * Implementation: shells `node packages/zerion-agent/src/cli.js agent sign
 * --name <role> --tx <b64>`. The CLI returns `{ ok, role, signedTx }`
 * as JSON on stdout; secret material never leaves the OWS vault.
 *
 * Hard rules:
 *   - We never echo the input or the signed bytes to our own stdout.
 *   - Stderr from the child is surfaced on failure for diagnostics
 *     (it never contains secret material — the CLI uses printErr() which
 *     emits structured error JSON).
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ZERION_BUNDIE_BIN =
  process.env.ZERION_BUNDIE_BIN ||
  resolve(__dirname, "..", "..", "..", "..", "zerion-agent", "src", "cli.js");

/**
 * Sign a base64 unsigned Solana tx with the vault-managed agent for `role`.
 * Returns base64-encoded fully-signed tx ready for `sendRawTransaction`.
 */
export function signWithVault(role: string, base64UnsignedTx: string): string {
  const res = spawnSync(
    "node",
    [ZERION_BUNDIE_BIN, "agent", "sign", "--name", role, "--tx", base64UnsignedTx],
    { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    throw new Error(
      `vault-sign for role "${role}" failed (exit ${res.status}): ${res.stderr || res.stdout}`,
    );
  }
  let parsed: { ok?: boolean; signedTx?: string };
  try {
    parsed = JSON.parse(res.stdout.trim());
  } catch (err) {
    throw new Error(`vault-sign stdout was not JSON: ${(err as Error).message}`);
  }
  if (!parsed.ok || typeof parsed.signedTx !== "string") {
    throw new Error(`vault-sign returned malformed payload: ${res.stdout}`);
  }
  return parsed.signedTx;
}
