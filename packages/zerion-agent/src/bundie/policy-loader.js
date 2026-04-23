/**
 * Policy file loader. Supports both YAML and JSON without pulling in a YAML
 * dependency — uses a minimal subset parser since policies.yaml is intentionally
 * flat and predictable.
 *
 * Schema:
 *   policies:
 *     - id: chain_lock
 *       config:
 *         allowed_chains: [solana]
 *     - id: spend_limit
 *       config:
 *         max_notional_usd_per_rebalance: 25
 *         max_notional_usd_per_day: 100
 *     ...
 *   armed_at_ms: 1700000000000     # optional, used by expiry policy
 */

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { POLICY_REGISTRY } from "./policies.js";

/**
 * Parse a tiny subset of YAML — flat lists of objects with scalar/list/map values.
 * Sufficient for `policies.yaml` files in this PoC. Falls back to JSON.parse for
 * `.json` files.
 */
export function parsePolicyFile(contents, filename = "") {
  const ext = (extname(filename) || "").toLowerCase();
  if (ext === ".json") return JSON.parse(contents);
  // Tiny YAML subset.
  return parseTinyYaml(contents);
}

function coerceScalar(raw) {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  // Inline list: [a, b, c]
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((p) => coerceScalar(p));
  }
  // Strip surrounding quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function indentOf(line) {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  return i;
}

function parseTinyYaml(text) {
  const lines = text.split(/\r?\n/);
  // Strip comments and blank lines but keep indentation
  const cleaned = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "").replace(/^#.*$/, "");
    if (line.trim() === "") continue;
    cleaned.push(line);
  }

  let pos = 0;

  function parseBlock(indent) {
    // Returns either an object (mapping) or an array (list of items).
    // Decide by peeking at the first non-blank line at this indent.
    if (pos >= cleaned.length) return null;
    const first = cleaned[pos];
    const ind = indentOf(first);
    if (ind < indent) return null;
    if (first.slice(ind).startsWith("- ")) {
      return parseList(indent);
    }
    return parseMap(indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (pos < cleaned.length) {
      const line = cleaned[pos];
      const ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) {
        throw new Error(`Unexpected indent at line: ${line}`);
      }
      const body = line.slice(indent);
      if (body.startsWith("- ")) break;
      const colon = body.indexOf(":");
      if (colon === -1) throw new Error(`Expected key:value at line: ${line}`);
      const key = body.slice(0, colon).trim();
      const rest = body.slice(colon + 1);
      pos++;
      if (rest.trim() === "") {
        // Nested block
        if (pos < cleaned.length && indentOf(cleaned[pos]) > indent) {
          obj[key] = parseBlock(indent + 2);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = coerceScalar(rest);
      }
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (pos < cleaned.length) {
      const line = cleaned[pos];
      const ind = indentOf(line);
      if (ind < indent) break;
      const body = line.slice(indent);
      if (!body.startsWith("- ")) break;
      pos++;
      const itemRest = body.slice(2);
      const colon = itemRest.indexOf(":");
      if (colon === -1) {
        // Scalar item
        arr.push(coerceScalar(itemRest));
        continue;
      }
      // Mapping item — first key is on the dash line, rest is nested.
      const key = itemRest.slice(0, colon).trim();
      const rest = itemRest.slice(colon + 1);
      const item = {};
      if (rest.trim() === "") {
        if (pos < cleaned.length && indentOf(cleaned[pos]) > indent) {
          item[key] = parseBlock(indent + 4);
        } else {
          item[key] = null;
        }
      } else {
        item[key] = coerceScalar(rest);
      }
      // Pick up subsequent same-block keys for this list item (indent + 2 spaces).
      while (pos < cleaned.length) {
        const next = cleaned[pos];
        const nind = indentOf(next);
        if (nind !== indent + 2) break;
        const nbody = next.slice(indent + 2);
        if (nbody.startsWith("- ")) break;
        const nc = nbody.indexOf(":");
        if (nc === -1) throw new Error(`Expected key:value at line: ${next}`);
        const nkey = nbody.slice(0, nc).trim();
        const nrest = nbody.slice(nc + 1);
        pos++;
        if (nrest.trim() === "") {
          if (pos < cleaned.length && indentOf(cleaned[pos]) > indent + 2) {
            item[nkey] = parseBlock(indent + 4);
          } else {
            item[nkey] = null;
          }
        } else {
          item[nkey] = coerceScalar(nrest);
        }
      }
      arr.push(item);
    }
    return arr;
  }

  if (cleaned.length === 0) return {};
  return parseBlock(indentOf(cleaned[0]));
}

/**
 * Load a policies file from disk and validate against the registry.
 * @param {string} path
 * @returns {{ policies: Array<{ id: string, config: object }>, armedAtMs: number|undefined }}
 */
export function loadPoliciesFromFile(path) {
  const raw = readFileSync(path, "utf-8");
  const parsed = parsePolicyFile(raw, path);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Policy file is empty or invalid: ${path}`);
  }
  const policies = parsed.policies || [];
  if (!Array.isArray(policies) || policies.length === 0) {
    throw new Error(`Policy file must define a non-empty 'policies' list`);
  }
  for (const p of policies) {
    if (!p || typeof p.id !== "string") {
      throw new Error(`Each policy entry needs an 'id' string`);
    }
    if (!POLICY_REGISTRY[p.id]) {
      throw new Error(`Unknown policy id "${p.id}". Known: ${Object.keys(POLICY_REGISTRY).join(", ")}`);
    }
    if (p.config && typeof p.config !== "object") {
      throw new Error(`Policy "${p.id}" config must be an object`);
    }
  }
  return {
    policies: policies.map((p) => ({ id: p.id, config: p.config || {} })),
    armedAtMs: Number.isFinite(parsed.armed_at_ms) ? Number(parsed.armed_at_ms) : undefined,
  };
}
