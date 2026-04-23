/**
 * recorder.ts — append-only event log + anomaly detector.
 *
 * Every action the harness takes (or attempts) becomes one JSONL line in
 * `logs/run-<timestamp>/events.jsonl`. Anomalies (cli failure, neg-NAV,
 * panic strings) get a parallel line in `anomalies.jsonl` for fast review.
 */
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Phase = "setup" | "create" | "rebalance" | "market" | "trade" | "report";

export interface EventCommon {
  ts: string;          // ISO timestamp
  phase: Phase;
  role: string;        // e.g. "creator-2"
  action: string;      // e.g. "create-strategy"
  durationMs?: number;
}

export interface SuccessEvent extends EventCommon {
  ok: true;
  signature?: string;
  strategy?: string;
  market?: string;
  meta?: Record<string, unknown>;
}

export interface FailureEvent extends EventCommon {
  ok: false;
  error: string;
  stdoutTail?: string;
  stderrTail?: string;
}

export type Event = SuccessEvent | FailureEvent;

export interface Anomaly {
  ts: string;
  kind: "cli-fail" | "panic" | "negative-nav" | "settlement-mismatch" | "balance-underflow";
  role: string;
  detail: string;
}

export class Recorder {
  readonly runDir: string;
  readonly eventsPath: string;
  readonly anomaliesPath: string;
  private eventCount = 0;
  private anomalyCount = 0;

  constructor() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    this.runDir = join(__dirname, "..", "logs", `run-${ts}`);
    if (!existsSync(this.runDir)) mkdirSync(this.runDir, { recursive: true });
    this.eventsPath = join(this.runDir, "events.jsonl");
    this.anomaliesPath = join(this.runDir, "anomalies.jsonl");
  }

  event(e: Event): void {
    appendFileSync(this.eventsPath, JSON.stringify(e) + "\n");
    this.eventCount++;
    if (!e.ok) {
      this.anomaly({
        ts: e.ts,
        kind: "cli-fail",
        role: e.role,
        detail: `${e.action}: ${e.error}`,
      });
    }
    // Scan stdout/stderr for panic markers regardless of exit status.
    const probe = (e as SuccessEvent).meta as { stdoutTail?: string; stderrTail?: string } | undefined;
    const text = (probe?.stdoutTail || "") + "\n" + (probe?.stderrTail || "");
    if (
      text.includes("panicked at") ||
      text.includes("Program failed to complete") ||
      text.includes("AccountOwnedByWrongProgram") ||
      text.includes("InsufficientFunds")
    ) {
      this.anomaly({
        ts: e.ts,
        kind: "panic",
        role: e.role,
        detail: text.slice(0, 500),
      });
    }
  }

  anomaly(a: Anomaly): void {
    appendFileSync(this.anomaliesPath, JSON.stringify(a) + "\n");
    this.anomalyCount++;
  }

  summary(): { events: number; anomalies: number; runDir: string } {
    return {
      events: this.eventCount,
      anomalies: this.anomalyCount,
      runDir: this.runDir,
    };
  }
}
