#!/usr/bin/env node
/**
 * zeta-probe-devnet.mjs — verify Zeta `place_perp_order_v3` wire layout.
 *
 * Reads the IDL shipped with `@zetamarkets/sdk` and prints:
 *   - the 8-byte Anchor discriminator
 *   - the 25-account list (with the `marketAccounts` composite flattened)
 *     in IDL order, with isMut / isSigner flags
 *   - the arg type list (so we can sanity-check Borsh layout)
 *
 * Pure read-only — no RPC calls, no transactions. Run with:
 *   pnpm exec node packages/programs/scripts/zeta-probe-devnet.mjs
 *
 * Devnet program ID: BG3oRikW8d16YjUEmX3ZxHm9SiJzrGtMhsSR8aCw1Cd7
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";

// Resolve from CWD so the script picks up `@zetamarkets/sdk` from whichever
// package the user runs it from (root, packages/programs, etc.).
const require = createRequire(pathToFileURL(pathResolve(process.cwd(), "package.json")));

// IDL is shipped inside the SDK at dist/idl/zeta.json. The package's
// `exports` map doesn't expose it, so we resolve the package entry point
// and walk over to the IDL file.
function loadIdl() {
  const pkgEntry = require.resolve("@zetamarkets/sdk");
  // pkgEntry is e.g. <…>/@zetamarkets/sdk/dist/index.js
  const idlPath = pkgEntry.replace(/dist[\\/].*$/, "dist/idl/zeta.json");
  return JSON.parse(readFileSync(idlPath, "utf8"));
}

function disc(name) {
  return createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .slice(0, 8);
}

function hex(buf) {
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

function flattenAccounts(accounts, prefix = "") {
  const out = [];
  for (const a of accounts) {
    if (Array.isArray(a.accounts)) {
      out.push(...flattenAccounts(a.accounts, `${prefix}${a.name}.`));
    } else {
      out.push({
        name: `${prefix}${a.name}`,
        isMut: !!a.isMut,
        isSigner: !!a.isSigner,
      });
    }
  }
  return out;
}

function describeType(t) {
  if (typeof t === "string") return t;
  if (t.option) return `Option<${describeType(t.option)}>`;
  if (t.defined) return `enum:${t.defined}`;
  if (t.vec) return `Vec<${describeType(t.vec)}>`;
  return JSON.stringify(t);
}

function main() {
  const idl = loadIdl();
  const ix = idl.instructions.find((i) => i.name === "placePerpOrderV3");
  if (!ix) {
    console.error("✗ placePerpOrderV3 not found in IDL");
    process.exit(1);
  }

  const d = disc("place_perp_order_v3");
  console.log(`discriminator (sha256("global:place_perp_order_v3")[..8]):`);
  console.log(`  hex:    ${hex(d)}`);
  console.log(`  bytes:  [${[...d].join(", ")}]\n`);

  const accs = flattenAccounts(ix.accounts);
  console.log(`accounts (${accs.length}, marketAccounts flattened):`);
  accs.forEach((a, i) => {
    const flags = [a.isMut ? "writable" : "readonly", a.isSigner ? "signer" : null]
      .filter(Boolean)
      .join("+");
    console.log(`  ${String(i).padStart(2, " ")}  ${a.name.padEnd(38)} ${flags}`);
  });
  console.log();

  console.log(`args (${ix.args.length}):`);
  for (const a of ix.args) {
    console.log(`  ${a.name.padEnd(20)} ${describeType(a.type)}`);
  }

  // Resolve enum variant indices for Side / OrderType / Asset.
  const enums = ["Side", "OrderType", "Asset"];
  console.log("\nrelevant enum variant indices (Anchor u8-by-IDL-order):");
  for (const en of enums) {
    const t = idl.types.find((x) => x.name === en);
    if (!t || t.type.kind !== "enum") continue;
    console.log(`  ${en}:`);
    t.type.variants.forEach((v, i) => console.log(`    ${i} = ${v.name}`));
  }
}

main();
