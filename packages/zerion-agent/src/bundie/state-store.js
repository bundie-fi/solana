/**
 * Tiny JSON-file state store for the zerion-bundie CLI.
 *
 * Persists between CLI invocations:
 *   - target composition per strategy
 *   - paused/active state
 *   - last-known runtime (spendLog, navHistory, armedAtMs)
 *
 * Stored at $ZERION_BUNDIE_STATE or ./.zerion-bundie-state.json relative to cwd.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function statePath() {
  return process.env.ZERION_BUNDIE_STATE || resolve(process.cwd(), ".zerion-bundie-state.json");
}

export function readState(path = statePath()) {
  if (!existsSync(path)) {
    return { strategies: {}, paused: false };
  }
  const raw = readFileSync(path, "utf-8");
  if (raw.trim() === "") return { strategies: {}, paused: false };
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse state file ${path}: ${err.message}`);
  }
}

export function writeState(state, path = statePath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function setStrategyTarget(strategyPk, target, navOraclePk, path = statePath()) {
  const state = readState(path);
  state.strategies = state.strategies || {};
  state.strategies[strategyPk] = {
    ...(state.strategies[strategyPk] || {}),
    target,
    navOraclePk: navOraclePk || state.strategies[strategyPk]?.navOraclePk,
    updatedAt: Date.now(),
  };
  writeState(state, path);
  return state;
}

export function setPaused(paused, path = statePath()) {
  const state = readState(path);
  state.paused = !!paused;
  state.pausedAt = paused ? Date.now() : null;
  writeState(state, path);
  return state;
}

/**
 * Append one entry to the agent action log. Used by `agent execute` to
 * record every Zerion-mediated tx submission (allowed or denied) so an
 * operator can audit what each agent has done.
 *
 * Cap retained entries at 1000 per state file to keep the JSON readable;
 * older entries fall off FIFO. The full audit lives in the chaos-sim
 * recorder.jsonl — this in-state log is just the most-recent slice.
 *
 * Entry shape:
 *   { ts, role, action, ok, signature?, deniedBy?, durationMs }
 */
export function appendActionLog(entry, path = statePath()) {
  const state = readState(path);
  state.actionLog = Array.isArray(state.actionLog) ? state.actionLog : [];
  state.actionLog.push({ ts: Date.now(), ...entry });
  // Keep last 1000 entries (FIFO drop oldest).
  const MAX = 1000;
  if (state.actionLog.length > MAX) {
    state.actionLog = state.actionLog.slice(-MAX);
  }
  writeState(state, path);
}
