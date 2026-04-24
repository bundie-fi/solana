/**
 * Bundie x Zerion — Policy enforcement layer.
 *
 * DENY-by-default. Every enabled policy must explicitly return { allow: true }
 * for a swap to be approved. Policies are typed predicates loaded from a
 * `policies.yaml` (or `.json`) file at agent start — never hardcoded.
 *
 * Five policies (Zerion track requirement: at least one scoped policy):
 *   1. chain_lock         — Solana only
 *   2. spend_limit        — max $X per rebalance, max $Y per day (rolling)
 *   3. asset_whitelist    — only swap between approved mints
 *   4. expiry             — agent stops auto-acting after N days unless re-armed
 *   5. nav_divergence     — pause if NAV drops > X% in Y minutes (kill-switch)
 *
 * Each predicate has the signature:
 *   (ctx: SwapContext, policyConfig: object, runtime: RuntimeState) => PolicyDecision
 *
 * SwapContext:
 *   { chain, fromMint, toMint, fromSymbol, toSymbol, notionalUsd, timestampMs,
 *     navPerShare, navHistory: [{ navPerShare, timestampMs }, ...] }
 *
 * PolicyDecision:
 *   { allow: boolean, reason?: string, code?: string }
 */

// -----------------------------------------------------------------------------
// 1. Chain lock
// -----------------------------------------------------------------------------

export function chainLock(ctx, cfg /*, runtime */) {
  const allowed = cfg?.allowed_chains;
  if (!Array.isArray(allowed) || allowed.length === 0) {
    return { allow: false, code: "chain_lock_misconfigured", reason: "chain_lock policy requires non-empty allowed_chains" };
  }
  if (!allowed.includes(ctx.chain)) {
    return {
      allow: false,
      code: "chain_lock_violation",
      reason: `Chain "${ctx.chain}" is not in allowed_chains [${allowed.join(", ")}]`,
    };
  }
  return { allow: true };
}

// -----------------------------------------------------------------------------
// 2. Spend limit (per-rebalance + per-day rolling)
// -----------------------------------------------------------------------------

export function spendLimit(ctx, cfg, runtime) {
  const maxPer = Number(cfg?.max_notional_usd_per_rebalance);
  const maxDay = Number(cfg?.max_notional_usd_per_day);
  if (!Number.isFinite(maxPer) || maxPer <= 0) {
    return { allow: false, code: "spend_limit_misconfigured", reason: "max_notional_usd_per_rebalance must be > 0" };
  }
  if (!Number.isFinite(maxDay) || maxDay <= 0) {
    return { allow: false, code: "spend_limit_misconfigured", reason: "max_notional_usd_per_day must be > 0" };
  }
  if (!Number.isFinite(ctx.notionalUsd) || ctx.notionalUsd <= 0) {
    return { allow: false, code: "spend_limit_invalid_notional", reason: "notionalUsd must be a positive number" };
  }
  if (ctx.notionalUsd > maxPer) {
    return {
      allow: false,
      code: "spend_limit_per_rebalance_exceeded",
      reason: `Swap notional $${ctx.notionalUsd.toFixed(2)} exceeds per-rebalance cap $${maxPer.toFixed(2)}`,
    };
  }

  // Rolling 24h window from runtime.spendLog: [{ timestampMs, notionalUsd }, ...]
  const windowStart = ctx.timestampMs - 24 * 60 * 60 * 1000;
  const recent = (runtime?.spendLog || []).filter((e) => e.timestampMs >= windowStart);
  const spent24h = recent.reduce((sum, e) => sum + e.notionalUsd, 0);
  if (spent24h + ctx.notionalUsd > maxDay) {
    return {
      allow: false,
      code: "spend_limit_daily_exceeded",
      reason: `Daily spend $${(spent24h + ctx.notionalUsd).toFixed(2)} would exceed cap $${maxDay.toFixed(2)} (already spent $${spent24h.toFixed(2)} in last 24h)`,
    };
  }
  return { allow: true };
}

// -----------------------------------------------------------------------------
// 3. Asset whitelist
// -----------------------------------------------------------------------------

export function assetWhitelist(ctx, cfg /*, runtime */) {
  const allowed = cfg?.allowed_mints;
  if (!Array.isArray(allowed) || allowed.length === 0) {
    return { allow: false, code: "asset_whitelist_misconfigured", reason: "allowed_mints must be a non-empty list" };
  }
  if (!ctx.fromMint || !ctx.toMint) {
    return { allow: false, code: "asset_whitelist_missing_mints", reason: "ctx.fromMint and ctx.toMint are required" };
  }
  if (!allowed.includes(ctx.fromMint)) {
    return {
      allow: false,
      code: "asset_whitelist_violation",
      reason: `fromMint ${ctx.fromMint} (${ctx.fromSymbol || "?"}) is not in allowed_mints`,
    };
  }
  if (!allowed.includes(ctx.toMint)) {
    return {
      allow: false,
      code: "asset_whitelist_violation",
      reason: `toMint ${ctx.toMint} (${ctx.toSymbol || "?"}) is not in allowed_mints`,
    };
  }
  return { allow: true };
}

// -----------------------------------------------------------------------------
// 4. Expiry
// -----------------------------------------------------------------------------

export function expiry(ctx, cfg, runtime) {
  // Either an explicit expires_at_ms OR (armed_at_ms + max_age_days)
  const explicit = Number(cfg?.expires_at_ms);
  const maxDays = Number(cfg?.max_age_days);
  let expiresAt;
  if (Number.isFinite(explicit) && explicit > 0) {
    expiresAt = explicit;
  } else if (Number.isFinite(maxDays) && maxDays > 0) {
    const armedAt = Number(runtime?.armedAtMs ?? cfg?.armed_at_ms);
    if (!Number.isFinite(armedAt) || armedAt <= 0) {
      return { allow: false, code: "expiry_misconfigured", reason: "expiry policy needs runtime.armedAtMs or cfg.armed_at_ms" };
    }
    expiresAt = armedAt + maxDays * 24 * 60 * 60 * 1000;
  } else {
    return { allow: false, code: "expiry_misconfigured", reason: "expiry policy needs expires_at_ms or max_age_days" };
  }
  if (ctx.timestampMs >= expiresAt) {
    return {
      allow: false,
      code: "expiry_elapsed",
      reason: `Agent expired at ${new Date(expiresAt).toISOString()}; re-arm to continue`,
    };
  }
  return { allow: true };
}

// -----------------------------------------------------------------------------
// 5. NAV-divergence guard (kill-switch)
// -----------------------------------------------------------------------------

export function navDivergence(ctx, cfg /*, runtime */) {
  const maxDropPct = Number(cfg?.max_drop_pct);
  const windowMin = Number(cfg?.window_minutes);
  if (!Number.isFinite(maxDropPct) || maxDropPct <= 0) {
    return { allow: false, code: "nav_divergence_misconfigured", reason: "max_drop_pct must be > 0" };
  }
  if (!Number.isFinite(windowMin) || windowMin <= 0) {
    return { allow: false, code: "nav_divergence_misconfigured", reason: "window_minutes must be > 0" };
  }
  const history = ctx.navHistory || [];
  if (history.length === 0 || !Number.isFinite(ctx.navPerShare)) {
    // No history yet — fail open (no divergence to detect). Return allow:true so
    // the very first run isn't blocked, but log via reason.
    return { allow: true };
  }
  const windowStart = ctx.timestampMs - windowMin * 60 * 1000;
  const inWindow = history.filter((p) => p.timestampMs >= windowStart);
  if (inWindow.length === 0) return { allow: true };
  const peak = inWindow.reduce((m, p) => Math.max(m, p.navPerShare), 0);
  if (peak <= 0) return { allow: true };
  const dropPct = ((peak - ctx.navPerShare) / peak) * 100;
  if (dropPct >= maxDropPct) {
    return {
      allow: false,
      code: "nav_divergence_kill_switch",
      reason: `NAV dropped ${dropPct.toFixed(2)}% from window peak (≥ ${maxDropPct}%) — kill-switch engaged`,
    };
  }
  return { allow: true };
}

// -----------------------------------------------------------------------------
// 6. Program / instruction allowlist
// -----------------------------------------------------------------------------

/**
 * Validates that a tx is touching a whitelisted (programId, instruction) pair.
 * Used for non-swap flows like create_market_v2 where the swap-shaped policies
 * (chain_lock, spend_limit, asset_whitelist) don't apply.
 *
 * Config:
 *   programs:
 *     - programId: "<base58>"
 *       instructions: [<snake_case ix names>]
 *
 * Context:
 *   { programId: string, instructionName: string }
 */
export function programAllowlist(ctx, cfg /*, runtime */) {
  const entries = Array.isArray(cfg?.programs) ? cfg.programs : [];
  if (entries.length === 0) {
    return {
      allow: false,
      code: "program_allowlist_misconfigured",
      reason: "program_allowlist policy requires non-empty 'programs' list",
    };
  }
  if (typeof ctx?.programId !== "string" || typeof ctx?.instructionName !== "string") {
    return {
      allow: false,
      code: "program_allowlist_missing_context",
      reason: "programAllowlist requires ctx.programId and ctx.instructionName",
    };
  }
  const entry = entries.find((e) => e?.programId === ctx.programId);
  if (!entry) {
    return {
      allow: false,
      code: "program_allowlist_unknown_program",
      reason: `Program ${ctx.programId} not in allowlist`,
    };
  }
  const ixs = Array.isArray(entry.instructions) ? entry.instructions : [];
  if (!ixs.includes(ctx.instructionName)) {
    return {
      allow: false,
      code: "program_allowlist_ix_not_permitted",
      reason: `${ctx.programId}.${ctx.instructionName} not in allowed instructions [${ixs.join(", ")}]`,
    };
  }
  return { allow: true };
}

// -----------------------------------------------------------------------------
// Registry + enforcer
// -----------------------------------------------------------------------------

export const POLICY_REGISTRY = Object.freeze({
  chain_lock: chainLock,
  spend_limit: spendLimit,
  asset_whitelist: assetWhitelist,
  expiry,
  nav_divergence: navDivergence,
  program_allowlist: programAllowlist,
});

/**
 * PolicyEnforcer runs all enabled policies in declaration order.
 * DENY-by-default: any unknown policy id, any policy throwing, or any policy
 * returning allow:false rejects the swap.
 *
 * @param {object[]} enabledPolicies - array of `{ id: string, config: object }`
 * @returns {(ctx: object, runtime?: object) => { allow: boolean, decisions: Array }}
 */
export function makeEnforcer(enabledPolicies) {
  if (!Array.isArray(enabledPolicies)) {
    throw new Error("enabledPolicies must be an array");
  }
  // Validate all policy ids up-front so misconfig fails loudly at boot.
  for (const p of enabledPolicies) {
    if (!p || typeof p.id !== "string" || !POLICY_REGISTRY[p.id]) {
      throw new Error(`Unknown policy id: ${JSON.stringify(p?.id)}`);
    }
  }
  return function enforce(ctx, runtime = {}) {
    const decisions = [];
    for (const { id, config } of enabledPolicies) {
      const fn = POLICY_REGISTRY[id];
      let result;
      try {
        result = fn(ctx, config || {}, runtime);
      } catch (err) {
        result = { allow: false, code: "policy_threw", reason: `Policy "${id}" threw: ${err.message}` };
      }
      // Defensive: if a policy returns a non-object, treat as deny.
      if (!result || typeof result.allow !== "boolean") {
        result = { allow: false, code: "policy_invalid_return", reason: `Policy "${id}" returned an invalid decision` };
      }
      decisions.push({ id, ...result });
      if (!result.allow) {
        return { allow: false, decisions, deniedBy: id };
      }
    }
    return { allow: true, decisions };
  };
}
