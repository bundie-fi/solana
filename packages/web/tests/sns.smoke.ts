/**
 * sns.smoke.tsx — RPC-free smoke test for the SnsName component.
 *
 * Run with: pnpm --filter @bundie/web test:sns
 *
 * Why renderToStaticMarkup
 * ────────────────────────
 * We don't have a full React testing framework set up in `packages/web`.
 * This script uses `react-dom/server`'s static renderer, which mirrors
 * what Next.js produces server-side. The SnsName component falls back to
 * the synchronous `lookupChaosPoolSync` for its initial state — that's
 * exactly the path SSR takes, so the rendered HTML is testable without
 * a browser, without RPC, without async.
 *
 * Tests:
 *   1) Unknown pubkey → renders truncated fallback
 *   2) Chaos-pool pubkey → renders `<name>.sol`
 *   3) Empty addr → renders empty string (no crash)
 *   4) Custom prefix is rendered
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SnsName } from "../src/components/SnsName";

// Use React.createElement directly to avoid depending on whichever JSX
// runtime tsx happens to load — this script is intentionally framework-free.
const e = React.createElement;

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

function assertContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: expected output to contain "${needle}", got: ${haystack}`);
  }
}

function assertNotContains(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) {
    throw new Error(`${label}: expected output NOT to contain "${needle}", got: ${haystack}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

const UNKNOWN_PUBKEY = "11111111111111111111111111111111";
const CHAOS_PUBKEY_CREATOR_0 = "9sDZ2Q7r57Zzb8QonDKMrMxgGKXtLcEckKjuUpVv8EgJ"; // alpha-hunter
const CHAOS_PUBKEY_TRADER_2 = "6WbNANWYGJrzABNmkaiehE6hMFws8Ahv8AMLzEpZHu6R"; // lambda-signal

test("renders truncated fallback for unknown pubkey", () => {
  const html = renderToStaticMarkup(e(SnsName, { addr: UNKNOWN_PUBKEY }));
  // Truncated form: 6 leading + ellipsis + 4 trailing
  assertContains(html, "111111", "leading");
  assertContains(html, "1111", "trailing");
  assertContains(html, "…", "ellipsis");
  assertNotContains(html, ".sol", "no .sol in fallback");
  // SSR marker: never resolved through the static map → data-attr says false
  assertContains(html, 'data-sns-resolved="false"', "data attr");
});

test("renders <name>.sol for chaos-pool pubkey (creator)", () => {
  const html = renderToStaticMarkup(
    e(SnsName, { addr: CHAOS_PUBKEY_CREATOR_0 }),
  );
  assertContains(html, "alpha-hunter.sol", "alpha-hunter resolves");
  assertContains(html, 'data-sns-resolved="true"', "marked resolved");
});

test("renders <name>.sol for chaos-pool pubkey (trader)", () => {
  const html = renderToStaticMarkup(
    e(SnsName, { addr: CHAOS_PUBKEY_TRADER_2 }),
  );
  assertContains(html, "lambda-signal.sol", "lambda-signal resolves");
});

test("empty addr renders empty span without crashing", () => {
  const html = renderToStaticMarkup(e(SnsName, { addr: "" }));
  // Should render at least the wrapping span — never crash.
  assertContains(html, "<span", "wrapper span present");
});

test("prefix is rendered before the name", () => {
  const html = renderToStaticMarkup(
    e(SnsName, { addr: CHAOS_PUBKEY_CREATOR_0, prefix: "by " }),
  );
  assertContains(html, "by alpha-hunter.sol", "prefix + name");
});

test("custom head/tail change the truncation length", () => {
  const html = renderToStaticMarkup(
    e(SnsName, { addr: UNKNOWN_PUBKEY, head: 3, tail: 3 }),
  );
  // 3-char prefix + ellipsis + 3-char suffix
  assertContains(html, "111…111", "custom truncation");
});

// ───────────────────────────────────────────────────────────────────────────
// Report
// ───────────────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

console.log("");
console.log("SnsName smoke tests");
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
