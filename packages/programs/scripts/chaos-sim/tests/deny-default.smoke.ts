/**
 * Smoke test: DENY-by-default for setupPool/loadPool.
 *
 * When neither the Zerion vault nor the keys/<role>.json fallback has a
 * wallet for a role, `loadPool()` MUST throw — never silently
 * `Keypair.generate()`. Verifies the security invariant from the
 * Zerion-vault migration spec.
 */
import { renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPool } from "../src/wallets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS = join(__dirname, "..", "keys");
const MOVED = join(__dirname, "..", "keys.movedfordenytest");

async function main() {
  if (!process.env.BUNDIE_AGENT_VAULT_PATH) {
    throw new Error("set BUNDIE_AGENT_VAULT_PATH to a fresh tmpdir before running");
  }
  renameSync(KEYS, MOVED);
  try {
    let threw = false;
    try {
      loadPool();
    } catch (err) {
      threw = true;
      const m = (err as Error).message;
      if (!/not in Zerion vault|no keys/i.test(m)) {
        throw new Error("loadPool threw but with the wrong message: " + m);
      }
      console.log("PASS: DENY-by-default — loadPool threw:", m.slice(0, 100));
    }
    if (!threw) throw new Error("FAIL: loadPool returned wallets when nothing was provisioned");
  } finally {
    renameSync(MOVED, KEYS);
  }
}
main().catch((e) => {
  console.error("FAIL:", e?.message || e);
  process.exit(1);
});
