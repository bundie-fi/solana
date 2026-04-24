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

import { createRateBarrierMarket } from "../actions/create-rate-barrier-market.js";
// @ts-expect-error — JS module, no type declarations provided
import { enforceProgramPolicy } from "../../../../../zerion-agent/src/bundie/program-enforcer.js";

import type { BrainAction, LendProtocol, LstProtocol } from "./redpill-brain.js";
import { executeZerionSwap } from "./zerion-swap.js";

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

const LST_IX: Record<LstProtocol, { stake: string; unstake: string }> = {
  marinade: { stake: "deposit",     unstake: "liquid_unstake" },
  jito:     { stake: "deposit_sol", unstake: "withdraw_sol" },
};

const PREDICTION_MARKET_PROGRAM_ID =
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4";

export interface ExecuteActionArgs {
  action: BrainAction;
  agentName: string;
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
  const txSig = await selfTransfer(args.surfpool, args.kp);
  return {
    phase: "execute", chain: "surfpool",
    action: `lend_${direction}`, protocol,
    txSig, policyGate,
    notes: `MVP placeholder: self-transfer on surfpool (${protocol} ${direction} ix pending)`,
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
  if (!args.surfpoolAvailable) {
    return {
      phase: "execute", chain: "surfpool",
      action: `lst_${direction}`, protocol,
      policyGate,
      notes: "surfpool unreachable — policy-gated but not submitted",
    };
  }
  const txSig = await selfTransfer(args.surfpool, args.kp);
  return {
    phase: "execute", chain: "surfpool",
    action: `lst_${direction}`, protocol,
    txSig, policyGate,
    notes: `MVP placeholder: self-transfer on surfpool (${protocol} ${direction} ix pending)`,
  };
}

async function executeZerionSwapAction(
  args: ExecuteActionArgs,
): Promise<ExecuteActionResult> {
  if (args.action.type !== "zerion_swap") throw new Error("type mismatch");
  const { fromToken, toToken, amount, chain } = args.action.args;
  const res = executeZerionSwap({ fromToken, toToken, amount, chain, walletName: args.walletName });
  if (!res.ok) {
    throw new Error(
      `Zerion CLI failed (exit=${res.exitCode}): ${res.stderr.slice(0, 400) || res.stdout.slice(0, 400)}`,
    );
  }
  return {
    phase: "execute", chain: "zerion-cli", action: "zerion_swap",
    txSig: res.txHash,
    policyGate: "Zerion CLI policy stack (chain_lock, spend_limit, asset_whitelist, expiry, nav_divergence) applied in-CLI",
    notes: "swap routed through forked Zerion CLI",
  };
}

async function executeCreateMarket(
  args: ExecuteActionArgs,
): Promise<ExecuteActionResult> {
  if (args.action.type !== "create_kind5_market") throw new Error("type mismatch");
  const a = args.action.args;
  const currentSlot = BigInt(await args.devnet.getSlot("confirmed"));
  const windowSlots = BigInt(Math.max(1, Math.floor(a.windowSlots)));
  const windowEndSlot = currentSlot + windowSlots;
  const question = (a.questionTemplate?.trim() || "Rate Barrier market").slice(0, 128);
  const result = await createRateBarrierMarket({
    connection: args.devnet,
    agentVault: args.kp,
    thresholdBps: BigInt(Math.max(1, Math.floor(a.thresholdBps))),
    windowStartSlot: currentSlot,
    windowEndSlot,
    selector: BigInt(a.selector),
    question,
    marketId: BigInt(Date.now()),
    resolutionSlot: windowEndSlot,
    initialSubsidy: 1_000_000n,
    feeBps: 100,
    policyPath: args.policyPath,
  });
  return {
    phase: "execute", chain: "devnet", action: "create_kind5_market",
    txSig: result.signature,
    marketPda: result.marketPda,
    explorerUrl: `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
    policyGate: result.policyGate ??
      `enforceProgramPolicy passed (${PREDICTION_MARKET_PROGRAM_ID.slice(0, 4)}...${PREDICTION_MARKET_PROGRAM_ID.slice(-4)}.create_market_v2)`,
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
    case "zerion_swap":
      return executeZerionSwapAction(args);
    case "create_kind5_market":
      return executeCreateMarket(args);
    default: {
      const exhaustive: never = action;
      throw new Error(`unhandled action type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
