/**
 * sns.smoke.ts — RPC-free smoke tests for the SNS helpers.
 *
 * Run with: pnpm --filter @bundie/programs chaos:test
 *
 * These tests exercise:
 *   - getNameForAgent returns the expected mapping for every chaos role
 *   - getDomainForAgent appends `.sol`
 *   - lookupAgentByPubkey is the inverse of the static map
 *   - deriveNamePda is deterministic and unique per name
 *
 * No RPC, no signers — pure file lookup + Bonfida's pure derivation.
 */
import {
  deriveNamePda,
  getDomainForAgent,
  getNameForAgent,
  listAllAgents,
  lookupAgentByPubkey,
  registerNameOnDevnet,
} from "../src/sns.js";

interface TestResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, detail: (e as Error).message });
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

const EXPECTED: Record<string, string> = {
  "creator-0": "alpha-hunter",
  "creator-1": "delta-trader",
  "creator-2": "gamma-scout",
  "creator-3": "theta-quant",
  "creator-4": "vega-oracle",
  "trader-0": "sigma-wolf",
  "trader-1": "kappa-falcon",
  "trader-2": "lambda-signal",
  "trader-3": "omega-sage",
  "trader-4": "alpha-quant",
};

test("getNameForAgent returns the correct name for every role", () => {
  for (const [role, name] of Object.entries(EXPECTED)) {
    assertEq(getNameForAgent(role), name, `role=${role}`);
  }
});

test("getDomainForAgent appends .sol", () => {
  for (const [role, name] of Object.entries(EXPECTED)) {
    assertEq(getDomainForAgent(role), `${name}.sol`, `role=${role}`);
  }
});

test("getNameForAgent throws on unknown role", () => {
  let threw = false;
  try {
    getNameForAgent("nobody-99");
  } catch {
    threw = true;
  }
  assert(threw, "expected throw on unknown role");
});

test("listAllAgents returns 10 entries with unique names + pubkeys", () => {
  const all = listAllAgents();
  assertEq(all.length, 10, "agent count");
  const names = new Set(all.map((a) => a.name));
  const pubkeys = new Set(all.map((a) => a.pubkey));
  assertEq(names.size, 10, "unique names");
  assertEq(pubkeys.size, 10, "unique pubkeys");
});

test("lookupAgentByPubkey inverts the map", () => {
  const all = listAllAgents();
  for (const a of all) {
    const found = lookupAgentByPubkey(a.pubkey);
    assert(found !== null, `pubkey ${a.pubkey} should resolve`);
    assertEq(found!.role, a.role, `role for ${a.pubkey}`);
    assertEq(found!.name, a.name, `name for ${a.pubkey}`);
  }
});

test("lookupAgentByPubkey returns null for unknown pubkey", () => {
  const fake = "11111111111111111111111111111111"; // System program ID
  assertEq(lookupAgentByPubkey(fake), null, "unknown pubkey");
});

test("deriveNamePda is deterministic and unique per name", () => {
  const a1 = deriveNamePda("alpha-hunter").toBase58();
  const a2 = deriveNamePda("alpha-hunter").toBase58();
  const b = deriveNamePda("delta-trader").toBase58();
  assertEq(a1, a2, "deterministic");
  assert(a1 !== b, "different names → different PDAs");
});

test("deriveNamePda strips .sol suffix", () => {
  const bare = deriveNamePda("alpha-hunter").toBase58();
  const withSuffix = deriveNamePda("alpha-hunter.sol").toBase58();
  assertEq(bare, withSuffix, ".sol suffix is normalized away");
});

test("registerNameOnDevnet signature: 3-arg shape (no USDC params)", () => {
  // Compile-time / runtime contract check — registerNameOnDevnet is now
  // (conn, wallet, name) only. The Bonfida USDC-pricing path is gone.
  // `Function.length` counts required positional params, which excludes
  // optional ones; we expect exactly 3.
  assertEq(
    registerNameOnDevnet.length,
    3,
    "registerNameOnDevnet should have 3 required params (conn, wallet, name) — no buyerUsdcAta/usdcMint",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Report
// ───────────────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log("");
console.log("SNS smoke tests");
console.log("─".repeat(60));
for (const r of results) {
  const tag = r.ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${r.name}`);
  if (!r.ok) console.log(`         ${r.detail}`);
}
console.log("─".repeat(60));
console.log(`${passed}/${results.length} passed`);

if (failed.length > 0) {
  process.exit(1);
}
