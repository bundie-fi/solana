/**
 * AWS Health Dashboard incident resolver.
 *
 * Resolves `MARKET_KIND_PUBLIC_STATUS_POLL` (kind=9) markets where the
 * trigger is "AWS reported a regional incident exceeding
 * min_duration_seconds within the outcome window".
 *
 * The legacy `status.aws.amazon.com/data.json` endpoint now redirects to
 * `health.aws.amazon.com/public/currentevents` and returns a different
 * shape: a flat array of per-incident objects, each carrying its own
 * `event_log[]` timeline. The body is also UTF-16 BE encoded with a
 * leading BOM; the decode dance lives in the `fetch` block below.
 *
 * Per-incident shape:
 *   {
 *     date: "1772369485",        // unix seconds (start of incident)
 *     arn: "arn:aws:health:<region>::event/...",
 *     region_name: "UAE",        // friendly name, NOT the canonical region id
 *     status: "3",               // numeric string: 0=ok 1=info 2=degraded 3=outage
 *     service: "<svc>-<region>", // contains canonical region id
 *     event_log: [               // ascending timeline
 *       { timestamp: 1772369485, status: 1, message: "...", summary: "..." },
 *       { timestamp: 1772370000, status: 0, message: "...", summary: "..." },
 *     ],
 *   }
 *
 * Region matching uses the canonical id (e.g. `us-east-1`) extracted from
 * the `arn` field, NOT the human-readable `region_name`.
 */

import { RESOLVER_CLASS } from "../types.js";
import type { Resolver } from "../types.js";

export interface AwsHealthIncidentConfig {
  feed_url: string;
  region_filter: string[];
  min_duration_seconds: number;
  outcome_window_seconds: number;
  poll_interval_seconds: number;
}

interface AwsHealthLogEntry {
  timestamp: number; // unix seconds
  status: number; // 0=ok, 1=info, 2=degraded, 3=outage
  message?: string;
  summary?: string;
}

interface AwsHealthEvent {
  date: string;
  arn?: string;
  region_name?: string;
  service?: string;
  service_name?: string;
  summary?: string;
  status?: string | number;
  event_log?: AwsHealthLogEntry[];
}

type AwsHealthPayload = AwsHealthEvent[];

/** Extract the canonical AWS region id (e.g. "us-east-1") from an arn string. */
function regionFromArn(arn: string | undefined): string | null {
  if (!arn) return null;
  // arn:aws:health:<region>::event/...
  const parts = arn.split(":");
  return parts[3] || null;
}

const launchTimes = new Map<string, number>();

export class AwsHealthIncidentResolver
  implements Resolver<AwsHealthIncidentConfig>
{
  readonly className = "aws_health_dashboard_incident";
  readonly classId = RESOLVER_CLASS.AWS_HEALTH_DASHBOARD_INCIDENT;

  async poll(
    eventId: string,
    config: AwsHealthIncidentConfig,
    now: Date,
  ): Promise<"yes" | "no" | null> {
    const nowMs = now.getTime();
    if (!launchTimes.has(eventId)) launchTimes.set(eventId, nowMs);
    const startMs = launchTimes.get(eventId)!;
    const windowEndMs = startMs + config.outcome_window_seconds * 1000;

    let payload: AwsHealthPayload;
    try {
      const res = await fetch(config.feed_url, {
        headers: { Accept: "application/json", "User-Agent": "Bundie/1.0" },
      });
      if (!res.ok) {
        console.warn(`[aws-health] ${eventId} fetch failed: ${res.status}`);
        return null;
      }
      // AWS Health's data.json comes back UTF-16 BE encoded (leading
      // bytes 0xFE 0xFF, then every other byte 0x00). Node's fetch
      // res.text() assumes UTF-8 and produces garbage; res.json() chokes
      // on the BOM. Inspect the first bytes, pick the right decoder, and
      // belt-and-suspenders strip any residual U+FEFF after decoding —
      // covers UTF-16 BE/LE and UTF-8 BOM uniformly.
      const buf = new Uint8Array(await res.arrayBuffer());
      let encoding: "utf-16be" | "utf-16le" | "utf-8" = "utf-8";
      if (buf[0] === 0xfe && buf[1] === 0xff) encoding = "utf-16be";
      else if (buf[0] === 0xff && buf[1] === 0xfe) encoding = "utf-16le";
      const text = new TextDecoder(encoding).decode(buf).replace(/^﻿/, "");
      payload = JSON.parse(text) as AwsHealthPayload;
    } catch (err) {
      console.warn(
        `[aws-health] ${eventId} fetch error: ${(err as Error).message}`,
      );
      return null;
    }

    const events: AwsHealthPayload = Array.isArray(payload) ? payload : [];
    const regionFilter = config.region_filter.map((r) => r.toLowerCase());

    // Each incident already carries its own timeline in `event_log[]`. We
    // walk that per-incident, accumulating degraded/outage durations.
    // Trigger as soon as ANY incident in scope exceeds the threshold.
    let triggered = false;
    let triggerNote = "";

    for (const e of events) {
      const region = regionFromArn(e.arn);
      if (!region) continue;
      const regionLc = region.toLowerCase();
      const matches = regionFilter.some((r) => regionLc === r || regionLc.includes(r));
      if (!matches) continue;

      const log = (e.event_log ?? [])
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp);
      if (log.length === 0) continue;

      // Ignore incidents that started after our window OR that ended
      // before our window began. Cheap pre-filter; the per-segment loop
      // below also clips to [startMs, windowEndMs].
      const incidentStartMs = log[0].timestamp * 1000;
      const incidentEndMs = log[log.length - 1].timestamp * 1000;
      if (incidentStartMs > windowEndMs) continue;
      if (incidentEndMs < startMs && log[log.length - 1].status === 0) continue;

      // Walk transitions: a contiguous run with status>=2 is a
      // "degraded/outage segment". We sum segment durations within the
      // outcome window; if any single segment ≥ min_duration → trigger.
      let segOpenAt: number | null = null;
      for (const entry of log) {
        const tMs = entry.timestamp * 1000;
        if (entry.status >= 2 && segOpenAt === null) {
          segOpenAt = Math.max(tMs, startMs);
        } else if (entry.status < 2 && segOpenAt !== null) {
          const closeMs = Math.min(tMs, windowEndMs);
          const durSec = (closeMs - segOpenAt) / 1000;
          if (durSec >= config.min_duration_seconds) {
            triggered = true;
            triggerNote = `arn=${e.arn} segment_duration=${durSec.toFixed(0)}s`;
            break;
          }
          segOpenAt = null;
        }
      }
      if (triggered) break;

      // Segment still open at the end of the log → treat as ongoing.
      // Clip to min(now, windowEndMs) and check duration.
      if (segOpenAt !== null) {
        const closeMs = Math.min(nowMs, windowEndMs);
        const durSec = (closeMs - segOpenAt) / 1000;
        if (durSec >= config.min_duration_seconds) {
          triggered = true;
          triggerNote = `arn=${e.arn} ongoing_duration=${durSec.toFixed(0)}s`;
          break;
        }
      }
    }

    if (triggered) {
      console.log(`[aws-health] YES trigger: event=${eventId} ${triggerNote}`);
    }

    if (triggered) return "yes";
    if (nowMs >= windowEndMs) {
      console.log(`[aws-health] NO: event=${eventId} window expired`);
      return "no";
    }
    return null;
  }
}
