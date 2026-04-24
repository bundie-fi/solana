#!/usr/bin/env -S tsx
/**
 * run-all.ts - drives every NAV-reader offset regression probe in sequence.
 *
 * Per-probe RPC defaults are baked in (marinade/kamino default to devnet;
 * marginfi defaults to mainnet because marginfi-v2 is not reliably
 * deployed on devnet). Override via per-probe env vars:
 *   MARGINFI_RPC_URL, MARINADE_RPC_URL, KAMINO_RPC_URL
 * or with a global RPC_URL that applies to every probe (overrides defaults).
 *
 * Exits non-zero if ANY probe fails. Used by `pnpm probe:nav` and CI.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

interface Probe {
  name: string;
  file: string;
  defaultRpc: string;
  rpcEnv: string;
}

const PROBES: Probe[] = [
  {
    name: "marginfi",
    file: "probe-marginfi-bank.ts",
    // marginfi-v2 banks are not reliably deployed on devnet - pin mainnet.
    defaultRpc: "https://api.mainnet-beta.solana.com",
    rpcEnv: "MARGINFI_RPC_URL",
  },
  {
    name: "marinade",
    file: "probe-marinade-state.ts",
    defaultRpc: "https://api.devnet.solana.com",
    rpcEnv: "MARINADE_RPC_URL",
  },
  {
    name: "kamino",
    file: "probe-kamino-reserve.ts",
    defaultRpc: "https://api.devnet.solana.com",
    rpcEnv: "KAMINO_RPC_URL",
  },
];

// Resolve `tsx` from node_modules so this works in CI without a global
// install. tsx is the binary that loaded us in the first place, so it is
// guaranteed to be present in the dependency tree.
const tsxCli = require.resolve("tsx/cli");

const failures: string[] = [];

for (const p of PROBES) {
  const rpc = process.env.RPC_URL || process.env[p.rpcEnv] || p.defaultRpc;
  console.log(`\n=== probe:${p.name} (RPC=${rpc}) ===`);
  const res = spawnSync(
    process.execPath, // node
    [tsxCli, join(__dirname, p.file)],
    {
      stdio: "inherit",
      env: { ...process.env, RPC_URL: rpc },
    },
  );
  if (res.status !== 0) {
    failures.push(p.name);
  }
}

console.log("");
if (failures.length > 0) {
  console.error(
    `x NAV PROBE SUITE FAILED - ${failures.length}/${PROBES.length} probe(s) failed: ${failures.join(", ")}`,
  );
  process.exit(1);
}
console.log(
  `ok NAV PROBE SUITE PASS - ${PROBES.length}/${PROBES.length} probes passed`,
);
