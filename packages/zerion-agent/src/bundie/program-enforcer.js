/**
 * program-enforcer.js — fast-path gate for non-swap agent actions.
 *
 * The 5 legacy predicates (chain_lock, spend_limit, asset_whitelist, expiry,
 * nav_divergence) validate swap-shaped contexts with { chain, fromMint, toMint,
 * notionalUsd, navPerShare, navHistory, ... }. Non-swap instructions such as
 * `create_market_v2` on the Bundie prediction market don't fit that shape, so
 * they would bypass the enforcer entirely — a hole in DENY-by-default.
 *
 * This module exposes a one-shot gate that loads an agent's policies.yaml,
 * filters down to the `program_allowlist` predicate, and runs it against a
 * (programId, instructionName) context. Throws on deny, no-ops on allow.
 *
 * Intended call-site: agent actions that submit program-specific instructions
 * (e.g. chaos-sim's create-rate-barrier-market).
 */

import { loadPoliciesFromFile } from "./policy-loader.js";
import { makeEnforcer } from "./policies.js";

/**
 * @param {object} args
 * @param {string} args.policyPath      absolute path to the agent's policies.yaml
 * @param {string} args.programId       base58 program id being invoked
 * @param {string} args.instructionName snake_case ix name (e.g. "create_market_v2")
 *
 * @throws {Error} on deny — error carries `err.code`, `err.reason`, `err.deniedBy`
 */
export function enforceProgramPolicy({ policyPath, programId, instructionName }) {
  if (typeof policyPath !== "string" || policyPath.length === 0) {
    throw new Error("enforceProgramPolicy: policyPath is required");
  }
  if (typeof programId !== "string" || programId.length === 0) {
    throw new Error("enforceProgramPolicy: programId is required");
  }
  if (typeof instructionName !== "string" || instructionName.length === 0) {
    throw new Error("enforceProgramPolicy: instructionName is required");
  }

  const { policies } = loadPoliciesFromFile(policyPath);
  const only = policies.filter((p) => p.id === "program_allowlist");
  if (only.length === 0) {
    throw new Error(
      `Policy at ${policyPath} has no program_allowlist predicate; refusing to sign non-swap ix.`,
    );
  }

  const enforce = makeEnforcer(only);
  const decision = enforce({ programId, instructionName });
  if (!decision.allow) {
    const failed = decision.decisions.find((d) => !d.allow);
    const err = new Error(
      `DENIED by program_allowlist: ${failed?.reason || "unknown reason"} (${failed?.code || "no-code"})`,
    );
    // @ts-ignore — attach structured metadata for callers that want to surface it
    err.deniedBy = decision.deniedBy;
    // @ts-ignore
    err.code = failed?.code;
    // @ts-ignore
    err.reason = failed?.reason;
    throw err;
  }
}
