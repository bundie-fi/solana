/**
 * zg-brain.ts — 0G Compute Network fallback for the agent brain.
 *
 * When ZG_WALLET_PRIVATE_KEY + ZG_COMPUTE_PROVIDER_ADDRESS are set, the
 * daemon routes brain calls through the 0G Compute Network instead of
 * (or in addition to) Redpill. Same pattern as @brainpedia/compute-0g —
 * the broker SDK signs per-request headers using a wallet key, and the
 * provider serves OpenAI-compatible chat completions over HTTPS.
 *
 * Why this exists: Redpill is a hosted SaaS proxy with monthly credits.
 * When credits run out (HTTP 402) the agents stall on noop forever. 0G
 * testnet is faucet-funded, so a single OG top-up keeps the brain alive
 * indefinitely on the same OpenAI-compatible surface area.
 *
 * The integration only runs when both env vars are present — bare
 * REDPILL-only deployments are unaffected.
 */
import { JsonRpcProvider, Wallet } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

import type { BrainDecision, ReasonArgs } from "./redpill-brain.js";
import { LIVE_INPUTS_SENTINEL } from "./redpill-brain.js";

// Process-wide singletons. The broker maintains an HTTP+JSON-RPC client
// and an on-chain ledger handle that we don't want to rebuild every tick.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedBroker: any | null = null;
let cachedHandle: { endpoint: string; model: string } | null = null;
let acknowledgedProvider = false;

async function getBroker() {
  if (cachedBroker) return cachedBroker;
  const rpcUrl = process.env.ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const pk = process.env.ZG_WALLET_PRIVATE_KEY;
  if (!pk) throw new Error("ZG_WALLET_PRIVATE_KEY not set");
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(pk, provider);
  // ESM/CJS dual-package hazard between ethers + the broker SDK — same
  // structural shape, different types. Cast at the boundary to avoid
  // dragging the whole SDK type dance into our build.
  cachedBroker = await createZGComputeNetworkBroker(wallet as never);
  return cachedBroker;
}

async function getHandle(): Promise<{ endpoint: string; model: string }> {
  if (cachedHandle) return cachedHandle;
  const broker = await getBroker();
  const providerAddr = process.env.ZG_COMPUTE_PROVIDER_ADDRESS;
  if (!providerAddr) throw new Error("ZG_COMPUTE_PROVIDER_ADDRESS not set");

  // One-time per (wallet, provider). The contract reverts on the second
  // call — we swallow the "already acknowledged" revert to keep the
  // boot path idempotent.
  if (!acknowledgedProvider) {
    try {
      await broker.inference.acknowledgeProviderSigner(providerAddr);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!/already|acknowledged/i.test(msg)) throw err;
    }
    acknowledgedProvider = true;
  }

  const meta = await broker.inference.getServiceMetadata(providerAddr);
  cachedHandle = { endpoint: meta.endpoint, model: meta.model };
  return cachedHandle;
}

/**
 * 0G provider returns a lightweight Qwen-class model — no Anthropic
 * cache_control support. Strip the sentinel so the prompt body matches
 * what we sign. The cache split is a Redpill-only optimisation.
 */
function buildPrompt(args: ReasonArgs): string {
  const rendered = args.brainPrompt
    .replace("{{STATE_JSON}}", JSON.stringify(args.state, null, 2))
    .replace("{{HISTORY_JSON}}", JSON.stringify(args.history, null, 2))
    .replace("{{ALLOWLIST}}", JSON.stringify(args.allowlist, null, 2));
  return rendered.replace(LIVE_INPUTS_SENTINEL, "").trim();
}

function repairMaybeJson(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/```$/, "").trim();
  }
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }
  // Qwen sometimes emits JS-style arithmetic in numeric fields, e.g.
  //   "thresholdLamports": 4959176560 * 1.05
  //   "notionalUsd":       4959171560 / 2000000 * 1000000
  // Strict JSON.parse rejects both. Match the entire arithmetic expression
  // as it appears AFTER a colon (so we don't touch strings/reasoning) and
  // fold it to a single number via a safe left-to-right evaluator.
  // Multi-operand chains work because the outer regex captures every
  // operand+operator. Operator precedence isn't honoured — Qwen's
  // outputs are simple enough that this hasn't been an issue.
  s = s.replace(
    /:\s*(-?\d+(?:\.\d+)?(?:\s*[*/+\-]\s*-?\d+(?:\.\d+)?)+)(\s*[,}\n\]])/g,
    (_match, expr: string, tail: string) => {
      const v = evalArithmetic(expr);
      if (v === null || !Number.isFinite(v)) return _match;
      const out = Number.isInteger(v)
        ? String(v)
        : v.toFixed(6).replace(/\.?0+$/, "");
      return `: ${out}${tail}`;
    },
  );
  return s;
}

/**
 * Tiny safe evaluator for `<num> <op> <num> <op> ...` strings. Left-to-right
 * (no precedence). Returns null if the input contains anything other than
 * numbers and the four basic operators — defensive bound so we never invoke
 * eval()-style behaviour on model output.
 */
function evalArithmetic(expr: string): number | null {
  const tokens = expr.match(/-?\d+(?:\.\d+)?|[*/+\-]/g);
  if (!tokens || tokens.length < 3 || tokens.length % 2 === 0) return null;
  let acc = Number(tokens[0]);
  if (!Number.isFinite(acc)) return null;
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const next = Number(tokens[i + 1]);
    if (!Number.isFinite(next)) return null;
    switch (op) {
      case "*": acc *= next; break;
      case "/": acc /= next; break;
      case "+": acc += next; break;
      case "-": acc -= next; break;
      default: return null;
    }
  }
  return acc;
}

// ─── Request scheduler ───────────────────────────────────────────────────
// 0G provider's published limits: 10 requests/min and 2 concurrent. With
// 6 agents bursting on the same supervisor tick we trivially exceed both.
// Throttle to <= 2 in flight, with a min 7s gap between dispatches —
// yields ~8.5 req/min steady-state, well under the cap, while allowing
// some parallelism on bursts.
const ZG_MIN_INTERVAL_MS = 7_000;
const ZG_MAX_CONCURRENT = 2;

let zgInFlight = 0;
let zgLastDispatch = 0;
const zgWaiters: Array<() => void> = [];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function acquireZeroGSlot(): Promise<void> {
  while (true) {
    const now = Date.now();
    const sinceLast = now - zgLastDispatch;
    const gapWait = Math.max(0, ZG_MIN_INTERVAL_MS - sinceLast);
    if (zgInFlight < ZG_MAX_CONCURRENT && gapWait === 0) {
      zgInFlight += 1;
      zgLastDispatch = Date.now();
      return;
    }
    if (gapWait > 0) {
      await sleep(gapWait);
      continue;
    }
    // Wait for a slot to free up.
    await new Promise<void>((resolve) => zgWaiters.push(resolve));
  }
}

function releaseZeroGSlot(): void {
  zgInFlight = Math.max(0, zgInFlight - 1);
  const next = zgWaiters.shift();
  if (next) next();
}

/**
 * System prompt prepended to every 0G call. Tighter constraints than the
 * brain.md user-prompt because Qwen-class models are smaller and more
 * prone to schema drift than Claude. Each line addresses a failure mode
 * we've actually seen in production logs:
 *   - JS arithmetic in numeric fields  → "literal numbers, never arithmetic"
 *   - amountUi=0 spam from too-cautious agents → minimum sizes + "noop instead"
 *   - prose preambles wrapping the JSON → "ONLY a single JSON object"
 *   - markdown fences ```json...``` → "no code fences"
 */
const ZG_SYSTEM_PROMPT = [
  "You are an autonomous DeFi agent. Output ONLY a single JSON object",
  "matching the schema described in the user message. No prose, no",
  "commentary, no code fences.",
  "",
  "Numeric fields MUST be literal numbers — never arithmetic expressions",
  "like `100 * 1.05` or `4959171560 / 2000000`. Compute the value",
  "yourself and emit the result.",
  "",
  "NEVER emit 0 for any size/amount/threshold field. If you cannot size",
  "a meaningful position with current capital, return",
  "`{\"reasoning\": \"...\", \"actions\": [{\"type\": \"noop\"}]}` instead.",
  "Minimums when you DO act:",
  "  amountUi (USDC, mSOL, etc): >= 0.5",
  "  amountSolUi:                 >= 0.05",
  "  amountMsolUi:                >= 0.05",
  "  amountInUi (swap):           >= 0.05",
  "  notionalUsd (perp):          >= 5",
  "  seedAmountBusd:              >= 1 and <= 5",
  "  thresholdLamports:           must be a positive integer literal",
].join("\n");

export async function reasonViaZeroG(args: ReasonArgs): Promise<BrainDecision> {
  const broker = await getBroker();
  const { endpoint, model } = await getHandle();
  const providerAddr = process.env.ZG_COMPUTE_PROVIDER_ADDRESS!;
  const prompt = buildPrompt(args);

  await acquireZeroGSlot();
  try {
    // Headers must be derived from the EXACT content we'll POST — the
    // provider verifies the signature against the request body. The
    // system prompt is part of the body so include it in the signing
    // material to keep the signature valid.
    const signedContent = `${ZG_SYSTEM_PROMPT}\n\n${prompt}`;
    const headers = await broker.inference.getRequestHeaders(
      providerAddr,
      signedContent,
    );

    const url = endpoint.endsWith("/chat/completions")
      ? endpoint
      : `${endpoint.replace(/\/$/, "")}/chat/completions`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        ...(headers as Record<string, string>),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: ZG_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: args.temperature ?? 0.3,
        max_tokens: 512,
      }),
    });

    if (resp.status === 429) {
      // Don't retry — let the caller fall back to Redpill (or just
      // return noop on this tick). Logging the body helps tune the
      // throttle if the provider tightens limits.
      const body = await resp.text().catch(() => "<no body>");
      throw new Error(`0G 429 Too Many Requests: ${body.slice(0, 300)}`);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "<no body>");
      throw new Error(
        `0G ${resp.status} ${resp.statusText}: ${body.slice(0, 500)}`,
      );
    }

    const json = (await resp.json()) as {
      id?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("0G returned no content");
    }

    // Best-effort billing settlement. Failure here doesn't break the
    // current call — at worst the provider reverts to retry-on-next-call.
    const chatId = resp.headers.get("ZG-Res-Key") ?? json.id;
    if (chatId) {
      broker.inference
        .processResponse(providerAddr, chatId, content)
        .catch((err: unknown) => {
          console.warn(
            `[brain 0G] processResponse failed (non-fatal): ${(err as Error).message}`,
          );
        });
    }

    const repaired = repairMaybeJson(content);
    try {
      const parsed = JSON.parse(repaired) as BrainDecision;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("parsed body is not an object");
      }
      if (!Array.isArray(parsed.actions)) {
        throw new Error("actions[] missing");
      }
      if (typeof parsed.reasoning !== "string") {
        parsed.reasoning = "(no reasoning field provided)";
      }
      return parsed;
    } catch (err) {
      const hint = content.slice(0, 500).replace(/\n/g, " ");
      throw new Error(
        `0G returned non-JSON (${(err as Error).message}): ${hint}`,
      );
    }
  } finally {
    releaseZeroGSlot();
  }
}

export function isZeroGConfigured(): boolean {
  return Boolean(
    process.env.ZG_WALLET_PRIVATE_KEY &&
      process.env.ZG_COMPUTE_PROVIDER_ADDRESS,
  );
}
