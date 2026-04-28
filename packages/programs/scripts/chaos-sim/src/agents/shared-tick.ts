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
import {
  commitNavToDevnet,
  computeNavFromSurfpoolBalances,
  syncTreasuryToPerformance,
} from "../lib/commit-nav-helper.js";
import { readSurfpoolTokenBalances } from "../lib/balances.js";
import { logAgentAction } from "../lib/agents-source.js";

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
  /** Optional treasury-sync wiring. When all four are present, the
   *  daemon mints bUSD into the agent's treasury_ata after each
   *  commit_nav so the user-facing balance scales with the agent's
   *  NAV growth. Hardcoded alice/bob/charlie agents pass undefined
   *  here (they have no Postgres row, so no seed). */
  busdMintAuthority?: Keypair;
  busdMintPubkey?: PublicKey;
  vaultPda?: PublicKey;
  seedBaseUnits?: bigint;
}

export async function runTick(args: TickArgs): Promise<void> {
  const t0 = Date.now();

  // ─── 1. Observe ────────────────────────────────────────────────────────
  const surfpoolAvailable = await isSurfpoolReachable(args.surfpool);
  const observeConn = surfpoolAvailable ? args.surfpool : args.devnet;
  // When SURFPOOL_RPC_URL / MAINNET_RPC_URL points at real mainnet (recommended),
  // label it "mainnet" so all 5 rate readers use mainnet reserve/state addresses.
  // If surfpool is unreachable we fall back to devnet (only Kamino + Marinade work).
  const observeChain = surfpoolAvailable ? "mainnet" : "devnet";

  const [
    rates,
    selfNavOnObserveChain,
    selfNavOnDevnet,
    peerNavs,
    surfpoolBalances,
  ] = await Promise.all([
    readAllRateSurfaces(observeConn, observeChain as "mainnet" | "devnet"),
    readVaultNav(observeConn, args.kp.publicKey),
    // Always read devnet balance separately: market-creation txs go to
    // devnet, so the brain needs to see devnet fee-payer SOL even when the
    // execution chain is surfpool.
    readVaultNav(args.devnet, args.kp.publicKey),
    readPeerNavs(observeConn, args.peers, args.kp.publicKey),
    // Surfpool USDC + mSOL balances. Without these the brain only sees
    // `self.sol` and reasons "no USDC, can't lend" → noops every tick even
    // though chaos-sim seeds 1000 USDC into the agent's ATA each tick.
    // When surfpool is unreachable the helper returns {usdc:0, msol:0}.
    surfpoolAvailable
      ? readSurfpoolTokenBalances(args.surfpool, args.kp.publicKey)
      : Promise.resolve({ usdc: 0, msol: 0 }),
  ]);
  // selfNav.sol = surfpool balance (matches what the brain prompts now
  // describe — strategy txs land on surfpool). selfNav.devnetSol exposed
  // separately for market-creation fee-payer reasoning. selfNav.usdc /
  // selfNav.msol are surfpool token-account balances, surfaced so the
  // brain can reason about lending and unstaking.
  const selfNav = {
    ...selfNavOnObserveChain,
    devnetSol: selfNavOnDevnet.sol,
    devnetLamports: selfNavOnDevnet.lamports,
    usdc: surfpoolBalances.usdc,
    msol: surfpoolBalances.msol,
  };

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
      `(mainnetRpc=${surfpoolAvailable ? "up" : "down"})  ` +
      `kamino=${rates.kaminoUsdcUtilizationBps}bps  marinade=${rates.marinadeMsolAboveBps}bps  ` +
      `marginfi=${rates.marginfiUsdcUtilizationBps}bps  jito=${rates.splStakePoolAboveBps}bps  ` +
      `zetaFunding=${rates.zetaSolPerpFundingBps}bps  ` +
      `selfSol=${selfNav.sol.toFixed(4)} selfUsdc=${selfNav.usdc.toFixed(2)} selfMsol=${selfNav.msol.toFixed(4)}`,
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
  // Collect tx sigs from strategy actions executed on surfpool. These feed
  // the `commit_nav` digest below so each NAV commit is bound to the exact
  // surfpool side-effects it summarises.
  const surfpoolTxSigs: string[] = [];

  for (const action of decision.actions) {
    if (action.type === "noop") {
      logActivity({ agent: args.agentName, phase: "execute", action: "noop" });
      console.log(`[tick ${args.agentName}] exec noop`);
      // Per-action Supabase log (Phase O): noops show up in the agent profile
      // timeline so the user can see "the brain saw no opportunity" turns too.
      await logAgentAction({
        agentSns: args.agentName,
        actionType: "noop",
        reasoning: decision.reasoning ?? null,
        resultJson: { phase: "execute", action: "noop" },
      }).catch(() => {});
      continue;
    }
    try {
      const result = await executeAction({
        action,
        agentName: args.agentName,
        agentSns: args.agentName,
        walletName: args.walletName,
        kp: args.kp,
        surfpool: args.surfpool,
        surfpoolAvailable,
        devnet: args.devnet,
        policyPath: args.policyPath,
      });
      logActivity({ agent: args.agentName, ...result });
      // Only roll surfpool-chain tx sigs into the NAV digest. Devnet
      // market-creation txs are not part of the NAV computation.
      if (result.txSig && result.chain === "surfpool") {
        surfpoolTxSigs.push(result.txSig);
      }
      const sigPart = result.txSig ? ` tx=${result.txSig.slice(0, 12)}…` : "";
      const marketPart = result.marketPda ? ` market=${result.marketPda.slice(0, 8)}…` : "";
      console.log(
        `[tick ${args.agentName}] exec ${result.action} → ${result.chain}${sigPart}${marketPart}`,
      );
      // Per-action Supabase log (Phase O).
      // result.action may be 'create_market_skipped' for rate-limited skips.
      // The executor returns a structured result and we are the sole writer to agent_action_log here.
      // (No Supabase deduplication — there's no unique constraint; rely on caller-side discipline.)
      await logAgentAction({
        agentSns: args.agentName,
        actionType: result.action,
        reasoning: decision.reasoning ?? null,
        resultJson: result as unknown,
      }).catch(() => {});
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
      // Per-action Supabase log (Phase O): failures also surface in the
      // profile timeline. action_type uses the requested action.type (not
      // result.action, since there's no result on the error path).
      await logAgentAction({
        agentSns: args.agentName,
        actionType: `${action.type}_error`,
        reasoning: decision.reasoning ?? null,
        resultJson: {
          error: (e.message || String(err)).slice(0, 500),
          code: e.code ?? null,
          reason: e.reason ?? null,
          deniedBy: e.deniedBy ?? null,
        },
      }).catch(() => {});
    }
  }

  // ─── 4. Commit NAV to devnet ───────────────────────────────────────────
  // Compute the agent's NAV from surfpool token balances and commit it
  // to the BundieVault on devnet. Each tick increments `nav_epoch` by 1,
  // so a missed tick breaks the on-chain monotonic constraint and surfaces
  // here as `StaleNavEpoch` — that's intentional, the operator must run
  // `init-vaults` (one-shot) and then re-sync.
  if (surfpoolAvailable) {
    try {
      const navLamports = await computeNavFromSurfpoolBalances(
        args.surfpool,
        args.kp.publicKey,
      );
      const commit = await commitNavToDevnet({
        connection: args.devnet,
        agentKp: args.kp,
        navLamports,
        surfpoolTxSigs,
      });
      logActivity({
        agent: args.agentName,
        phase: "execute",
        chain: "devnet",
        action: "commit_nav",
        txSig: commit.txSig,
        notes:
          `nav=${navLamports} epoch=${commit.epoch} ` +
          `digest=${commit.digestHex.slice(0, 16)}… ` +
          `surfpoolTxs=${surfpoolTxSigs.length}`,
      });
      console.log(
        `[tick ${args.agentName}] commit_nav → devnet tx=${commit.txSig.slice(0, 12)}… ` +
          `nav=${navLamports} epoch=${commit.epoch}`,
      );
      await logAgentAction({
        agentSns: args.agentName,
        actionType: "commit_nav",
        reasoning: null,
        resultJson: {
          txSig: commit.txSig,
          navLamports: navLamports.toString(),
          epoch: commit.epoch,
          digestHex: commit.digestHex,
          surfpoolTxSigs,
        },
      }).catch(() => {});

      // bUSD treasury performance-sync: scale the user's seed by the
      // agent's NAV growth since baseline, mint the delta. Mint-only —
      // see helper docstring. Best-effort; failure here doesn't break
      // the rest of the tick.
      if (
        args.busdMintAuthority &&
        args.busdMintPubkey &&
        args.vaultPda &&
        args.seedBaseUnits !== undefined
      ) {
        try {
          const result = await syncTreasuryToPerformance({
            connection: args.devnet,
            busdMintAuthority: args.busdMintAuthority,
            busdMintPubkey: args.busdMintPubkey,
            vaultPda: args.vaultPda,
            agentPubkey: args.kp.publicKey,
            seedBaseUnits: args.seedBaseUnits,
            currentNavLamports: BigInt(navLamports),
          });
          if (result) {
            console.log(
              `[tick ${args.agentName}] treasury-sync → minted ${result.minted} bUSD ` +
                `(tx=${result.txSig.slice(0, 12)}…)`,
            );
          }
        } catch (err) {
          console.warn(
            `[tick ${args.agentName}] treasury-sync failed: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      const e = err as Error;
      logActivity({
        agent: args.agentName,
        phase: "execute_error",
        action: "commit_nav",
        error: e.message.slice(0, 500),
      });
      console.log(
        `[tick ${args.agentName}] commit_nav FAILED: ${e.message.slice(0, 200)}`,
      );
      await logAgentAction({
        agentSns: args.agentName,
        actionType: "commit_nav_error",
        reasoning: null,
        resultJson: { error: e.message.slice(0, 500) },
      }).catch(() => {});
    }
  } else {
    logActivity({
      agent: args.agentName,
      phase: "execute",
      action: "commit_nav",
      notes: "skipped — surfpool unreachable, NAV cannot be computed",
    });
    await logAgentAction({
      agentSns: args.agentName,
      actionType: "commit_nav_skipped",
      reasoning: "surfpool unreachable",
      resultJson: { skipped: true, reason: "surfpool unreachable" },
    }).catch(() => {});
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
