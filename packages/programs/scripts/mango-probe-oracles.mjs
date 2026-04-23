#!/usr/bin/env node
/**
 * mango-probe-oracles.mjs — devnet Mango v4 oracle-health scan.
 *
 * Read-only. Extends mango-probe-devnet.mjs:
 *   1. list ALL Mango v4 Group accounts on devnet (Group discriminator memcmp)
 *   2. for each group, iterate its registered tokens (Bank accounts)
 *   3. dereference each bank's Pyth oracle account and decode price+confidence+slot
 *   4. print a markdown table covering: group, token, oracle, price,
 *      confidenceBps, stalenessSlots, healthy?
 *   5. highlight healthy oracles (confidenceBps < 100 AND stalenessSlots < 25)
 *
 * Output is written to stdout AND saved to /tmp/mango-oracle-scan-<YYYY-MM-DD>.md.
 *
 * Usage:   node mango-probe-oracles.mjs
 * Env:
 *   RPC_URL    (default: https://api.devnet.solana.com)
 *   KEYPAIR    (default: ~/.config/solana/id.json)  — only used by AnchorProvider stub
 *   MAX_GROUPS (optional, defaults to all)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { MangoClient, MANGO_V4_ID } from "@blockworks-foundation/mango-v4";
import { parsePriceData, Magic as PYTH_MAGIC } from "@pythnetwork/client";
import bs58 from "bs58";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEYPAIR || join(homedir(), ".config/solana/id.json");
const CLUSTER = "devnet";
const MAX_GROUPS = process.env.MAX_GROUPS
  ? parseInt(process.env.MAX_GROUPS, 10)
  : Infinity;

// Pyth Solana Receiver program (Pyth V2 push-pull receiver — most banks point here on mainnet,
// few use it on devnet but kept for completeness).
const PYTH_RECEIVER_PROGRAM_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

// ────────────────────────────── helpers ──────────────────────────────

function anchorDisc(name) {
  return createHash("sha256").update(`account:${name}`).digest().slice(0, 8);
}

async function fetchAllGroupPks(conn, programId) {
  const disc = anchorDisc("Group");
  const accs = await conn.getProgramAccounts(programId, {
    encoding: "base64",
    dataSlice: { offset: 0, length: 0 },
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(disc) } }],
  });
  return accs.map((a) => a.pubkey);
}

function isLegacyPythAccount(accountInfo) {
  return (
    accountInfo &&
    accountInfo.data.length >= 4 &&
    accountInfo.data.readUInt32LE(0) === PYTH_MAGIC
  );
}

function isPythReceiverAccount(accountInfo) {
  return accountInfo && accountInfo.owner.equals(PYTH_RECEIVER_PROGRAM_ID);
}

/**
 * parsePyth — returns { price, conf, lastSlot, provider } or { err }.
 *
 * Handles both legacy Pyth (magic-prefixed) and PythV2 Solana Receiver
 * (`priceUpdateV2` accounts owned by the receiver program).
 *
 * For PythV2 we hand-decode by reading from the END of the account, since
 * the `verificationLevel` enum is 1 byte (Full) or 2 bytes (Partial) and
 * makes absolute offsets variable. The trailing fields are fixed:
 *
 *     [..-92..-60] feedId            (32 bytes)
 *     [..-60..-52] price             (i64 LE)
 *     [..-52..-44] conf              (u64 LE)
 *     [..-44..-40] exponent          (i32 LE, negative)
 *     [..-40..-32] publishTime       (i64 LE)
 *     [..-32..-24] prevPublishTime   (i64 LE)
 *     [..-24..-16] emaPrice          (i64 LE)
 *     [..-16..-8 ] emaConf           (u64 LE)
 *     [..-8 ..   ] postedSlot        (u64 LE)
 */
function parsePyth(accountInfo) {
  if (isPythReceiverAccount(accountInfo)) {
    try {
      const d = accountInfo.data;
      const n = d.length;
      if (n < 8 + 32 + 1 + 84 + 8) {
        return { err: `pythV2: account too short (${n} bytes)` };
      }
      const exponent = d.readInt32LE(n - 44); // typically -8
      const priceRaw = d.readBigInt64LE(n - 60);
      const confRaw = d.readBigUInt64LE(n - 52);
      const postedSlot = d.readBigUInt64LE(n - 8);
      const scale = Math.pow(10, exponent);
      const price = Number(priceRaw) * scale;
      const conf = Number(confRaw) * scale;
      return {
        price,
        conf,
        lastSlot: Number(postedSlot),
        provider: "PythV2",
      };
    } catch (e) {
      return { err: `pythV2 decode: ${e.message}` };
    }
  }
  if (isLegacyPythAccount(accountInfo)) {
    try {
      const p = parsePriceData(accountInfo.data);
      return {
        price: p.previousPrice ?? p.price ?? 0,
        conf: p.previousConfidence ?? p.confidence ?? 0,
        lastSlot: parseInt((p.lastSlot ?? 0n).toString(), 10),
        provider: "Pyth",
      };
    } catch (e) {
      return { err: `pyth decode: ${e.message}` };
    }
  }
  return { err: "non-pyth (skipped)" };
}

// ────────────────────────────── main ──────────────────────────────

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  let kp;
  try {
    kp = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"))),
    );
  } catch {
    kp = Keypair.generate(); // fine — read-only flow
  }
  const wallet = new Wallet(kp);
  const provider = new AnchorProvider(conn, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  const programId = new PublicKey(MANGO_V4_ID[CLUSTER]);
  const client = MangoClient.connect(provider, CLUSTER, programId, {
    idsSource: "get-program-accounts",
  });

  console.error(`RPC: ${RPC_URL}`);
  console.error(`Mango v4 program: ${programId.toBase58()}`);

  // 1. Enumerate Group accounts
  const groupPks = await fetchAllGroupPks(conn, programId);
  console.error(`Enumerated ${groupPks.length} Group accounts on ${CLUSTER}`);

  const scanGroups = groupPks.slice(0, Math.min(MAX_GROUPS, groupPks.length));
  console.error(`Scanning ${scanGroups.length} groups...\n`);

  // 2. Per group: load + collect bank oracle metadata
  const allEntries = [];
  for (const groupPk of scanGroups) {
    let group;
    try {
      group = await client.getGroup(groupPk);
    } catch (e) {
      console.error(`  ${groupPk.toBase58()}  group-load ERR: ${e?.message ?? e}`);
      continue;
    }
    const banks = Array.from(group.banksMapByMint.values()).flat();
    for (const b of banks) {
      allEntries.push({
        groupPk: groupPk.toBase58(),
        token: b.name,
        tokenIndex: b.tokenIndex,
        mint: b.mint.toBase58(),
        oracle: b.oracle.toBase58(),
      });
    }
    console.error(
      `  ${groupPk.toBase58()}  banks=${banks.length}  perps=${group.perpMarketsMapByName.size}`,
    );
  }
  console.error(`\nTotal banks: ${allEntries.length}`);

  // 3. Bulk-fetch oracle accounts (dedup)
  const oracleSet = new Set(allEntries.map((e) => e.oracle));
  const oraclePks = Array.from(oracleSet).map((s) => new PublicKey(s));
  console.error(`Unique oracle accounts: ${oraclePks.length}`);

  const oracleInfoMap = new Map();
  for (let i = 0; i < oraclePks.length; i += 100) {
    const batch = oraclePks.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(batch);
    for (let j = 0; j < batch.length; j++) {
      oracleInfoMap.set(batch[j].toBase58(), infos[j]);
    }
  }

  // 4. Current slot for staleness
  const currentSlot = await conn.getSlot("confirmed");
  console.error(`Current slot: ${currentSlot}\n`);

  // 5. Build rows
  const rows = [];
  for (const e of allEntries) {
    const info = oracleInfoMap.get(e.oracle);
    let price = null;
    let conf = null;
    let lastSlot = null;
    let provider = "—";
    let note = "";
    if (!info) {
      note = "oracle-account-missing";
    } else {
      const parsed = parsePyth(info);
      if (parsed.err) {
        note = parsed.err;
        if (parsed.err.startsWith("pyth-receiver")) provider = "PythV2";
      } else {
        price = parsed.price;
        conf = parsed.conf;
        lastSlot = parsed.lastSlot;
        provider = parsed.provider;
      }
    }

    const confidenceBps =
      price !== null && Math.abs(price) > 0 && conf !== null
        ? (conf / Math.abs(price)) * 10_000
        : null;
    const staleness = lastSlot !== null ? currentSlot - lastSlot : null;
    const healthy =
      confidenceBps !== null &&
      staleness !== null &&
      confidenceBps < 100 &&
      staleness < 25;

    rows.push({
      group: e.groupPk,
      token: e.token,
      tokenIndex: e.tokenIndex,
      oracle: e.oracle,
      provider,
      price,
      confidenceBps,
      staleness,
      healthy,
      note,
    });
  }

  rows.sort((a, b) => {
    if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
    if (a.confidenceBps === null) return 1;
    if (b.confidenceBps === null) return -1;
    return a.confidenceBps - b.confidenceBps;
  });

  // 6. Emit markdown
  const lines = [];
  lines.push(`# Mango v4 devnet oracle scan`);
  lines.push(``);
  lines.push(`- RPC: \`${RPC_URL}\``);
  lines.push(`- Captured at slot: \`${currentSlot}\``);
  lines.push(`- Groups scanned: ${scanGroups.length} (of ${groupPks.length} Group accounts)`);
  lines.push(`- Banks scanned: ${rows.length}`);
  lines.push(`- Healthy threshold: \`confidenceBps < 100\` AND \`stalenessSlots < 25\``);
  lines.push(``);
  lines.push(`| Healthy | Group | Token | idx | Oracle | Provider | Price | ConfBps | Staleness | Note |`);
  lines.push(`|:---:|---|---|---:|---|---|---:|---:|---:|---|`);
  for (const r of rows) {
    const priceStr = r.price === null ? "—" : r.price.toFixed(6);
    const confStr =
      r.confidenceBps === null ? "—" : r.confidenceBps.toFixed(2);
    const stalStr = r.staleness === null ? "—" : r.staleness.toString();
    lines.push(
      `| ${r.healthy ? "YES" : ""} | \`${r.group.slice(0, 8)}…\` | ${r.token} | ${r.tokenIndex} | \`${r.oracle.slice(0, 10)}…\` | ${r.provider} | ${priceStr} | ${confStr} | ${stalStr} | ${r.note} |`,
    );
  }
  lines.push(``);

  const healthyRows = rows.filter((r) => r.healthy);
  lines.push(`## Healthy oracles (${healthyRows.length})`);
  if (healthyRows.length === 0) {
    lines.push(``);
    lines.push(
      `**No oracles on devnet currently satisfy both thresholds.** The devnet Pyth feeds are publishing with wide confidence bands and/or are stale — this is the known blocker on Mango perp_place_order (error 6023 OracleConfidence).`,
    );
  } else {
    lines.push(``);
    lines.push(`| Group | Token | Oracle | Price | ConfBps | Staleness |`);
    lines.push(`|---|---|---|---:|---:|---:|`);
    for (const r of healthyRows) {
      lines.push(
        `| \`${r.group}\` | ${r.token} | \`${r.oracle}\` | ${r.price.toFixed(6)} | ${r.confidenceBps.toFixed(2)} | ${r.staleness} |`,
      );
    }
  }

  // Provider summary
  const provCounts = rows.reduce((acc, r) => {
    acc[r.provider] = (acc[r.provider] || 0) + 1;
    return acc;
  }, {});
  lines.push(``);
  lines.push(`## Provider distribution`);
  lines.push(``);
  lines.push(`| Provider | Count |`);
  lines.push(`|---|---:|`);
  for (const [p, c] of Object.entries(provCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${p} | ${c} |`);
  }

  const md = lines.join("\n");
  console.log(md);

  const today = new Date().toISOString().slice(0, 10);
  const outPath = `/tmp/mango-oracle-scan-${today}.md`;
  writeFileSync(outPath, md);
  console.error(`\nSaved to ${outPath}`);
}

main().catch((e) => {
  console.error("\n✗", e?.stack || e);
  process.exit(1);
});
