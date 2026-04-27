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
// zeta-execute is dynamically imported in executePerp to avoid eagerly loading
// @zetamarkets/sdk and its @bloxroute transitive (which imports an old
// rpc-websockets subpath). Eager load would crash the daemon at startup.
import { depositKamino, withdrawKamino } from "./kamino-execute.js";
import { depositMarginfi, withdrawMarginfi } from "./marginfi-execute.js";
import { depositSolend, withdrawSolend } from "./solend-execute.js";
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

  const lendArgs = (args.action as { args?: { amountUsdcUi?: number; amountUi?: number; reserveAddress?: string } }).args;
  const amountUi = lendArgs?.amountUsdcUi ?? lendArgs?.amountUi ?? null;
  if (amountUi == null || amountUi <= 0) {
    throw new Error(
      `lend_${direction} ${protocol}: amount must be > 0 (got ${amountUi})`,
    );
  }
  const reserveAddress = lendArgs?.reserveAddress;

  // ─── Real CPI dispatch ────────────────────────────────────────────────
  //
  // Each (protocol × direction) pair routes to its dedicated executor.
  // Failures HARD-FAIL (re-throw) — the daemon's per-action try/catch
  // surfaces them as phase=execute_error rather than us silently falling
  // back to a placeholder self-transfer that would imply success.
  //
  // The MarginFi + Solend executors are stubbed today (their SDKs are not
  // installed yet in packages/programs/package.json); the stubs throw a
  // descriptive error so the action log shows the missing-dependency state
  // instead of a fake placeholder row. Add the SDKs and replace the stubs
  // in marginfi-execute.ts / solend-execute.ts to flip them to real CPIs.
  try {
    if (protocol === "kamino" && direction === "deposit") {
      const result = await depositKamino({
        surfpool: args.surfpool,
        vault: args.kp,
        amountUsdcUi: amountUi,
        reserveAddress,
      });
      const notes =
        `Kamino deposit: ${amountUi} USDC → reserve ${result.reserveAddress.slice(0, 8)}… ` +
        `(${result.ixCount} ixs)`;
      await persistSurfpoolAction(args, {
        protocol, txSig: result.txSig, actionType: "lend_deposit",
        amountLamports: result.amountBaseUnits,
        tokenMint: result.reserveLiquidityMint,
        notes,
      });
      return {
        phase: "execute", chain: "surfpool",
        action: "lend_deposit", protocol,
        txSig: result.txSig, policyGate, notes,
      };
    }

    if (protocol === "kamino" && direction === "withdraw") {
      const result = await withdrawKamino({
        surfpool: args.surfpool,
        vault: args.kp,
        amountUsdcUi: amountUi,
        reserveAddress,
      });
      const notes =
        `Kamino withdraw: ${amountUi} USDC ← reserve ${result.reserveAddress.slice(0, 8)}… ` +
        `(${result.ixCount} ixs)`;
      await persistSurfpoolAction(args, {
        protocol, txSig: result.txSig, actionType: "lend_withdraw",
        amountLamports: result.amountBaseUnits,
        tokenMint: result.reserveLiquidityMint,
        notes,
      });
      return {
        phase: "execute", chain: "surfpool",
        action: "lend_withdraw", protocol,
        txSig: result.txSig, policyGate, notes,
      };
    }

    if (protocol === "marginfi" && direction === "deposit") {
      const result = await depositMarginfi({
        surfpool: args.surfpool,
        vault: args.kp,
        amountUi,
        bankAddress: reserveAddress,
      });
      const notes =
        `MarginFi deposit: ${amountUi} USDC → bank ${result.bankAddress.slice(0, 8)}… ` +
        `acct ${result.marginfiAccount.slice(0, 8)}… (${result.ixCount} ixs)`;
      await persistSurfpoolAction(args, {
        protocol, txSig: result.txSig, actionType: "lend_deposit",
        amountLamports: result.amountBaseUnits,
        tokenMint: result.bankMint,
        notes,
      });
      return {
        phase: "execute", chain: "surfpool",
        action: "lend_deposit", protocol,
        txSig: result.txSig, policyGate, notes,
      };
    }

    if (protocol === "marginfi" && direction === "withdraw") {
      const result = await withdrawMarginfi({
        surfpool: args.surfpool,
        vault: args.kp,
        amountUi,
        bankAddress: reserveAddress,
      });
      const notes =
        `MarginFi withdraw: ${amountUi} USDC ← bank ${result.bankAddress.slice(0, 8)}… ` +
        `acct ${result.marginfiAccount.slice(0, 8)}… (${result.ixCount} ixs)`;
      await persistSurfpoolAction(args, {
        protocol, txSig: result.txSig, actionType: "lend_withdraw",
        amountLamports: result.amountBaseUnits,
        tokenMint: result.bankMint,
        notes,
      });
      return {
        phase: "execute", chain: "surfpool",
        action: "lend_withdraw", protocol,
        txSig: result.txSig, policyGate, notes,
      };
    }

    if (protocol === "solend" && direction === "deposit") {
      const result = await depositSolend({
        surfpool: args.surfpool,
        vault: args.kp,
        amountUsdcUi: amountUi,
        reserveAddress,
      });
      const notes =
        `Solend deposit: ${amountUi} USDC → reserve ${result.reserveAddress.slice(0, 8)}… ` +
        `(${result.ixCount} ixs)`;
      await persistSurfpoolAction(args, {
        protocol, txSig: result.txSig, actionType: "lend_deposit",
        amountLamports: result.amountBaseUnits,
        tokenMint: result.reserveLiquidityMint,
        notes,
      });
      return {
        phase: "execute", chain: "surfpool",
        action: "lend_deposit", protocol,
        txSig: result.txSig, policyGate, notes,
      };
    }

    if (protocol === "solend" && direction === "withdraw") {
      const result = await withdrawSolend({
        surfpool: args.surfpool,
        vault: args.kp,
        amountUsdcUi: amountUi,
        reserveAddress,
      });
      const notes =
        `Solend withdraw: ${amountUi} USDC ← reserve ${result.reserveAddress.slice(0, 8)}… ` +
        `(${result.ixCount} ixs)`;
      await persistSurfpoolAction(args, {
        protocol, txSig: result.txSig, actionType: "lend_withdraw",
        amountLamports: result.amountBaseUnits,
        tokenMint: result.reserveLiquidityMint,
        notes,
      });
      return {
        phase: "execute", chain: "surfpool",
        action: "lend_withdraw", protocol,
        txSig: result.txSig, policyGate, notes,
      };
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[lend ${protocol} ${direction}] failed: ${msg}`);
    // Hard-fail. The daemon's per-action try/catch records this as
    // phase=execute_error; we deliberately do NOT fall back to a
    // self-transfer placeholder, because a failed real attempt is more
    // useful operational signal than a fake-success row.
    throw new Error(`${protocol} ${direction} failed: ${msg}`);
  }

  // Defensive: every supported (protocol × direction) returns above. If
  // we get here a new LendProtocol slipped in without an executor — the
  // exhaustiveness check exists to fail loudly during typecheck rather
  // than silently emit a placeholder.
  const exhaustive: never = protocol as never;
  throw new Error(
    `lend_${direction}: unhandled protocol ${String(exhaustive)}`,
  );
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

  // Hard-fail when the surfpool fork is unreachable — Zeta perps cannot
  // safely fall back to devnet (Zeta's mainnet CrossMargin program isn't
  // deployed there). The activity feed still gets a "policy-gated, not
  // submitted" row via the early return below.
  if (!args.surfpoolAvailable) {
    return {
      phase: "execute", chain: "surfpool",
      action: `perp_${direction}`, protocol,
      policyGate,
      notes: "surfpool unreachable — policy-gated but not submitted",
    };
  }

  // PerpProtocol is currently the singleton union "zeta", but be
  // forward-compatible if a new venue is added.
  if (protocol !== "zeta") {
    return {
      phase: "execute", chain: "surfpool",
      action: `perp_${direction}`, protocol,
      policyGate,
      notes: `${protocol} ${direction}: policy-gated, perp CPI pending`,
    };
  }

  if (direction === "open") {
    if (args.action.type !== "perp_open") {
      throw new Error("perp type mismatch (expected perp_open)");
    }
    const { market, side, notionalUsd } = args.action.args;
    const { openZetaPerp } = await import("./zeta-execute.js");
    const result = await openZetaPerp(
      args.surfpool, args.kp, market, side, notionalUsd,
    );
    const notes =
      `Zeta ${side} ${market} notional=$${notionalUsd} ` +
      `size=${result.size.toFixed(4)} mark=$${result.markPrice.toFixed(4)} ` +
      `cma=${result.crossMarginAccount.slice(0, 8)}…`;
    await persistSurfpoolAction(args, {
      protocol: "zeta",
      txSig: result.txSig,
      actionType: "perp_open",
      // Native USDC = 6dp. The recorder column is named "amountLamports"
      // by convention but stores any base-unit integer.
      amountLamports: Math.round(notionalUsd * 1_000_000),
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      notes,
    });
    return {
      phase: "execute", chain: "surfpool",
      action: "perp_open", protocol: "zeta",
      txSig: result.txSig, policyGate, notes,
    };
  }

  // direction === "close"
  if (args.action.type !== "perp_close") {
    throw new Error("perp type mismatch (expected perp_close)");
  }
  const { market } = args.action.args;
  const { closeZetaPerp } = await import("./zeta-execute.js");
  const result = await closeZetaPerp(args.surfpool, args.kp, market);

  if (result.flat) {
    // Nothing to flatten — informational return without a recorder row
    // (no tx sig to anchor it to).
    return {
      phase: "execute", chain: "surfpool",
      action: "perp_close", protocol: "zeta",
      policyGate,
      notes: `Zeta close ${market}: position already flat (no-op)`,
    };
  }

  const closeTxSig = result.txSig as string;
  const notes =
    `Zeta close ${market} sizeBefore=${result.positionBefore.toFixed(4)} ` +
    `mark=$${result.markPrice.toFixed(4)} ` +
    `cma=${result.crossMarginAccount.slice(0, 8)}…`;
  await persistSurfpoolAction(args, {
    protocol: "zeta",
    txSig: closeTxSig,
    actionType: "perp_close",
    // Approximate close notional (|size| × mark, 6dp USDC).
    amountLamports: Math.round(
      Math.abs(result.positionBefore) * result.markPrice * 1_000_000,
    ),
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    notes,
  });
  return {
    phase: "execute", chain: "surfpool",
    action: "perp_close", protocol: "zeta",
    txSig: closeTxSig, policyGate, notes,
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
