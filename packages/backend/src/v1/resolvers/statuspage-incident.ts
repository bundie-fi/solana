/**
 * StatusPage v2 incident-duration resolver.
 *
 * Resolves `MARKET_KIND_PUBLIC_STATUS_POLL` (kind=9) markets where the
 * trigger is "the configured service had an incident exceeding
 * min_duration_seconds within the outcome window". Works against any
 * Atlassian-Statuspage-style API (Anthropic, OpenAI, Cloudflare, Stripe,
 * Vercel, etc. — they all expose /api/v2/incidents.json with the same
 * shape).
 *
 * Sources.json config for one of these markets looks like:
 *   {
 *     "status_url": "https://status.anthropic.com/api/v2/summary.json",
 *     "incidents_url": "https://status.anthropic.com/api/v2/incidents.json",
 *     "min_downtime_seconds": 300,
 *     "rolling_window_seconds": 604800,
 *     "outcome_window_seconds": 604800,
 *     "poll_interval_seconds": 60,
 *     "component_filter": ["API"]
 *   }
 *
 * Resolution semantics:
 *   - Fetch incidents in the last `outcome_window_seconds`.
 *   - Optionally filter to incidents touching components named in
 *     `component_filter` (case-insensitive substring match).
 *   - For each qualifying incident, compute its duration from
 *     created_at → resolved_at (or now if still active).
 *   - YES iff any one incident's duration ≥ min_downtime_seconds.
 *   - NO once the outcome window expires without a YES trigger.
 */

import { RESOLVER_CLASS } from "../types.js";
import type { Resolver } from "../types.js";

export interface StatuspageIncidentConfig {
  status_url?: string;
  incidents_url: string;
  min_downtime_seconds: number;
  rolling_window_seconds: number;
  outcome_window_seconds: number;
  poll_interval_seconds: number;
  component_filter?: string[];
}

interface StatuspageIncident {
  id: string;
  name: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  components?: Array<{ id: string; name: string }>;
}

interface StatuspageIncidentsPayload {
  incidents: StatuspageIncident[];
}

/** Per-event launch timestamp — markets that have been polling for longer
 *  than `outcome_window_seconds` resolve NO if no YES trigger fired. */
const launchTimes = new Map<string, number>();

export class StatuspageIncidentResolver
  implements Resolver<StatuspageIncidentConfig>
{
  readonly className = "statuspage_v2_incident_duration";
  readonly classId = RESOLVER_CLASS.STATUSPAGE_V2_INCIDENT_DURATION;

  async poll(
    eventId: string,
    config: StatuspageIncidentConfig,
    now: Date,
  ): Promise<"yes" | "no" | null> {
    const nowMs = now.getTime();
    const startMs = launchTimes.get(eventId) ?? nowMs;
    if (!launchTimes.has(eventId)) launchTimes.set(eventId, nowMs);

    // Fetch the incidents feed.
    let payload: StatuspageIncidentsPayload;
    try {
      const res = await fetch(config.incidents_url, {
        headers: { Accept: "application/json", "User-Agent": "Bundie/1.0" },
      });
      if (!res.ok) {
        console.warn(
          `[statuspage] ${eventId} fetch failed: ${res.status} ${res.statusText}`,
        );
        return null;
      }
      payload = (await res.json()) as StatuspageIncidentsPayload;
    } catch (err) {
      console.warn(
        `[statuspage] ${eventId} fetch error: ${(err as Error).message}`,
      );
      return null;
    }

    const windowStartMs = startMs;
    const windowEndMs = startMs + config.outcome_window_seconds * 1000;

    // Component filter (case-insensitive substring).
    const componentFilter = config.component_filter?.map((c) => c.toLowerCase());

    for (const incident of payload.incidents) {
      const createdAt = Date.parse(incident.created_at);
      if (isNaN(createdAt)) continue;
      // Skip incidents that started before this market's outcome window.
      if (createdAt < windowStartMs) continue;
      // Skip incidents that started after the outcome window ends.
      if (createdAt > windowEndMs) continue;

      // Component filter.
      if (componentFilter && componentFilter.length > 0) {
        const componentNames = (incident.components ?? []).map((c) =>
          c.name.toLowerCase(),
        );
        const matches = componentNames.some((name) =>
          componentFilter.some((f) => name.includes(f)),
        );
        if (!matches) continue;
      }

      const resolvedAt = incident.resolved_at
        ? Date.parse(incident.resolved_at)
        : nowMs;
      const durationMs = Math.max(0, resolvedAt - createdAt);
      if (durationMs / 1000 >= config.min_downtime_seconds) {
        console.log(
          `[statuspage] YES trigger: event=${eventId} incident="${incident.name}" duration=${(durationMs / 1000).toFixed(0)}s`,
        );
        return "yes";
      }
    }

    // No qualifying incident yet — if the outcome window has expired,
    // resolve NO.
    if (nowMs >= windowEndMs) {
      console.log(
        `[statuspage] NO trigger: event=${eventId} window expired without qualifying incident`,
      );
      return "no";
    }
    return null;
  }
}
