/**
 * shared-tick.ts — the canonical observe→reason→execute→log cycle.
 *
 * Every agent (alice, bob, charlie) runs this same function. Personality
 * differences are in their brain.md; budget differences are in their
 * policies.yaml. There are NO hardcoded per-agent branches here.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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
  computeNavBreakdown,
  syncTreasuryToPerformance,
} from "../lib/commit-nav-helper.js";
import { readSurfpoolTokenBalances } from "../lib/balances.js";
import { logAgentAction } from "../lib/agents-source.js";
import { dbQuery } from "../lib/db.js";

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
  /** Live mainnet RPC used ONLY for Pyth oracle reads inside the NAV
   *  pricing path. Token balances, Kamino reserves, Solend obligations,
   *  Jupiter Perps, and every other position read still target
   *  `surfpool`. Falls back to `surfpool` when the daemon was launched
   *  without `MAINNET_RPC_URL` (legacy behaviour). */
  mainnet: Connection;
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

/**
 * Per-agent state used to throttle expensive LLM calls without skipping
 * cheap on-chain side-effects (commit_nav, treasury-sync).
 *
 *   tickCount       — monotonic per-process counter; brain runs every Nth tick
 *   lastInputHash   — hash of the brain's input (rates + self + peer NAVs);
 *                     when the next tick's hash matches we skip the LLM call
 *                     because there's nothing new to reason about
 */
interface PerAgentState {
  tickCount: number;
  lastInputHash: string;
}
const agentState = new Map<string, PerAgentState>();

/** Per-agent timestamp of the last fork_reset_detected log emission. Used
 *  to dedupe log spam when a reset takes >1 tick to recover (we don't
 *  want a "fork_reset_detected" row every 15s for the same outage). */
const lastForkResetLogMs = new Map<string, number>();
const FORK_RESET_LOG_DEDUP_MS = 60_000;

/** Force the brain to run every Nth supervisor cycle even when the input
 *  hash hasn't changed. Lower bound on staleness — without this, a totally
 *  flat market would mean the brain literally never re-runs. */
const BRAIN_FORCE_EVERY = Number(
  process.env.CHAOS_SIM_BRAIN_FORCE_EVERY ?? 3,
);

/** Build a stable hash of the brain's decision-relevant inputs. Two ticks
 *  with the same hash should produce the same decision, so we can skip the
 *  LLM call on the second one. We deliberately exclude `slot` (changes
 *  every tick by definition) and round balances + peer NAVs to coarse
 *  buckets so sub-cent jitter doesn't trigger a re-think. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hashBrainInput(state: { rates: any; self: any; peers: any }): string {
  const round2 = (n: unknown) =>
    typeof n === "number" ? Math.round(n * 100) / 100 : 0;
  const ratesNorm = Object.fromEntries(
    Object.entries(state.rates ?? {})
      .filter(([k]) => k !== "chain" && k !== "kaminoReserve")
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  // Peers come from readPeerNavs as `{ name, owner, sol, lamports }`.
  // `owner` is the vault pubkey base58; `sol` is the readable NAV in SOL.
  // Bucket NAV to 2 decimals so commit_nav noise doesn't churn the hash.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const peersList: any[] = Array.isArray(state.peers) ? state.peers : [];
  const peersNorm = peersList
    .map((p) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pk: String((p as any)?.owner ?? (p as any)?.pubkey ?? ""),
      nav: round2((p as { sol?: number; lamports?: number })?.sol ?? 0),
    }))
    .filter((p) => p.pk.length > 0)
    .sort((a, b) => a.pk.localeCompare(b.pk));
  const payload = JSON.stringify({
    rates: ratesNorm,
    self: {
      sol: round2(state.self?.sol),
      usdc: round2(state.self?.usdc),
      msol: round2(state.self?.msol),
    },
    peers: peersNorm,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
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

  // Surface own pubkey explicitly so the brain has a NAMED value to
  // exclude when picking targetAgentA / targetAgentB. Without this the
  // LLM has hallucinated its own pubkey by stitching characters from
  // peers[] / history, producing create_market actions that the
  // executor rejects with "targetAgentA must not equal creator
  // (insider guard)".
  const selfWithPubkey = {
    ...selfNav,
    pubkey: args.kp.publicKey.toBase58(),
  };
  const state = {
    observedFrom: observeChain,
    surfpoolReachable: surfpoolAvailable,
    slot: await observeConn.getSlot("confirmed").catch(() => null),
    self: selfWithPubkey,
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
      `jito=${rates.splStakePoolAboveBps}bps  ` +
      `jupPerpFunding=${rates.jupSolPerpFundingBps}bps  ` +
      `selfSol=${selfNav.sol.toFixed(4)} selfUsdc=${selfNav.usdc.toFixed(2)} selfMsol=${selfNav.msol.toFixed(4)}`,
  );

  // ─── 2. Reason (Redpill) ───────────────────────────────────────────────
  // Two-layer LLM-cost throttle:
  //   (a) Force-cadence: only run the brain every Nth supervisor tick.
  //       commit_nav still fires on the off-ticks so the on-chain NAV
  //       pulse is unchanged from a viewer's perspective.
  //   (b) Input-hash skip: if the brain's input is bit-for-bit identical
  //       to last successful tick (rates, self balances, peer NAVs all
  //       unchanged at 2-decimal precision), skip the LLM call — the
  //       decision wouldn't change.
  // Both skips fall through to a synthetic noop decision; commit_nav
  // continues unconditionally below.
  const inputHash = hashBrainInput({
    rates,
    self: selfNav,
    peers: peerNavs,
  });
  const prev = agentState.get(args.agentName) ?? {
    tickCount: 0,
    lastInputHash: "",
  };
  const tickIdx = prev.tickCount;
  agentState.set(args.agentName, {
    tickCount: prev.tickCount + 1,
    lastInputHash: inputHash,
  });
  const cadenceForced = tickIdx % BRAIN_FORCE_EVERY === 0;
  const inputUnchanged = prev.lastInputHash === inputHash;
  const skipBrain = !cadenceForced && inputUnchanged;

  const brainPrompt = readFileSync(args.brainPromptPath, "utf8");
  const allowlist = extractAllowlist(args.policyPath);
  const history = tailActivity(args.agentName, 20);

  let decision: BrainDecision;
  if (skipBrain) {
    console.log(
      `[tick ${args.agentName}] brain skipped (input unchanged, tick ${tickIdx})`,
    );
    logActivity({
      agent: args.agentName,
      phase: "reason",
      reasoning: "skipped: inputs unchanged",
      skipped: true,
    });
    decision = {
      reasoning: "Inputs unchanged since last tick — holding current allocation.",
      actions: [{ type: "noop" }],
    };
  } else {
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
      const breakdown = await computeNavBreakdown(
        args.surfpool,
        args.mainnet,
        args.kp.publicKey,
      );
      const {
        navLamports,
        baseUsdMicros,
        kaminoUsdMicros,
        solendUsdMicros,
        perpsUsdMicros,
      } = breakdown;
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

      // Mirror the commit into the nav_snapshots time-series so the UI's
      // P&L route can chart equity curves without re-reading every
      // BundieVault account on the RPC. `commitNavToDevnet` doesn't
      // return the slot it landed in, so fetch a fresh confirmed slot —
      // close enough for charting (the row's `ts` is the source of truth
      // for ordering anyway).
      let navSlot: number | null = null;
      try {
        navSlot = await args.devnet.getSlot("confirmed");
      } catch {
        // Best-effort; nav_slot is nullable in the schema.
      }
      await dbQuery(
        `insert into nav_snapshots
           (agent_sns, nav_epoch, nav_lamports, nav_slot,
            base_usd_micros, kamino_usd_micros, solend_usd_micros, perps_usd_micros)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (agent_sns, nav_epoch) do nothing`,
        [
          args.agentName,
          commit.epoch,
          navLamports.toString(),
          navSlot,
          baseUsdMicros.toString(),
          kaminoUsdMicros.toString(),
          solendUsdMicros.toString(),
          perpsUsdMicros.toString(),
        ],
      ).catch(() => {});

      // Capture the post-warmup starting NAV exactly once per agent. This
      // is the honest baseline for the "all-time return" stat — anchoring
      // to the FIRST nav_snapshots row picks up the pre-warmup transient
      // (~$11.92 fee buffer) and inflates returns to +4894 bps the moment
      // the 5 SOL + 100 USDC airdrop lands. Predicate gates this to the
      // first commit_nav AFTER warmup completes; subsequent ticks no-op
      // because `post_warmup_starting_nav_lamports IS NULL` no longer
      // holds. Cleared again by the fork-reset path below so the rebuild
      // re-seeds the baseline at the new post-warmup NAV.
      await dbQuery(
        `UPDATE agents
            SET post_warmup_starting_nav_lamports = $1,
                post_warmup_starting_ts = $2
          WHERE sns = $3
            AND warmup_done_at IS NOT NULL
            AND post_warmup_starting_nav_lamports IS NULL`,
        [navLamports.toString(), new Date().toISOString(), args.agentName],
      ).catch(() => {});

      // ─── Fork-reset auto-detector ────────────────────────────────────
      // Heuristic: NAV has collapsed to <= 5x the supervisor's SOL fee
      // buffer AND the previous snapshot for this agent was substantially
      // higher. The supervisor maintains 0.1 SOL ~= $10-20, so a NAV under
      // $30 (30_000_000 micros) while the prior snapshot was >$80
      // (80_000_000 micros) is a near-certain surfpool fork reset.
      //
      // On detection: log loudly, clear `agents.warmup_done_at`, and skip
      // further work this tick — the warmup loop will re-airdrop + re-seed
      // within seconds. Best-effort: SQL failures don't crash the daemon.
      try {
        const priorRes = await dbQuery<{ nav_lamports: string }>(
          `SELECT nav_lamports FROM nav_snapshots
            WHERE agent_sns = $1
            ORDER BY ts DESC
            LIMIT 1 OFFSET 1`,
          [args.agentName],
        );
        const priorRaw = priorRes?.rows[0]?.nav_lamports;
        if (priorRaw != null) {
          const priorNav = BigInt(priorRaw);
          const currNav = BigInt(navLamports);
          const PRIOR_FLOOR = 80_000_000n; // $80 in 6dp micros
          const CURR_CEILING = 30_000_000n; // $30 in 6dp micros
          if (priorNav > PRIOR_FLOOR && currNav < CURR_CEILING) {
            // Dedup logging: a sustained outage (e.g. surfpool down for
            // minutes) would otherwise emit a `fork_reset_detected` row
            // every 15s for the same incident. Limit to one log every
            // FORK_RESET_LOG_DEDUP_MS per agent. The DB UPDATE below is
            // idempotent so we always run it — the dedup only suppresses
            // the noisy log + activity rows.
            const lastLogMs = lastForkResetLogMs.get(args.agentName) ?? 0;
            const shouldLog = Date.now() - lastLogMs >= FORK_RESET_LOG_DEDUP_MS;
            if (shouldLog) {
              lastForkResetLogMs.set(args.agentName, Date.now());
              console.warn(
                `[tick ${args.agentName}] FORK-RESET DETECTED — ` +
                  `nav collapsed ${priorNav.toString()} → ${currNav.toString()} ` +
                  `(prior > $80, current < $30). Clearing warmup_done_at; ` +
                  `warmup loop will re-airdrop + re-seed within seconds.`,
              );
              logActivity({
                agent: args.agentName,
                phase: "daemon",
                event: "fork_reset_detected",
                priorNavLamports: priorNav.toString(),
                currNavLamports: currNav.toString(),
                note: "cleared warmup_done_at; warmup loop will re-seed",
              });
              await logAgentAction({
                agentSns: args.agentName,
                actionType: "fork_reset_detected",
                reasoning: null,
                resultJson: {
                  priorNavLamports: priorNav.toString(),
                  currNavLamports: currNav.toString(),
                },
              }).catch(() => {});
            }
            await dbQuery(
              `UPDATE agents SET warmup_done_at = NULL,
                                  post_warmup_starting_nav_lamports = NULL,
                                  post_warmup_starting_ts = NULL
                WHERE sns = $1`,
              [args.agentName],
            ).catch(() => {});
            // Skip treasury-sync below — re-warmup will reseed first.
            return;
          }
        }
      } catch {
        // Best-effort: never crash the daemon on a detection-path SQL error.
      }

      // bUSD treasury performance-sync: mirror the agent's surfpool NAV
      // 1:1 onto the on-chain bUSD treasury. Mint-only (no burn path
      // yet — see helper docstring). Best-effort; failure doesn't break
      // the rest of the tick.
      if (
        args.busdMintAuthority &&
        args.busdMintPubkey &&
        args.vaultPda
      ) {
        try {
          const result = await syncTreasuryToPerformance({
            connection: args.devnet,
            busdMintAuthority: args.busdMintAuthority,
            busdMintPubkey: args.busdMintPubkey,
            vaultPda: args.vaultPda,
            agentPubkey: args.kp.publicKey,
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
