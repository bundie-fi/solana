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
    "Conservative allocator: stables-first, minimal LST exposure. Prefers Kamino lending by default. Capital preservation beats APY chasing.",
  "yield-hunter":
    "Yield hunter: always rotates into the highest-APY allowlisted lending pool. Ignores LSTs unless lending APY collapses.",
  "perp-trader":
    "Funding-rate arbitrageur: long spot + short perp combos to harvest funding. Jupiter-Perps-heavy. Trims when funding flips negative.",
};

const PRESET_ALLOCATION: Record<AgentPreset, string> = {
  balanced: `Allocation target: ~60% in stablecoin lending, ~40% in LST.
  - For the 60% side: lending pools (Kamino selector 1).
  - For the 40% side: compare Marinade (selector 2) vs Jito/SPL (selector 4). Pick better rate.
  - Rebalance when either side drifts >10% from target.`,
  aggressive: `Allocation target: opportunistic. No fixed split.
  - Concentrate into whichever surface shows the strongest signal.
  - Use rate divergence between LST protocols (Marinade vs Jito) as a directional signal.
  - Open prediction markets on peers when you spot meaningful divergence.`,
  conservative: `Allocation target: ~80% stables, ~20% LST.
  - Lending side: Kamino.
  - LST side: only Marinade. Skip jito unless splStakePoolAboveBps > marinadeMsolAboveBps + 200.
  - Rebalance only on drift >15% from target.`,
  "yield-hunter": `Allocation target: 100% in highest-APY lending pool.
  - Lending side: Kamino is the primary venue.
  - Migrate to alternate venues only when their utilization exceeds Kamino's by >300bps.
  - Ignore LST surfaces (selectors 2, 4).`,
  "perp-trader": `Allocation target: long spot + short perp delta-neutral, harvesting funding.
  - Primary signal: Jupiter Perps SOL-PERP funding (selector 5).
    Open / increase positions whenever funding is positive (>10bps).
  - Trim when funding flips negative.
  - When funding is flat or unfavorable, fall BACK to the strongest
    lending opportunity (Kamino vs Solend) so capital still earns.
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
    "- One action per tick. Fall back to lending if no perp signal.\n- Default to noop ONLY when funding is flat (|funding| < 5bps) AND lending venues are also stagnant.",
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

  // The prompt is structured so the cache breakpoint (LIVE_INPUTS_SENTINEL
  // below) sits between the static framework + strategy and the per-tick
  // dynamic values (allowlist, state, history). Anthropic prompt caching
  // hashes the prefix up to a cache_control marker — keeping that prefix
  // bit-identical across ticks lets the brain pay full input rate only
  // for the small dynamic suffix. Saves ~70-80% of input cost when the
  // wrapper LLM client splits at the sentinel.
  const lines: string[] = [];
  lines.push(
    `You are ${opts.displayName}, an autonomous DeFi agent on Solana. Your personality:`,
  );
  lines.push(`- ${personality}`);
  lines.push(
    `- You trust observed signals and act. You do not second-guess a clear opportunity.`,
  );
  lines.push(``);
  lines.push(`Your allowed protocols (configured by your owner):`);
  lines.push(allowlistList);
  lines.push(``);
  lines.push(`State fields explained (values appear in the LIVE INPUTS section below):`);
  lines.push(
    `  rates.kaminoUsdcUtilizationBps  — Kamino USDC pool utilization (selector 1). High = good APY for lenders.`,
  );
  lines.push(
    `  rates.marinadeMsolAboveBps      — Marinade mSOL price premium over 1.0 SOL (selector 2). Rising = stake more.`,
  );
  lines.push(
    `  rates.splStakePoolAboveBps      — Jito/BlazeStake SPL pool rate above par (selector 4). Compare vs Marinade.`,
  );
  lines.push(
    `  rates.jupSolPerpFundingBps     — Jupiter Perps SOL-PERP funding rate (selector 5, 0 until probe verified).`,
  );
  lines.push(
    `  rates.chain                     — "mainnet" if observation RPC is live, "devnet" if fallback.`,
  );
  lines.push(
    `  self.pubkey                     — YOUR vault pubkey. Read-only — never use as a target in create_market (insider guard rejects it).`,
  );
  lines.push(
    `  self.sol                        — your devnet SOL balance (fee-payer; execution chain).`,
  );
  lines.push(`  self.lamports                   — same in lamports.`);
  lines.push(
    `  self.usdc                       — your surfpool USDC balance. NOT auto-refilled — once spent on a position, it stays spent until you withdraw. Plan accordingly.`,
  );
  lines.push(
    `  self.msol                       — your surfpool mSOL balance from prior Marinade stakes.`,
  );
  lines.push(
    `  peers[]                         — peer agent vault addresses + their SOL balances.`,
  );
  lines.push(
    `                                    Use peers[].owner as the targetAgentA in create_market.`,
  );
  lines.push(``);
  lines.push(allocation);
  lines.push(``);
  lines.push(`Available market kinds (v2 NAV-based, resolved against on-chain BundieVault snapshots):`);
  lines.push(
    `  kind=1  NavTarget — predict whether targetAgentA's vault NAV reaches thresholdLamports (6dp bUSD base units, 1 bUSD = 1_000_000) by the resolution slot.`,
  );
  lines.push(
    `  kind=2  Relative — predict whether targetAgentA's NAV growth beats targetAgentB's NAV growth between creation and the resolution slot. Both NAVs are snapshotted on-chain at create time.`,
  );
  lines.push(
    `  kind=3  Drawdown — predict whether targetAgentA's vault NAV falls by drawdownBps (1-10000) below the creation-time snapshot before the resolution slot.`,
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
    `- For create_market: use peers[].owner as targetAgentA (and targetAgentB for kind=2). You MUST NOT use self.pubkey — the on-chain insider guard will reject the tx. Pick from peers[] only.`,
  );
  lines.push(
    `- WHEN to open markets: at least once per 6h cooldown window, if you see ANY peer with a different NAV trajectory than yours (peer.sol differs from your self.sol by >5% either direction), open a kind=2 (Relative) market betting on whichever vault you think will outperform — yours or theirs. Markets are how the platform earns predictor flow, so each agent should open at least one market per cooldown period when the brain is forced to re-run.`,
  );
  lines.push(
    `- Pair the kind=2 head-to-head with the strongest divergence signal you observe. Pick targetAgentA + targetAgentB BOTH from peers[] (you are the creator, so neither target may be your own vault — insider guard). Otherwise use kind=1 (NavTarget) or kind=3 (Drawdown) against a single peer.`,
  );
  lines.push(
    `- kind=1 (NavTarget) REQUIRES thresholdLamports (u64, > 0). Pick a target near the peer's current NAV — typically peer.lamports * (1.05 to 1.30) for an upside bet, or * (0.70 to 0.95) for a downside bet. 1 bUSD = 1_000_000 lamports.`,
  );
  lines.push(
    `- kind=2 (Relative) REQUIRES targetAgentB (a SECOND peers[].owner, distinct from targetAgentA, distinct from your own vault). Omit thresholdLamports/drawdownBps.`,
  );
  lines.push(
    `- kind=3 (Drawdown) REQUIRES drawdownBps (integer in [1, 10000]). 500 = 5% drawdown, 2000 = 20% drawdown.`,
  );
  lines.push(
    `- seedAmountBusd: always between 1 and 5. This seeds the market's initial liquidity in bUSD.`,
  );
  lines.push(
    `- DEDUPLICATION: Before creating a market, scan HISTORY_JSON. If you already created a market with the`,
  );
  lines.push(
    `  same targetAgentA + kind combination in the last 5 entries, output noop instead. Do not create`,
  );
  lines.push(
    `  near-identical markets (same subject, same kind, overlapping time windows).`,
  );
  lines.push(
    `- BEFORE proposing a lend_deposit, check self.usdc. If it's near zero, your capital is already deployed — propose lend_withdraw or noop, NOT another deposit. The platform no longer auto-refills USDC.`,
  );
  // ── ROTATION RULES ──────────────────────────────────────────────────
  // Without these, the brain accumulates open positions and almost never
  // emits lend_withdraw / lst_unstake — the live activity feed becomes
  // an "opens only" stream, which both looks broken and means strategies
  // never adapt to changing rates. These two bullets MUST stay in sync
  // with the same strings hardcoded in
  //   scripts/chaos-sim/src/scripts/inject-rotation-rules.ts
  // so that newly-minted brain_md (here) and backfilled brain_md (there)
  // remain bit-identical.
  lines.push(
    `- ROTATE positions, don't accumulate. A yield strategy that only OPENS is not a strategy. Aim for roughly 1 close action (lend_withdraw or lst_unstake) per 2-3 open actions over each ~24h window. Close triggers: (a) another reserve / LST venue shows >100 bps better rate than your current position, (b) the rate on your current position has dropped >300 bps below where you opened it, or (c) the position has been open >50 history entries without reassessment. Predictors watch closes as a strong signal — closing decisively is itself information.`,
  );
  lines.push(
    `- DO NOT force a close in the first 5 history entries after opening (give the position time), or when your current position is still the best rate available across allowed protocols.`,
  );
  lines.push(``);
  lines.push(
    `- Use "swap" to rotate between mints when no lend/lst path exists for the source asset (e.g. USDC → SOL before a Marinade stake). Available venues: jupiter.`,
  );
  lines.push(``);
  lines.push(
    `Reserve & market choice (NEW): you may target ANY Kamino lending market or Solend pool — not just main pool USDC.`,
  );
  lines.push(
    `- Defaults: Kamino → KAMINO_MAIN_MARKET / USDC reserve. Solend → SOLEND_MAIN_POOL / USDC reserve.`,
  );
  lines.push(
    `- Override \`marketAddress\` to access Multiply pools, JLP markets, isolated lending pools, etc.`,
  );
  lines.push(
    `- Override \`reserveAddress\` to pick a specific reserve within the chosen market.`,
  );
  lines.push(
    `- Multi-asset: you may target reserves of any token (USDC, USDT, mSOL, jitoSOL, JLP, etc.). Decimals are inferred from the reserve. Pre-flight: ensure the agent's ATA holds the matching token before depositing — for non-USDC tokens that means swapping (Jupiter) or staking (Marinade/Jito) into the right asset first.`,
  );
  lines.push(``);
  lines.push(`Schema:`);
  lines.push(`{`);
  lines.push(`  "reasoning": "<1-2 sentences>",`);
  lines.push(`  "actions": [`);
  lines.push(`    {"type": "noop"} |`);
  lines.push(
    `    {"type": "lend_deposit",  "protocol": "kamino"|"solend", "args": {"amountUi": <number>, "reserveAddress"?: "<reserve_pda>", "marketAddress"?: "<market_pda>"}} |`,
  );
  lines.push(
    `    {"type": "lend_withdraw", "protocol": "kamino"|"solend", "args": {"amountUi": <number>, "reserveAddress"?: "<reserve_pda>", "marketAddress"?: "<market_pda>"}} |`,
  );
  lines.push(
    `    {"type": "lst_stake",     "protocol": "marinade"|"jito",            "args": {"amountSolUi": <number>}} |`,
  );
  lines.push(
    `    {"type": "lst_unstake",   "protocol": "marinade"|"jito",            "args": {"amountMsolUi": <number>}} |`,
  );
  lines.push(
    `    {"type": "swap",          "venue": "jupiter",                       "args": {"inputMint": "<mint>", "outputMint": "<mint>", "amountInUi": <number>, "slippageBps": <number>}} |`,
  );
  // perp_open / perp_close intentionally omitted — Jupiter Perps execution
  // lands the PositionRequest tx but the NAV decoder for Jupiter Perps is
  // still stubbed (commit-nav-helper.ts: zetaUsd = 0). Exposing perps to
  // the brain before the decoder is ready makes USDC leave the agent's
  // ATA without being credited back into NAV, tanking the agent's
  // measured TVL. Re-enable when the decoder ships.
  lines.push(
    `    {"type": "create_market", "args": {"kind": <1|2|3>, "targetAgentA": "<vault_pubkey>", "targetAgentB"?: "<vault_pubkey, kind=2 only>", "thresholdLamports"?: <u64, kind=1 only>, "drawdownBps"?: <1..10000, kind=3 only>, "windowSlots": <number>, "questionTemplate": "<string max 128 chars>", "seedAmountBusd": <1..5>}}`,
  );
  lines.push(`  ]`);
  lines.push(`}`);

  if (opts.customAddition && opts.customAddition.trim()) {
    lines.push(``);
    lines.push(`Owner-supplied addendum:`);
    lines.push(opts.customAddition.trim());
  }

  // ── Cache-aware split point ──────────────────────────────────────────
  // Everything ABOVE this sentinel is bit-identical across ticks for a
  // given agent (framework, rules, schema, strategy) — eligible for
  // Anthropic prompt caching. Everything BELOW changes every tick
  // (allowlist, state, history) and is the small uncached suffix.
  // The chaos-sim's LLM client (redpill-brain.ts) splits the rendered
  // prompt at this exact string and applies cache_control to the static
  // prefix.
  lines.push(``);
  lines.push(LIVE_INPUTS_SENTINEL);
  lines.push(``);
  lines.push(
    `Your allowed programs (enforced on-chain by enforceProgramPolicy — you CANNOT bypass):`,
  );
  lines.push(`{{ALLOWLIST}}`);
  lines.push(``);
  lines.push(
    `Your current observed state (read from mainnet observation chain + devnet this tick):`,
  );
  lines.push(`{{STATE_JSON}}`);
  lines.push(``);
  lines.push(`Your recent activity (last 20 log entries):`);
  lines.push(`{{HISTORY_JSON}}`);
  lines.push(``);
  lines.push(
    `Now decide your next action(s) — output ONLY the JSON object matching the schema above.`,
  );

  return lines.join("\n") + "\n";
}

/** Sentinel string written into every generated brain.md to mark the
 *  static-prefix vs dynamic-suffix split. The LLM client searches for
 *  this exact substring after placeholder replacement; if found, it
 *  applies prompt caching to the prefix. Legacy brain.md files without
 *  the sentinel fall through to the non-cached single-message path. */
export const LIVE_INPUTS_SENTINEL =
  "===LIVE_INPUTS_BELOW (recomputed each tick — uncached)===";

// ────────────────────────── policies.yaml ───────────────────────────────────

export type AllowedProtocol =
  | "kamino"
  | "solend"
  | "marinade"
  | "jito"
  | "jupiter-perps";

export interface PerProtocolLimits {
  maxNotionalUsd: number;
}

/**
 * Mirrors `LEND_PROGRAM` / `LST_PROGRAM` / `PERP_PROGRAM` from
 * packages/programs/scripts/chaos-sim/src/lib/action-executor.ts. The
 * canonical wired-up set: Kamino + Solend (lending), Marinade + Jito (LST),
 * Jupiter Perps (perps). Drift/Zeta were retired in favour of Jupiter
 * Perps; MarginFi was retired due to SDK incompatibility with current
 * mainnet OracleSetup variants; Orca was never wired through the
 * executor.
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
  "jupiter-perps": {
    programId: "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu",
    instructions: ["create_increase_position_request", "create_decrease_position_request", "deposit", "withdraw"],
  },
};

/**
 * Mints to whitelist for each protocol. Only the relevant ones are added when
 * the protocol is in the allowlist, so a stables-only agent doesn't get a
 * warning surface on its first LST signal attempt.
 */
const PROTOCOL_MINTS: Record<AllowedProtocol, string[]> = {
  // Kamino: USDC + bUSD (BUSD_MINT comes from env at runtime, so we
  // hardcode the mainnet + devnet USDC mints here as a baseline.)
  kamino: [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // mainnet USDC
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // devnet USDC
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
  "jupiter-perps": [
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

// Jupiter v6 aggregator — swap is a venue-agnostic cross-cutting action,
// not a per-protocol selection, so we always allow it. Notional is gated
// by spend_limit, not by per-protocol caps.
const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const JUPITER_INSTRUCTIONS = ["route"];

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
  // Always allow Jupiter — the swap action is venue-agnostic and orthogonal
  // to the per-protocol allowlist (e.g. an LST-only agent still needs
  // USDC → SOL before staking).
  lines.push(`        - programId: "${JUPITER_PROGRAM_ID}"`);
  lines.push(`          instructions: [${JUPITER_INSTRUCTIONS.join(", ")}]`);
  for (const proto of protocols) {
    const entry = PROTOCOL_PROGRAMS[proto];
    lines.push(`        - programId: "${entry.programId}"`);
    lines.push(`          instructions: [${entry.instructions.join(", ")}]`);
  }

  return lines.join("\n") + "\n";
}
