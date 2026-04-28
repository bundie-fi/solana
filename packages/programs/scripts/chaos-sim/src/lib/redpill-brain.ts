/**
 * redpill-brain.ts — wrapper around Redpill's /v1/chat/completions endpoint.
 *
 * Redpill is an OpenAI-compatible proxy in front of Anthropic models; we use
 * anthropic/claude-sonnet-4.5 by default. The agent daemon sends a single
 * user message built from the brain.md template and parses the raw completion
 * back into a BrainDecision (our action schema).
 *
 * Robust JSON repair: Claude occasionally wraps its output in ```json fences
 * or prepends one line of commentary. We strip the common cases before
 * JSON.parse and surface a helpful error otherwise.
 */

// Node 20+ exposes global fetch — no import needed.

export type LendProtocol = "kamino" | "marginfi" | "solend";
export type LstProtocol = "marinade" | "jito";
/** Perps venue. Drift was dropped (devnet/mainnet IDL drift, deprecated SDK).
 *  Zeta Markets is the active mainnet perps DEX and runs on the surfpool
 *  fork. */
export type PerpProtocol = "zeta";
/** Aggregators / venues the agent can route swaps through. Extend the
 *  union as new venues land — Jupiter is the v6-quoted aggregator
 *  default; future entries (raydium-cpmm, orca-whirlpool, …) drop in
 *  here without schema changes elsewhere. */
export type SwapVenue = "jupiter";

export type BrainAction =
  | { type: "noop" }
  | {
      type: "lend_deposit";
      protocol: LendProtocol;
      args: { amountUsdcUi: number; reserveAddress?: string };
    }
  | {
      type: "lend_withdraw";
      protocol: LendProtocol;
      args: { amountUi: number; reserveAddress?: string };
    }
  | { type: "lst_stake";   protocol: LstProtocol; args: { amountSolUi: number } }
  | { type: "lst_unstake"; protocol: LstProtocol; args: { amountMsolUi: number } }
  | {
      type: "perp_open";
      protocol: PerpProtocol;
      args: {
        /** Perp market symbol — e.g. "SOL-PERP", "BTC-PERP". */
        market: string;
        /** "long" pays funding when funding>0; "short" earns it. */
        side: "long" | "short";
        /** Notional size in USDC (collateral × leverage). */
        notionalUsd: number;
      };
    }
  | {
      type: "perp_close";
      protocol: PerpProtocol;
      args: { market: string };
    }
  | {
      type: "swap";
      venue: SwapVenue;
      args: {
        inputMint: string;
        outputMint: string;
        /** Input amount in UI units (the brain reasons in human numbers). */
        amountInUi: number;
        /** Slippage tolerance in basis points (50 = 0.5%). */
        slippageBps: number;
      };
    }
  | {
      type: "create_market";
      args: {
        /**
         * Market kind:
         *   1 = NAV target  — agent A's vault NAV must cross thresholdLamports
         *   2 = Head-to-head — agent A's NAV growth vs agent B's NAV growth
         *   3 = Drawdown    — agent A's NAV must fall by drawdownBps from snapshot
         */
        kind: 1 | 2 | 3;
        /** Vault pubkey of the agent being measured (must != creator). */
        targetAgentA: string;
        /** Vault pubkey of the second agent (only for kind=2). */
        targetAgentB?: string | null;
        /** kind=1 only: target NAV in bUSD base units (1 bUSD = 1_000_000). */
        thresholdLamports?: number;
        /** kind=3 only: drawdown threshold in bps from creation-time snapshot. */
        drawdownBps?: number;
        windowSlots: number;
        questionTemplate: string;
        /** Initial liquidity seed in bUSD (UI units, e.g. 2.0). Deposited into market vault on creation. */
        seedAmountBusd: number;
      };
    };

export interface BrainDecision {
  reasoning: string;
  actions: BrainAction[];
}

export interface ReasonArgs {
  brainPrompt: string;
  state: unknown;
  history: unknown[];
  allowlist: unknown;
  model?: string;
  temperature?: number;
}

const REDPILL_URL = "https://api.redpill.ai/v1/chat/completions";

/**
 * Strip common wrapping patterns Claude sometimes adds. Returns the
 * best-effort JSON string. Callers still need to try/catch the JSON.parse.
 */
function repairMaybeJson(raw: string): string {
  let s = raw.trim();
  // Strip ```json ... ``` fences (with or without language tag).
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/```$/, "").trim();
  }
  // If there's a leading narrative line before a `{`, slice to the first `{`.
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }
  return s;
}

export async function reason(args: ReasonArgs): Promise<BrainDecision> {
  const apiKey = process.env.REDPILL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "REDPILL_API_KEY is not set. Add it to packages/programs/scripts/chaos-sim/.env",
    );
  }

  const prompt = args.brainPrompt
    .replace("{{STATE_JSON}}", JSON.stringify(args.state, null, 2))
    .replace("{{HISTORY_JSON}}", JSON.stringify(args.history, null, 2))
    .replace("{{ALLOWLIST}}", JSON.stringify(args.allowlist, null, 2));

  const model = args.model ?? process.env.REDPILL_MODEL ?? "anthropic/claude-sonnet-4.5";
  const temperature = args.temperature ?? 0.3;

  const resp = await fetch(REDPILL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      // Redpill's Anthropic proxy requires max_tokens explicitly. 2048
      // comfortably fits a reasoning blurb + a few actions.
      max_tokens: 2048,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "<no body>");
    throw new Error(`Redpill ${resp.status} ${resp.statusText}: ${body.slice(0, 500)}`);
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Redpill returned no content");
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
      `Redpill returned non-JSON (${(err as Error).message}): ${hint}`,
    );
  }
}
