/**
 * Agent template generators for the Bundie marketplace wizard.
 *
 * - `generateBrainMd` produces the prompt the daemon hands to the LLM each
 *   tick. Mirrors the structure of agents/{alice,bob,charlie}.bundie.sol/brain.md
 *   so the existing daemon's templating ({{ALLOWLIST}}, {{STATE_JSON}},
 *   {{HISTORY_JSON}} placeholders) Just Works.
 *
 * - `generatePoliciesYaml` produces a policies.yaml string compatible with
 *   the tiny YAML parser in packages/zerion-agent/src/bundie/policy-loader.js.
 *   The parser only handles flat lists of objects with scalar/list/map values
 *   — no anchors, no inline maps, no flow-style except `[a, b, c]` lists.
 *   Stick to the alice/bob/charlie shape.
 */

// ───────────────────────────── presets ──────────────────────────────────────

export type AgentPreset =
  | "balanced"
  | "aggressive"
  | "conservative"
  | "yield-hunter"
  | "perp-trader";

const PRESET_PERSONALITY: Record<AgentPreset, string> = {
  balanced:
    "Balanced allocator: roughly 60% stablecoin lending / 40% LST. Slow-moving, rebalances only when allocation drifts >10% from target.",
  aggressive:
    "Aggressive allocator: concentrated bets, willing to take leverage when an opportunity looks asymmetric. Rebalances opportunistically rather than on a schedule.",
  conservative:
    "Conservative allocator: stables-first, minimal LST exposure. Prefers Kamino over MarginFi by default. Capital preservation beats APY chasing.",
  "yield-hunter":
    "Yield hunter: always rotates into the highest-APY allowlisted lending pool. Ignores LSTs unless lending APY collapses.",
  "perp-trader":
    "Funding-rate arbitrageur: long spot + short perp combos to harvest funding. Zeta-heavy. Trims when funding flips negative.",
};

const PRESET_ALLOCATION: Record<AgentPreset, string> = {
  balanced: `Allocation target: ~60% in stablecoin lending, ~40% in LST.
  - For the 60% side: compare Kamino (selector 1) vs MarginFi (selector 3). Pick higher APY.
  - For the 40% side: compare Marinade (selector 2) vs Jito/SPL (selector 4). Pick better rate.
  - Rebalance when either side drifts >10% from target.`,
  aggressive: `Allocation target: opportunistic. No fixed split.
  - Concentrate into whichever surface shows the strongest signal.
  - Use rate divergence between protocols (Kamino vs MarginFi, Marinade vs Jito) as a directional signal.
  - Open prediction markets on peers when you spot meaningful divergence.`,
  conservative: `Allocation target: ~80% stables, ~20% LST.
  - Prefer Kamino over MarginFi unless MarginFi utilization is >1500bps higher.
  - LST side: only Marinade. Skip jito unless splStakePoolAboveBps > marinadeMsolAboveBps + 200.
  - Rebalance only on drift >15% from target.`,
  "yield-hunter": `Allocation target: 100% in highest-APY lending pool.
  - Compare Kamino (selector 1) vs MarginFi (selector 3) every tick.
  - Migrate when the higher pool exceeds the current pool's utilization by >300bps.
  - Ignore LST surfaces (selectors 2, 4).`,
  "perp-trader": `Allocation target: long spot + short perp delta-neutral, harvesting funding.
  - Track Zeta SOL-PERP funding (selector 5) — when positive and >50bps annualized, increase position.
  - Trim when funding flips negative.
  - LST exposure only as collateral, not as alpha.`,
};

const PRESET_RULES: Record<AgentPreset, string> = {
  balanced:
    "- One action per tick. Prefer the action that moves allocation closest to 60/40 without overshooting.\n- Default to noop when allocation drift is under 10%.",
  aggressive:
    "- 1-2 actions per tick. One focused move beats noise.\n- Default to noop when no surface shows >500bps divergence vs its peer.",
  conservative:
    "- One action per tick.\n- Default to noop unless drift exceeds 15% or kill-switch (NAV down >5%) triggered.",
  "yield-hunter":
    "- One action per tick — migrate to the higher-APY pool only when delta exceeds 300bps.\n- Default to noop when both pools are within 300bps of each other.",
  "perp-trader":
    "- One action per tick.\n- Default to noop when funding is flat (|funding| < 20bps annualized).",
};

// ───────────────────────────── brain.md ─────────────────────────────────────

export function generateBrainMd(opts: {
  preset: AgentPreset;
  displayName: string;
  allowedProtocols: string[];
  customAddition?: string;
}): string {
  const personality = PRESET_PERSONALITY[opts.preset];
  const allocation = PRESET_ALLOCATION[opts.preset];
  const rules = PRESET_RULES[opts.preset];

  const allowlistList = opts.allowedProtocols
    .map((p) => `- ${p}`)
    .join("\n");

  const lines: string[] = [];
  lines.push(
    `You are ${opts.displayName}, an autonomous DeFi agent on Solana. Your personality:`,
  );
  lines.push(`- ${personality}`);
  lines.push(
    `- You trust observed signals and act. You do not second-guess a clear opportunity.`,
  );
  lines.push(``);
  lines.push(
    `Your allowed programs (enforced on-chain by enforceProgramPolicy — you CANNOT bypass):`,
  );
  lines.push(`{{ALLOWLIST}}`);
  lines.push(``);
  lines.push(`Your allowed protocols (configured by your owner):`);
  lines.push(allowlistList);
  lines.push(``);
  lines.push(
    `Your current observed state (read from mainnet observation chain + devnet this tick):`,
  );
  lines.push(`{{STATE_JSON}}`);
  lines.push(``);
  lines.push(`State fields explained:`);
  lines.push(
    `  rates.kaminoUsdcUtilizationBps  — Kamino USDC pool utilization (selector 1). High = good APY for lenders.`,
  );
  lines.push(
    `  rates.marinadeMsolAboveBps      — Marinade mSOL price premium over 1.0 SOL (selector 2). Rising = stake more.`,
  );
  lines.push(
    `  rates.marginfiUsdcUtilizationBps — MarginFi USDC bank utilization (selector 3). Compare vs Kamino.`,
  );
  lines.push(
    `  rates.splStakePoolAboveBps      — Jito/BlazeStake SPL pool rate above par (selector 4). Compare vs Marinade.`,
  );
  lines.push(
    `  rates.zetaSolPerpFundingBps     — Zeta SOL-PERP funding rate (selector 5, 0 until probe verified).`,
  );
  lines.push(
    `  rates.chain                     — "mainnet" if observation RPC is live, "devnet" if fallback.`,
  );
  lines.push(
    `  self.sol                        — your devnet SOL balance (fee-payer; execution chain).`,
  );
  lines.push(`  self.lamports                   — same in lamports.`);
  lines.push(
    `  self.usdc                       — your surfpool USDC balance (auto-seeded each tick).`,
  );
  lines.push(
    `  self.msol                       — your surfpool mSOL balance from prior Marinade stakes.`,
  );
  lines.push(
    `  peers[]                         — peer agent vault addresses + their SOL balances.`,
  );
  lines.push(
    `                                    Use peers[].owner as the targetAgent in create_market.`,
  );
  lines.push(``);
  lines.push(allocation);
  lines.push(``);
  lines.push(`Your recent activity (last 20 log entries):`);
  lines.push(`{{HISTORY_JSON}}`);
  lines.push(``);
  lines.push(`Available market kinds (Phase F on-chain market kinds):`);
  lines.push(
    `  kind=1  Single-vault NAV vs spread — predict whether YOUR vault NAV moves up by spreadBps over windowSlots.`,
  );
  lines.push(
    `  kind=2  Vault-vs-vault NAV race — predict whether vault A out-NAVs vault B by spreadBps.`,
  );
  lines.push(
    `  kind=3  Rate-surface vs benchmark — predict whether a named rate surface (Kamino utilization, mSOL premium, etc.) crosses spreadBps.`,
  );
  lines.push(``);
  lines.push(`Available rate surfaces (on-chain selectors for kind=3):`);
  lines.push(
    `  selector=1  Kamino USDC lending supply utilization (bps, 0-10000)`,
  );
  lines.push(
    `  selector=2  Marinade mSOL price premium over SOL (bps above par)`,
  );
  lines.push(`  selector=3  MarginFi USDC bank utilization (bps, 0-10000)`);
  lines.push(
    `  selector=4  SPL Stake Pool exchange rate premium (bps above 1.0 SOL, covers Jito/BlazeStake)`,
  );
  lines.push(
    `  selector=5  Zeta SOL-PERP funding rate (bps, 0 if unverified)`,
  );
  lines.push(``);
  lines.push(
    `Based on state, recent activity, and your personality, decide the next actions.`,
  );
  lines.push(``);
  lines.push(`Rules:`);
  lines.push(
    `- Output ONLY valid JSON matching the schema below. No prose, no fences, no commentary.`,
  );
  lines.push(rules);
  lines.push(
    `- windowSlots for markets: 50000-2000000 (~3h to ~9 days at 400ms/slot).`,
  );
  lines.push(
    `- spreadBps: for utilization (selectors 1,3) use 300-1500; for LST rate (selectors 2,4) use 50-500.`,
  );
  lines.push(
    `- For create_market: use peers[].owner as targetAgent. You MUST NOT use your own vault.`,
  );
  lines.push(
    `- seedAmountUsdc: always between 1 and 5. This seeds the market's initial liquidity.`,
  );
  lines.push(
    `- DEDUPLICATION: Before creating a market, scan HISTORY_JSON. If you already created a market with the`,
  );
  lines.push(
    `  same targetAgent + selector combination in the last 5 entries, output noop instead. Do not create`,
  );
  lines.push(
    `  near-identical markets (same subject, same rate surface, overlapping time windows).`,
  );
  lines.push(``);
  lines.push(`Schema:`);
  lines.push(`{`);
  lines.push(`  "reasoning": "<1-2 sentences>",`);
  lines.push(`  "actions": [`);
  lines.push(`    {"type": "noop"} |`);
  lines.push(
    `    {"type": "lend_deposit",  "protocol": "kamino"|"marginfi"|"solend", "args": {"amountUsdcUi": <number>}} |`,
  );
  lines.push(
    `    {"type": "lend_withdraw", "protocol": "kamino"|"marginfi"|"solend", "args": {"amountUi": <number>}} |`,
  );
  lines.push(
    `    {"type": "lst_stake",     "protocol": "marinade"|"jito",            "args": {"amountSolUi": <number>}} |`,
  );
  lines.push(
    `    {"type": "lst_unstake",   "protocol": "marinade"|"jito",            "args": {"amountMsolUi": <number>}} |`,
  );
  lines.push(
    `    {"type": "create_market", "args": {"kind": <1|2|3>, "targetAgent": "<vault_pubkey>", "selector": <1|2|3|4|5>, "spreadBps": <u64>, "windowSlots": <u64>, "questionTemplate": "<string max 128 chars>", "seedAmountUsdc": <number>}}`,
  );
  lines.push(`  ]`);
  lines.push(`}`);

  if (opts.customAddition && opts.customAddition.trim()) {
    lines.push(``);
    lines.push(`Owner-supplied addendum:`);
    lines.push(opts.customAddition.trim());
  }

  return lines.join("\n") + "\n";
}

// ────────────────────────── policies.yaml ───────────────────────────────────

export type AllowedProtocol =
  | "kamino"
  | "marginfi"
  | "solend"
  | "marinade"
  | "jito"
  | "zeta";

export interface PerProtocolLimits {
  maxNotionalUsd: number;
}

/**
 * Mirrors `LEND_PROGRAM` / `LST_PROGRAM` / `PERP_PROGRAM` from
 * packages/programs/scripts/chaos-sim/src/lib/action-executor.ts. The
 * canonical wired-up set: Kamino + MarginFi + Solend (lending), Marinade +
 * Jito (LST), Zeta (perps). Drift was retired in favour of Zeta; Orca was
 * never wired through the executor.
 */
const PROTOCOL_PROGRAMS: Record<
  AllowedProtocol,
  { programId: string; instructions: string[] }
> = {
  kamino: {
    programId: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
    instructions: [
      "deposit_reserve_liquidity",
      "withdraw_reserve_liquidity",
      "refresh_reserve",
    ],
  },
  marginfi: {
    programId: "MFv2hWf31Z9kbCa1snEPdcgp7X3wCuuRcuDNmq1H5NE",
    instructions: ["lending_account_deposit", "lending_account_withdraw"],
  },
  solend: {
    programId: "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo",
    instructions: [
      "deposit_reserve_liquidity",
      "redeem_reserve_collateral",
      "refresh_reserve",
      "refresh_obligation",
    ],
  },
  marinade: {
    programId: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
    instructions: ["deposit", "liquid_unstake"],
  },
  jito: {
    programId: "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy",
    instructions: ["deposit_sol", "withdraw_sol"],
  },
  zeta: {
    programId: "ZETAxsqBRek56DhiGXrn75yj2NHU3aYUnxvHXpkf3aD",
    instructions: ["place_perp_order_v3", "close_position", "deposit", "withdraw"],
  },
};

/**
 * Mints to whitelist for each protocol. Only the relevant ones are added when
 * the protocol is in the allowlist, so a stables-only agent doesn't get a
 * warning surface on its first LST signal attempt.
 */
const PROTOCOL_MINTS: Record<AllowedProtocol, string[]> = {
  // Kamino / MarginFi: USDC + bUSD (BUSD_MINT comes from env at runtime, so we
  // hardcode the devnet mainnet+devnet USDC mints here as a baseline.)
  kamino: [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // mainnet USDC
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // devnet USDC
  ],
  marginfi: [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  ],
  marinade: [
    "So11111111111111111111111111111111111111112", // wSOL
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
  ],
  jito: [
    "So11111111111111111111111111111111111111112",
    "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // JitoSOL
  ],
  solend: [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  ],
  zeta: [
    "So11111111111111111111111111111111111111112",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  ],
};

// Bundie prediction market — every agent can interact with it regardless of
// the strategy-side protocol allowlist.
const PREDICTION_MARKET_PROGRAM_ID =
  "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4";
const PREDICTION_MARKET_INSTRUCTIONS = [
  "create_market_v2",
  "buy_shares",
  "sell_shares",
  "resolve_market_v2",
];

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

export function generatePoliciesYaml(opts: {
  allowedProtocols: AllowedProtocol[];
  perProtocolLimits: Partial<Record<AllowedProtocol, PerProtocolLimits>>;
  defaultMaxNotionalUsd?: number;
  /** Optional: include the live BUSD mint when known (otherwise fall back to USDC mints). */
  busdMint?: string;
}): string {
  const protocols = opts.allowedProtocols;
  const defaultMax = opts.defaultMaxNotionalUsd ?? 25;

  // Per-rebalance cap: max of any per-protocol limit, falling back to the default.
  const perRebalanceCap = Math.max(
    defaultMax,
    ...protocols.map(
      (p) => opts.perProtocolLimits[p]?.maxNotionalUsd ?? defaultMax,
    ),
  );
  const perDayCap = perRebalanceCap * 4;

  // Asset whitelist: union of mints for the chosen protocols + bUSD if provided.
  const allMints = uniq([
    ...(opts.busdMint && opts.busdMint !== "REPLACE_AFTER_SETUP"
      ? [opts.busdMint]
      : []),
    ...protocols.flatMap((p) => PROTOCOL_MINTS[p]),
  ]);

  const lines: string[] = [];
  lines.push(`# Auto-generated by Bundie agent wizard`);
  lines.push(`# DENY-by-default policies — every tx passes through this list.`);
  lines.push(``);
  lines.push(`armed_at_ms: ${Date.now()}`);
  lines.push(``);
  lines.push(`policies:`);

  // chain_lock
  lines.push(`  - id: chain_lock`);
  lines.push(`    config:`);
  lines.push(`      allowed_chains:`);
  lines.push(`        - solana`);
  lines.push(``);

  // spend_limit
  lines.push(`  - id: spend_limit`);
  lines.push(`    config:`);
  lines.push(`      max_notional_usd_per_rebalance: ${perRebalanceCap}`);
  lines.push(`      max_notional_usd_per_day: ${perDayCap}`);
  lines.push(``);

  // asset_whitelist
  lines.push(`  - id: asset_whitelist`);
  lines.push(`    config:`);
  lines.push(`      allowed_mints:`);
  for (const mint of allMints) {
    lines.push(`        - ${mint}`);
  }
  lines.push(``);

  // expiry — 30 days. The tiny YAML parser supports `expires_in_days` as a
  // scalar; the existing policies.js predicate name is `expiry` and the
  // alice/bob/charlie shape uses `max_age_days`. Keep both for compatibility.
  lines.push(`  - id: expiry`);
  lines.push(`    config:`);
  lines.push(`      max_age_days: 30`);
  lines.push(`      expires_in_days: 30`);
  lines.push(``);

  // nav_divergence
  lines.push(`  - id: nav_divergence`);
  lines.push(`    config:`);
  lines.push(`      max_drop_pct: 10.0`);
  lines.push(`      window_minutes: 60`);
  lines.push(``);

  // program_allowlist — emit using the alice/bob/charlie shape (programs:
  // list of {programId, instructions}) since that is what the existing
  // program-enforcer expects.
  lines.push(`  - id: program_allowlist`);
  lines.push(`    config:`);
  lines.push(`      programs:`);
  // Always allow the prediction-market program so the agent can act on its
  // own create_market signals.
  lines.push(`        - programId: "${PREDICTION_MARKET_PROGRAM_ID}"`);
  lines.push(
    `          instructions: [${PREDICTION_MARKET_INSTRUCTIONS.join(", ")}]`,
  );
  for (const proto of protocols) {
    const entry = PROTOCOL_PROGRAMS[proto];
    lines.push(`        - programId: "${entry.programId}"`);
    lines.push(`          instructions: [${entry.instructions.join(", ")}]`);
  }

  return lines.join("\n") + "\n";
}
