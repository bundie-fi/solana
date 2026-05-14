/**
 * AWS Health Dashboard incident resolver.
 *
 * Resolves `MARKET_KIND_PUBLIC_STATUS_POLL` (kind=9) markets where the
 * trigger is "AWS reported a regional incident exceeding
 * min_duration_seconds within the outcome window".
 *
 * AWS exposes the Health Dashboard JSON at
 * `https://status.aws.amazon.com/data.json` with a different shape than
 * Statuspage — uses `service_region` rather than component IDs. We
 * filter on the region_filter list.
 *
 * Payload shape (current observed format):
 *   {
 *     "archive": [...historical events...],
 *     "current": [...active events...]
 *   }
 * Each event has: service_name, service_region, summary, date,
 * status (0=ok, 1=informational, 2=degraded, 3=outage), details.
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

interface AwsHealthEvent {
  service_name: string;
  summary: string;
  date: string;
  status: number;
  service_region?: string;
  details?: string;
}

interface AwsHealthPayload {
  archive?: AwsHealthEvent[];
  current?: AwsHealthEvent[];
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
      payload = (await res.json()) as AwsHealthPayload;
    } catch (err) {
      console.warn(
        `[aws-health] ${eventId} fetch error: ${(err as Error).message}`,
      );
      return null;
    }

    const events = [...(payload.archive ?? []), ...(payload.current ?? [])];
    const regionFilter = config.region_filter.map((r) => r.toLowerCase());

    // The AWS Health JSON doesn't always include a structured duration.
    // We treat status >= 2 (degraded/outage) events as "the incident
    // started at .date and is ongoing until the next event for the same
    // service flips status back to 0 (ok)". This is approximate — for a
    // tighter signal, use the AWS Health API (requires AWS creds).
    const sortedEvents = events
      .filter((e) => {
        const eventTime = Date.parse(e.date);
        if (isNaN(eventTime)) return false;
        if (eventTime < startMs || eventTime > windowEndMs) return false;
        if (!e.service_region) return false;
        return regionFilter.some((r) =>
          e.service_region!.toLowerCase().includes(r),
        );
      })
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    // Walk the timeline per service+region, accumulating durations of
    // degraded/outage periods.
    interface OpenIncident {
      startMs: number;
      serviceKey: string;
    }
    const open = new Map<string, OpenIncident>();
    let triggered = false;

    for (const e of sortedEvents) {
      const t = Date.parse(e.date);
      const key = `${e.service_name}|${e.service_region}`;
      if (e.status >= 2) {
        if (!open.has(key)) {
          open.set(key, { startMs: t, serviceKey: key });
        }
      } else if (e.status === 0) {
        // status=0 closes an open incident.
        const o = open.get(key);
        if (o) {
          const durationSec = (t - o.startMs) / 1000;
          if (durationSec >= config.min_duration_seconds) {
            triggered = true;
            console.log(
              `[aws-health] YES trigger: event=${eventId} service=${key} duration=${durationSec.toFixed(0)}s`,
            );
            break;
          }
          open.delete(key);
        }
      }
    }

    // Any still-open incident that has already exceeded the duration counts.
    if (!triggered) {
      for (const o of open.values()) {
        const durationSec = (nowMs - o.startMs) / 1000;
        if (durationSec >= config.min_duration_seconds) {
          triggered = true;
          console.log(
            `[aws-health] YES trigger (ongoing): event=${eventId} service=${o.serviceKey} duration=${durationSec.toFixed(0)}s`,
          );
          break;
        }
      }
    }

    if (triggered) return "yes";
    if (nowMs >= windowEndMs) {
      console.log(`[aws-health] NO: event=${eventId} window expired`);
      return "no";
    }
    return null;
  }
}
