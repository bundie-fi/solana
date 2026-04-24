/**
 * shared-tick.ts — the canonical observe→reason→execute→log cycle.
 *
 * Every agent (alice, bob, charlie) runs this same function. Personality
 * differences are in their brain.md; budget differences are in their
 * policies.yaml. There are NO hardcoded per-agent branches here.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

import { logActivity, tailActivity } from "../lib/activity-log.js";
import { reason, type BrainDecision } from "../lib/redpill-brain.js";
import { readAllRateSurfaces } from "../lib/rate-surfaces.js";
import { readPeerNavs, readVaultNav } from "../lib/peer-nav.js";
import {
  executeAction,
  isSurfpoolReachable,
} from "../lib/action-executor.js";

// @ts-expect-error — JS module, no type declarations provided
import { loadPoliciesFromFile } from "../../../../../zerion-agent/src/bundie/policy-loader.js";

export interface PeerAgent {
  name: string;
  pubkey: PublicKey;
}

export interface TickArgs {
  agentName: string;
  walletName: string; // OWS wallet name (e.g. "bundie/alice")
  kp: Keypair;
  brainPromptPath: string;
  policyPath: string;
  surfpool: Connection;
  devnet: Connection;
  peers: PeerAgent[];
}

export async function runTick(args: TickArgs): Promise<void> {
  const t0 = Date.now();

  // ─── 1. Observe ────────────────────────────────────────────────────────
  const surfpoolAvailable = await isSurfpoolReachable(args.surfpool);
  const observeConn = surfpoolAvailable ? args.surfpool : args.devnet;
  const observeChain = surfpoolAvailable ? "surfpool" : "devnet";

  const [rates, selfNavOnObserveChain, selfNavOnDevnet, peerNavs] = await Promise.all([
    readAllRateSurfaces(observeConn, observeChain as "surfpool" | "devnet"),
    readVaultNav(observeConn, args.kp.publicKey),
    // Always read devnet balance separately: market-creation txs are submitted
    // to devnet, so the LLM must see the devnet fee-payer balance even when
    // surfpool is the observation chain (vault may have 0 SOL on mainnet fork).
    readVaultNav(args.devnet, args.kp.publicKey),
    readPeerNavs(observeConn, args.peers, args.kp.publicKey),
  ]);
  // selfNav exposed to the LLM uses devnet balance for fee-paying decisions.
  const selfNav = { ...selfNavOnObserveChain, sol: selfNavOnDevnet.sol, lamports: selfNavOnDevnet.lamports };

  const state = {
    observedFrom: observeChain,
    surfpoolReachable: surfpoolAvailable,
    slot: await observeConn.getSlot("confirmed").catch(() => null),
    self: selfNav,
    rates,
    peers: peerNavs,
  };

  logActivity({
    agent: args.agentName,
    phase: "observe",
    chain: observeChain,
    surfpoolReachable: surfpoolAvailable,
    rates,
    selfSol: selfNav.sol,
  });

  console.log(
    `[tick ${args.agentName}] observed from ${observeChain} ` +
      `(surfpool=${surfpoolAvailable ? "up" : "down"})  ` +
      `kaminoUtil=${rates.kaminoUsdcUtilizationBps}bps  msolAbove=${rates.marinadeMsolAboveBps}bps  ` +
      `selfSol=${selfNav.sol.toFixed(4)}`,
  );

  // ─── 2. Reason (Redpill) ───────────────────────────────────────────────
  const brainPrompt = readFileSync(args.brainPromptPath, "utf8");
  const allowlist = extractAllowlist(args.policyPath);
  const history = tailActivity(args.agentName, 20);

  let decision: BrainDecision;
  try {
    decision = await reason({
      brainPrompt,
      state,
      history,
      allowlist,
    });
  } catch (err) {
    const msg = (err as Error).message;
    logActivity({
      agent: args.agentName,
      phase: "execute_error",
      stage: "reason",
      error: msg.slice(0, 500),
    });
    // Defensive: treat a brain failure as a noop tick — don't crash the daemon.
    decision = {
      reasoning: `brain unavailable: ${msg.slice(0, 200)}`,
      actions: [{ type: "noop" }],
    };
  }

  logActivity({
    agent: args.agentName,
    phase: "reason",
    reasoning: decision.reasoning,
    actionCount: decision.actions.length,
    actions: decision.actions,
  });

  console.log(
    `[tick ${args.agentName}] reasoned → ${decision.actions.length} action(s): ` +
      decision.actions.map((a) => a.type).join(", "),
  );
  if (decision.reasoning) {
    console.log(`[tick ${args.agentName}] reasoning: ${decision.reasoning.slice(0, 200)}`);
  }

  // ─── 3. Execute ────────────────────────────────────────────────────────
  for (const action of decision.actions) {
    if (action.type === "noop") {
      logActivity({ agent: args.agentName, phase: "execute", action: "noop" });
      console.log(`[tick ${args.agentName}] exec noop`);
      continue;
    }
    try {
      const result = await executeAction({
        action,
        agentName: args.agentName,
        walletName: args.walletName,
        kp: args.kp,
        surfpool: args.surfpool,
        surfpoolAvailable,
        devnet: args.devnet,
        policyPath: args.policyPath,
      });
      logActivity({ agent: args.agentName, ...result });
      const sigPart = result.txSig ? ` tx=${result.txSig.slice(0, 12)}…` : "";
      const marketPart = result.marketPda ? ` market=${result.marketPda.slice(0, 8)}…` : "";
      console.log(
        `[tick ${args.agentName}] exec ${result.action} → ${result.chain}${sigPart}${marketPart}`,
      );
    } catch (err) {
      const e = err as Error & { code?: string; reason?: string; deniedBy?: string };
      logActivity({
        agent: args.agentName,
        phase: "execute_error",
        action: action.type,
        error: (e.message || String(err)).slice(0, 500),
        code: e.code,
        reason: e.reason,
        deniedBy: e.deniedBy,
      });
      console.log(
        `[tick ${args.agentName}] exec ${action.type} FAILED: ${e.message.slice(0, 160)}`,
      );
    }
  }

  logActivity({
    agent: args.agentName,
    phase: "daemon",
    note: "tick complete",
    durationMs: Date.now() - t0,
  });
}

/**
 * Reads the agent's policies.yaml and extracts the `program_allowlist`
 * entries in a shape that's safe to embed in the LLM prompt. We deliberately
 * don't include swap-shaped predicates here — the brain doesn't reason about
 * chain_lock vs asset_whitelist directly, it reasons about *what programs +
 * instructions it can hit*.
 */
function extractAllowlist(policyPath: string): unknown {
  const { policies } = loadPoliciesFromFile(policyPath);
  const allowlist = policies.find((p: { id: string }) => p.id === "program_allowlist");
  if (!allowlist) return {};
  return (allowlist as { config: unknown }).config;
}
