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

import { createAgentVsBenchmarkMarket } from "../actions/create-agent-vs-benchmark-market.js";
import { stakeMarinade, unstakeMarinade } from "./beethoven-execute.js";
import { recordSurfpoolAction } from "./surfpool-recorder.js";
// @ts-expect-error — JS module, no type declarations provided
import { enforceProgramPolicy } from "../../../../../zerion-agent/src/bundie/program-enforcer.js";

import type { BrainAction, LendProtocol, LstProtocol } from "./redpill-brain.js";

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
  const notes = `MVP placeholder: self-transfer on surfpool (${protocol} ${direction} ix pending)`;
  // Persist to Supabase so the web app can render this in the agent profile
  // surfpool feed. Surfpool has no public explorer; this is the only way for
  // visitors to see live agent activity. Failure to persist must NOT crash
  // the daemon — recordSurfpoolAction handles its own errors internally.
  try {
    const slot = await args.surfpool.getSlot("confirmed");
    const lendArgs = (args.action as { args?: { amountUsdcUi?: number; amountUi?: number } }).args;
    const amountUi = lendArgs?.amountUsdcUi ?? lendArgs?.amountUi ?? null;
    // USDC has 6 decimals — use base units (not lamports per se, but the
    // smallest unit of the deposited token). Stored in amount_base_units;
    // decimals are inferred per-token at read time on the web side.
    const amountLamports = amountUi != null ? Math.round(amountUi * 1_000_000) : null;
    await recordSurfpoolAction({
      agentSns: args.agentName,
      slot,
      txSig,
      protocol,
      actionType: `lend_${direction}`,
      amountLamports,
      tokenMint: null,
      notes,
    });
  } catch (e) {
    console.error(`[surfpool-recorder] persist failed for ${txSig}: ${(e as Error).message}`);
  }
  return {
    phase: "execute", chain: "surfpool",
    action: `lend_${direction}`, protocol,
    txSig, policyGate,
    notes,
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

  if (protocol === "marinade") {
    // Real Beethoven-pattern execution on devnet. The vault holds actual mSOL
    // after staking, which the resolution program can read at settlement time.
    if (args.action.type !== "lst_stake" && args.action.type !== "lst_unstake") {
      throw new Error("lst type mismatch");
    }
    if (direction === "stake") {
      const amountSolUi = (args.action as { args: { amountSolUi: number } }).args.amountSolUi;
      const result = await stakeMarinade(args.devnet, args.kp, amountSolUi);
      return {
        phase: "execute", chain: "devnet", action: "lst_stake", protocol,
        txSig: result.txSig, policyGate,
        notes: `Marinade stake: ${amountSolUi} SOL → mSOL @ ${result.mSolTokenAccount.slice(0, 8)}…`,
      };
    } else {
      const amountMsolUi = (args.action as { args: { amountMsolUi: number } }).args.amountMsolUi;
      const result = await unstakeMarinade(args.devnet, args.kp, amountMsolUi);
      return {
        phase: "execute", chain: "devnet", action: "lst_unstake", protocol,
        txSig: result.txSig, policyGate,
        notes: `Marinade liquid-unstake: ~${amountMsolUi} mSOL → SOL`,
      };
    }
  }

  // Other LST protocols (jito etc.) — stub until Beethoven CPI is wired.
  return {
    phase: "execute", chain: "devnet",
    action: `lst_${direction}`, protocol,
    policyGate,
    notes: `${protocol} ${direction}: policy-gated, CPI pending (use marinade for live execution)`,
  };
}


async function executeCreateMarket(
  args: ExecuteActionArgs,
): Promise<ExecuteActionResult> {
  if (args.action.type !== "create_market") throw new Error("type mismatch");
  const a = args.action.args;

  let targetAgent: import("@solana/web3.js").PublicKey;
  try {
    const { PublicKey } = await import("@solana/web3.js");
    targetAgent = new PublicKey(a.targetAgent);
  } catch {
    throw new Error(`create_market: invalid targetAgent pubkey "${a.targetAgent}"`);
  }

  if (targetAgent.equals(args.kp.publicKey)) {
    throw new Error("create_market: targetAgent must not equal creator (insider guard)");
  }

  const currentSlot = BigInt(await args.devnet.getSlot("confirmed"));
  const windowSlots = BigInt(Math.max(1, Math.floor(a.windowSlots)));
  const windowEndSlot = currentSlot + windowSlots;
  const question = (a.questionTemplate?.trim() || "Agent vs Benchmark market").slice(0, 128);

  // Seed amount: clamp to 1–10 USDC, convert to 6dp base units
  const seedUsdc = Math.min(10, Math.max(1, a.seedAmountUsdc ?? 2));
  const initialSubsidy = BigInt(Math.round(seedUsdc * 1_000_000));

  const result = await createAgentVsBenchmarkMarket({
    connection: args.devnet,
    creatorVault: args.kp,
    targetAgent,
    spreadBps: BigInt(Math.max(1, Math.floor(a.spreadBps))),
    windowStartSlot: currentSlot,
    windowEndSlot,
    benchmarkSelector: BigInt(a.selector),
    question,
    marketId: BigInt(Date.now()),
    resolutionSlot: windowEndSlot,
    initialSubsidy,
    feeBps: 100,
    policyPath: args.policyPath,
  });

  return {
    phase: "execute", chain: "devnet", action: "create_market",
    txSig: result.signature,
    marketPda: result.marketPda,
    explorerUrl: `https://orbmarkets.io/tx/${result.signature}?cluster=devnet`,
    policyGate: result.policyGate ??
      `enforceProgramPolicy passed (${PREDICTION_MARKET_PROGRAM_ID.slice(0, 4)}...create_market_v2)`,
    notes: `seeded ${seedUsdc} USDC initial liquidity`,
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
    case "create_market":
      return executeCreateMarket(args);
    default: {
      const exhaustive: never = action;
      throw new Error(`unhandled action type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
