/**
 * action-executor.ts — dispatches BrainAction → on-chain/CLI executor.
 *
 * Contract:
 *   - ALL actions pass through enforceProgramPolicy() BEFORE any RPC call or
 *     CLI shell-out. A DENIED policy throws a structured Error that the
 *     daemon catches and logs under phase="execute_error".
 *   - Strategy actions (lend, lst, zerion_swap) land on SURFPOOL.
 *   - Market-creation actions land on DEVNET (persistent bounty evidence).
 *
 * Protocol dispatch is driven by the `protocol` field on lend/lst actions.
 * The LLM chooses the protocol freely; this table maps it to the correct
 * programId and instruction names for policy gating and future ix construction.
 *
 * MVP fallback: direct ix construction for lend/lst protocols is non-trivial
 * (requires fetching lookup tables, computing PDAs, etc.). We fall back to a
 * 1-lamport self-transfer on surfpool as a placeholder "strategy executed"
 * evidence tx. This is documented in the notes field of every result so the
 * honesty budget is preserved.
 */
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import { createNavMarket } from "../actions/create-nav-market.js";
import { stakeMarinade, unstakeMarinade } from "./beethoven-execute.js";
import { isMarketCreationRateLimited } from "./agents-source.js";
import { recordSurfpoolAction } from "./surfpool-recorder.js";
// @ts-expect-error — JS module, no type declarations provided
import { enforceProgramPolicy } from "../../../../../zerion-agent/src/bundie/program-enforcer.js";

import type {
  BrainAction,
  LendProtocol,
  LstProtocol,
  PerpProtocol,
} from "./redpill-brain.js";

// ─── Protocol dispatch tables ────────────────────────────────────────────

const LEND_PROGRAM: Record<LendProtocol, string> = {
  kamino:   "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  marginfi: "MFv2hWf31Z9kbCa1snEPdcgp7X3wCuuRcuDNmq1H5NE",
  solend:   "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo",
};

const LEND_IX: Record<LendProtocol, { deposit: string; withdraw: string }> = {
  kamino:   { deposit: "deposit_reserve_liquidity",  withdraw: "withdraw_reserve_liquidity" },
  marginfi: { deposit: "lending_account_deposit",    withdraw: "lending_account_withdraw" },
  solend:   { deposit: "deposit_reserve_liquidity",  withdraw: "redeem_reserve_collateral" },
};

const LST_PROGRAM: Record<LstProtocol, string> = {
  marinade: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
  jito:     "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy",
};

const PERP_PROGRAM: Record<PerpProtocol, string> = {
  // Zeta mainnet program — same id on the surfpool fork.
  zeta: "ZETAxsqBRek56DhiGXrn75yj2NHU3aYUnxvHXpkf3aD",
};

const PERP_IX: Record<PerpProtocol, { open: string; close: string }> = {
  zeta: { open: "place_perp_order_v3", close: "close_position" },
};

const LST_IX: Record<LstProtocol, { stake: string; unstake: string }> = {
  marinade: { stake: "deposit",     unstake: "liquid_unstake" },
  jito:     { stake: "deposit_sol", unstake: "withdraw_sol" },
};

const PREDICTION_MARKET_PROGRAM_ID =
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4";

export interface ExecuteActionArgs {
  action: BrainAction;
  agentName: string;
  /** Agent's SNS handle (e.g. "alice.bundie.sol") — used for Supabase rate-limit lookups. */
  agentSns: string;
  walletName: string;
  kp: Keypair;
  surfpool: Connection;
  surfpoolAvailable: boolean;
  devnet: Connection;
  policyPath: string;
}

export interface ExecuteActionResult {
  phase: "execute";
  chain: "surfpool" | "devnet" | "zerion-cli";
  action: string;
  protocol?: string;
  txSig?: string;
  marketPda?: string;
  explorerUrl?: string;
  policyGate?: string;
  notes?: string;
  /** True if the action was intentionally skipped (e.g. rate-limited). */
  skipped?: boolean;
  /** When skipped due to rate-limit, the wall-clock ms timestamp of the next allowed attempt. */
  nextAllowedAt?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function gate(policyPath: string, programId: string, ix: string): string {
  enforceProgramPolicy({ policyPath, programId, instructionName: ix });
  return `enforceProgramPolicy passed (${programId.slice(0, 4)}...${programId.slice(-4)}.${ix})`;
}

async function selfTransfer(conn: Connection, kp: Keypair): Promise<string> {
  const ix = SystemProgram.transfer({
    fromPubkey: kp.publicKey,
    toPubkey: kp.publicKey,
    lamports: 1,
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = kp.publicKey;
  return await sendAndConfirmTransaction(conn, tx, [kp], {
    commitment: "confirmed",
    skipPreflight: false,
  });
}

export async function isSurfpoolReachable(conn: Connection): Promise<boolean> {
  try {
    await conn.getSlot("confirmed");
    return true;
  } catch {
    return false;
  }
}

// ─── Executors ────────────────────────────────────────────────────────────

async function executeLend(
  args: ExecuteActionArgs,
  direction: "deposit" | "withdraw",
  protocol: LendProtocol,
): Promise<ExecuteActionResult> {
  const programId = LEND_PROGRAM[protocol];
  const ixName = LEND_IX[protocol][direction];
  const policyGate = gate(args.policyPath, programId, ixName);
  if (!args.surfpoolAvailable) {
    return {
      phase: "execute", chain: "surfpool",
      action: `lend_${direction}`, protocol,
      policyGate,
      notes: "surfpool unreachable — policy-gated but not submitted",
    };
  }
  // Real Kamino/MarginFi/Solend deposit CPIs are pending wiring (Phase Q).
  // For now we land a self-transfer on surfpool so the action is visible
  // in the agent-profile activity feed and the recorder pipeline gets
  // exercised end-to-end. The notes field flags this honestly.
  const txSig = await selfTransfer(args.surfpool, args.kp);
  const lendArgs = (args.action as { args?: { amountUsdcUi?: number; amountUi?: number } }).args;
  const amountUi = lendArgs?.amountUsdcUi ?? lendArgs?.amountUi ?? null;
  const amountLamports = amountUi != null ? Math.round(amountUi * 1_000_000) : null;
  const notes = `MVP placeholder: self-transfer on surfpool (${protocol} ${direction} ix pending)`;
  await persistSurfpoolAction(args, {
    protocol, txSig, actionType: `lend_${direction}`,
    amountLamports, notes,
  });
  return {
    phase: "execute", chain: "surfpool",
    action: `lend_${direction}`, protocol,
    txSig, policyGate, notes,
  };
}

async function executeLst(
  args: ExecuteActionArgs,
  direction: "stake" | "unstake",
  protocol: LstProtocol,
): Promise<ExecuteActionResult> {
  const programId = LST_PROGRAM[protocol];
  const ixName = LST_IX[protocol][direction];
  const policyGate = gate(args.policyPath, programId, ixName);

  // All strategy execution lands on surfpool now (the mainnet fork). Devnet
  // is reserved for prediction-market state + NAV commits. If surfpool is
  // unreachable we hard-fail the action — falling back to devnet would
  // produce real positions on a chain that doesn't reflect mainnet protocol
  // state, defeating the point of the simulation.
  if (!args.surfpoolAvailable) {
    return {
      phase: "execute", chain: "surfpool",
      action: `lst_${direction}`, protocol,
      policyGate,
      notes: "surfpool unreachable — policy-gated but not submitted",
    };
  }

  if (protocol === "marinade") {
    // Real Marinade CPI against the surfpool mainnet fork. The fork already
    // has Marinade's State / mSOL mint / liq-pool accounts populated from
    // mainnet, so the SDK's deposit + liquidUnstake builders work without
    // any per-chain rewiring. mSOL ends up in the agent's surfpool ATA.
    if (args.action.type !== "lst_stake" && args.action.type !== "lst_unstake") {
      throw new Error("lst type mismatch");
    }
    if (direction === "stake") {
      const amountSolUi = (args.action as { args: { amountSolUi: number } }).args.amountSolUi;
      const result = await stakeMarinade(args.surfpool, args.kp, amountSolUi);
      await persistSurfpoolAction(args, {
        protocol, txSig: result.txSig,
        actionType: "lst_stake",
        amountLamports: result.stakedLamports,
        notes: `Marinade stake: ${amountSolUi} SOL → mSOL @ ${result.mSolTokenAccount.slice(0, 8)}…`,
      });
      return {
        phase: "execute", chain: "surfpool", action: "lst_stake", protocol,
        txSig: result.txSig, policyGate,
        notes: `Marinade stake: ${amountSolUi} SOL → mSOL @ ${result.mSolTokenAccount.slice(0, 8)}…`,
      };
    } else {
      const amountMsolUi = (args.action as { args: { amountMsolUi: number } }).args.amountMsolUi;
      const result = await unstakeMarinade(args.surfpool, args.kp, amountMsolUi);
      await persistSurfpoolAction(args, {
        protocol, txSig: result.txSig,
        actionType: "lst_unstake",
        amountLamports: Math.floor(amountMsolUi * 1_000_000_000),
        notes: `Marinade liquid-unstake: ~${amountMsolUi} mSOL → SOL`,
      });
      return {
        phase: "execute", chain: "surfpool", action: "lst_unstake", protocol,
        txSig: result.txSig, policyGate,
        notes: `Marinade liquid-unstake: ~${amountMsolUi} mSOL → SOL`,
      };
    }
  }

  // Jito / SPL stake pool — stub until the SDK wiring lands. The brain
  // prompts already prefer Marinade unless the SPL premium beats it by
  // >100bps, so this rarely fires in practice.
  return {
    phase: "execute", chain: "surfpool",
    action: `lst_${direction}`, protocol,
    policyGate,
    notes: `${protocol} ${direction}: policy-gated, CPI pending (use marinade for live execution)`,
  };
}

async function executePerp(
  args: ExecuteActionArgs,
  direction: "open" | "close",
  protocol: PerpProtocol,
): Promise<ExecuteActionResult> {
  const programId = PERP_PROGRAM[protocol];
  const ixName = PERP_IX[protocol][direction];
  const policyGate = gate(args.policyPath, programId, ixName);
  if (!args.surfpoolAvailable) {
    return {
      phase: "execute", chain: "surfpool",
      action: `perp_${direction}`, protocol,
      policyGate,
      notes: "surfpool unreachable — policy-gated but not submitted",
    };
  }
  // Zeta perp CPI is multi-step (CrossMarginAccount init, deposit collateral,
  // PlacePerpOrderV3, refresh) — pending Phase Q wiring. For now we land a
  // self-transfer on surfpool so the action surfaces in the agent feed and
  // the recorder is exercised. The notes flag this honestly so the UI can
  // mark the row as "stub" until real CPIs land.
  const txSig = await selfTransfer(args.surfpool, args.kp);
  let market = "";
  let side: "long" | "short" | undefined;
  let notional: number | null = null;
  if (args.action.type === "perp_open") {
    market = args.action.args.market;
    side = args.action.args.side;
    notional = args.action.args.notionalUsd;
  } else if (args.action.type === "perp_close") {
    market = args.action.args.market;
  }
  const notes = direction === "open"
    ? `MVP placeholder: ${protocol} ${side} ${market} ${notional}USDC notional (Zeta CPI pending)`
    : `MVP placeholder: ${protocol} close ${market} (Zeta CPI pending)`;
  await persistSurfpoolAction(args, {
    protocol, txSig,
    actionType: `perp_${direction}`,
    amountLamports: notional != null ? Math.round(notional * 1_000_000) : null,
    notes,
  });
  return {
    phase: "execute", chain: "surfpool",
    action: `perp_${direction}`, protocol,
    txSig, policyGate, notes,
  };
}

/**
 * Single helper used by every surfpool executor (lend, lst, perp) so the
 * recorder write is uniform across protocols. Failure to persist must
 * never crash the daemon — surfpool_actions is a UI-only feed and the
 * tx itself has already landed by the time we're called.
 */
async function persistSurfpoolAction(
  args: ExecuteActionArgs,
  rec: {
    protocol: string;
    txSig: string;
    actionType: string;
    amountLamports: number | null;
    tokenMint?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  try {
    const slot = await args.surfpool.getSlot("confirmed");
    await recordSurfpoolAction({
      agentSns: args.agentName,
      slot,
      txSig: rec.txSig,
      // Cast — recordSurfpoolAction's enum is the legacy lend-only set; the
      // table column itself is a free-form text so any protocol slug works.
      protocol: rec.protocol as never,
      actionType: rec.actionType,
      amountLamports: rec.amountLamports,
      tokenMint: rec.tokenMint ?? null,
      notes: rec.notes ?? null,
    });
  } catch (e) {
    console.error(`[surfpool-recorder] persist failed for ${rec.txSig}: ${(e as Error).message}`);
  }
}


async function executeCreateMarket(
  args: ExecuteActionArgs,
): Promise<ExecuteActionResult> {
  if (args.action.type !== "create_market") throw new Error("type mismatch");
  const a = args.action.args;

  // ─── Rate limit (Phase O) ───────────────────────────────────────────────
  // At most 1 create_market per agent per 6 hours. The check reads recent
  // entries from agent_action_log in Supabase. Fail-open: if Supabase is
  // unavailable, isMarketCreationRateLimited returns { limited: false } so
  // local dev / legacy paths keep working.
  //
  // NOTE on logging: we deliberately do NOT call logAgentAction here. The
  // generic per-action logger in shared-tick.ts picks up this result and
  // writes a single row with action_type="create_market_skipped" — adding a
  // second insert here would duplicate it. The success-path log similarly
  // happens in shared-tick (action_type="create_market"), which is what
  // lastMarketCreationAtMs() reads to enforce the cooldown.
  const limit = await isMarketCreationRateLimited(args.agentSns);
  if (limit.limited) {
    return {
      phase: "execute",
      chain: "devnet",
      action: "create_market_skipped",
      skipped: true,
      nextAllowedAt: limit.nextAllowedAt,
      notes: `Rate limit: ${limit.reason} (next allowed at ${
        limit.nextAllowedAt ? new Date(limit.nextAllowedAt).toISOString() : "?"
      })`,
    };
  }

  // Validate kind early so a malformed brain payload fails before any RPC.
  const kind = a.kind;
  if (kind !== 1 && kind !== 2 && kind !== 3) {
    throw new Error(
      `create_market: unsupported kind ${String(kind)} (expected 1, 2, or 3)`,
    );
  }

  const { PublicKey } = await import("@solana/web3.js");

  let targetAgentA: import("@solana/web3.js").PublicKey;
  try {
    targetAgentA = new PublicKey(a.targetAgentA);
  } catch {
    throw new Error(
      `create_market: invalid targetAgentA pubkey "${a.targetAgentA}"`,
    );
  }

  let targetAgentB: import("@solana/web3.js").PublicKey | null = null;
  if (kind === 2) {
    if (!a.targetAgentB) {
      throw new Error("create_market: kind=2 requires targetAgentB");
    }
    try {
      targetAgentB = new PublicKey(a.targetAgentB);
    } catch {
      throw new Error(
        `create_market: invalid targetAgentB pubkey "${a.targetAgentB}"`,
      );
    }
  }

  if (targetAgentA.equals(args.kp.publicKey)) {
    throw new Error(
      "create_market: targetAgentA must not equal creator (insider guard)",
    );
  }
  if (targetAgentB && targetAgentB.equals(args.kp.publicKey)) {
    throw new Error(
      "create_market: targetAgentB must not equal creator (insider guard)",
    );
  }
  if (targetAgentB && targetAgentA.equals(targetAgentB)) {
    throw new Error("create_market: kind=2 needs distinct A/B");
  }

  // Per-kind payload args.
  const thresholdLamports =
    kind === 1
      ? BigInt(Math.max(1, Math.floor(a.thresholdLamports ?? 0)))
      : undefined;
  const drawdownBps =
    kind === 3 ? BigInt(Math.max(1, Math.floor(a.drawdownBps ?? 0))) : undefined;

  if (kind === 1 && (!thresholdLamports || thresholdLamports <= 0n)) {
    throw new Error("create_market: kind=1 requires thresholdLamports > 0");
  }
  if (
    kind === 3 &&
    (!drawdownBps || drawdownBps <= 0n || drawdownBps > 10_000n)
  ) {
    throw new Error("create_market: kind=3 requires drawdownBps in [1, 10000]");
  }

  const currentSlot = BigInt(await args.devnet.getSlot("confirmed"));
  const windowSlots = BigInt(Math.max(1, Math.floor(a.windowSlots)));
  const resolutionSlot = currentSlot + windowSlots;
  const question = (a.questionTemplate?.trim() || `NAV market kind=${kind}`).slice(
    0,
    128,
  );

  // Seed amount: clamp to 1–10 bUSD, convert to 6dp base units.
  const seedBusd = Math.min(10, Math.max(1, a.seedAmountBusd ?? 2));
  const initialSubsidy = BigInt(Math.round(seedBusd * 1_000_000));

  const result = await createNavMarket({
    connection: args.devnet,
    creatorVault: args.kp,
    kind,
    targetAgentA,
    targetAgentB,
    thresholdLamports,
    drawdownBps,
    question,
    marketId: BigInt(Date.now()),
    resolutionSlot,
    initialSubsidy,
    feeBps: 100,
    policyPath: args.policyPath,
  });

  return {
    phase: "execute",
    chain: "devnet",
    action: "create_market",
    txSig: result.signature,
    marketPda: result.marketPda,
    explorerUrl: `https://orbmarkets.io/tx/${result.signature}?cluster=devnet`,
    policyGate:
      result.policyGate ??
      `enforceProgramPolicy passed (${PREDICTION_MARKET_PROGRAM_ID.slice(0, 4)}...create_market_v2)`,
    notes: `kind=${kind} seeded ${seedBusd} bUSD initial liquidity`,
  };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────

export async function executeAction(
  args: ExecuteActionArgs,
): Promise<ExecuteActionResult> {
  const { action } = args;
  switch (action.type) {
    case "noop":
      return { phase: "execute", chain: "surfpool", action: "noop", notes: "brain returned noop" };
    case "lend_deposit":
      return executeLend(args, "deposit", action.protocol);
    case "lend_withdraw":
      return executeLend(args, "withdraw", action.protocol);
    case "lst_stake":
      return executeLst(args, "stake", action.protocol);
    case "lst_unstake":
      return executeLst(args, "unstake", action.protocol);
    case "perp_open":
      return executePerp(args, "open", action.protocol);
    case "perp_close":
      return executePerp(args, "close", action.protocol);
    case "create_market":
      return executeCreateMarket(args);
    default: {
      const exhaustive: never = action;
      throw new Error(`unhandled action type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
