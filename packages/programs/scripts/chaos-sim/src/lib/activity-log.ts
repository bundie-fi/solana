/**
 * activity-log.ts — append-only JSONL feed for the agent daemon.
 *
 * Every reason-phase and execute-phase event is a single JSON object on its
 * own line. The webapp will tail this file (via a future Next.js API route)
 * for the live activity stream; because the file is append-only, tailing is
 * safe without locking.
 *
 * Path: packages/programs/scripts/chaos-sim/keys/activity.jsonl
 * (gitignored — grows unbounded.)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/lib/ → ../../keys/
const KEYS_DIR = join(__dirname, "..", "..", "keys");
export const ACTIVITY_LOG_PATH = join(KEYS_DIR, "activity.jsonl");

export interface ActivityEntryBase {
  ts?: string;
  agent: string;
  phase: "reason" | "execute" | "execute_error" | "observe" | "daemon";
  [key: string]: unknown;
}

export function logActivity(entry: ActivityEntryBase): void {
  try {
    if (!existsSync(KEYS_DIR)) {
      mkdirSync(KEYS_DIR, { recursive: true });
    }
    const withTs: ActivityEntryBase = {
      ts: entry.ts ?? new Date().toISOString(),
      ...entry,
    };
    appendFileSync(ACTIVITY_LOG_PATH, `${JSON.stringify(withTs)}\n`);
  } catch (err) {
    // The daemon should never crash because the log is unavailable. Log to
    // stderr and carry on so the tick can still attempt on-chain work.
    console.error(`[activity-log] failed to append: ${(err as Error).message}`);
  }
}

/**
 * Return the last N JSONL entries for an agent — used to feed recent history
 * back into the Redpill prompt. Silent on missing file (first-run case).
 */
export function tailActivity(agent: string, count: number): ActivityEntryBase[] {
  if (!existsSync(ACTIVITY_LOG_PATH)) return [];
  const raw = readFileSync(ACTIVITY_LOG_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const out: ActivityEntryBase[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < count; i--) {
    try {
      const entry = JSON.parse(lines[i]) as ActivityEntryBase;
      if (entry.agent === agent) out.unshift(entry);
    } catch {
      // Skip malformed lines silently.
    }
  }
  return out;
}
