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
  return s;
}

export async function reasonViaZeroG(args: ReasonArgs): Promise<BrainDecision> {
  const broker = await getBroker();
  const { endpoint, model } = await getHandle();
  const providerAddr = process.env.ZG_COMPUTE_PROVIDER_ADDRESS!;
  const prompt = buildPrompt(args);

  // Headers must be derived from the EXACT content we'll POST — the
  // provider verifies the signature against the request body.
  const headers = await broker.inference.getRequestHeaders(providerAddr, prompt);

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
      messages: [{ role: "user", content: prompt }],
      temperature: args.temperature ?? 0.3,
      max_tokens: 512,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "<no body>");
    throw new Error(`0G ${resp.status} ${resp.statusText}: ${body.slice(0, 500)}`);
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
}

export function isZeroGConfigured(): boolean {
  return Boolean(
    process.env.ZG_WALLET_PRIVATE_KEY &&
      process.env.ZG_COMPUTE_PROVIDER_ADDRESS,
  );
}
