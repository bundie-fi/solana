/**
 * LiveTxFeed , server-rendered "things agents are doing right now" strip.
 *
 * Pulls the last N rows from /api/activity (which joins agent_action_log
 * with agents). Hides the entire component if the fetch fails OR returns
 * an empty list, so first paint never shows a sad empty state.
 *
 * Cached for 30s via the segment-level `revalidate` re-export , same
 * cadence as LiveAgentCards / LiveActivityBar.
 */

const BACKEND = "https://backend.solana.bundie.fi";

export const revalidate = 30;

interface ActivityItem {
  agentSns: string;
  agentEmoji: string | null;
  actionType: string;
  reasoning: string | null;
  tickAt: string;
}

interface ActivityResponse {
  activity?: ActivityItem[];
}

const ACTION_VERBS: Record<string, string> = {
  commit_nav: "committed NAV",
  lend_deposit: "deposited to a lending market",
  lend_withdraw: "withdrew from a lending market",
  lst_stake: "staked SOL",
  lst_unstake: "unstaked SOL",
  create_market: "created a prediction market",
  swap: "swapped tokens",
};

function shortHandle(sns: string): string {
  // alice.bundie.sol → alice
  return sns
    .replace(/\.bundie\.sol$/i, "")
    .replace(/\.bundie$/i, "")
    .replace(/\.sol$/i, "");
}

function relativeTime(tickAt: string): string {
  const t = new Date(tickAt).getTime();
  if (!Number.isFinite(t)) return "just now";
  const minutes = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function describe(item: ActivityItem): string {
  const verb = ACTION_VERBS[item.actionType] ?? item.actionType.replace(/_/g, " ");
  return `${shortHandle(item.agentSns)} ${verb}`;
}

async function loadActivity(): Promise<ActivityItem[] | null> {
  try {
    const res = await fetch(`${BACKEND}/api/activity?limit=8`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ActivityResponse;
    return data.activity ?? [];
  } catch {
    return null;
  }
}

export default async function LiveTxFeed() {
  const activity = await loadActivity();
  if (!activity || activity.length === 0) return null;

  return (
    <section className="content" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">Live activity</span>
          <h2 className="section" style={{ marginTop: 20 }}>
            Things agents are doing <em>right now.</em>
          </h2>
        </div>

        <ul className="tx-feed" aria-label="Recent agent activity">
          {activity.map((item, idx) => (
            <li key={`${item.agentSns}-${item.tickAt}-${idx}`} className="tx-feed-row">
              <span className="tx-feed-emoji" aria-hidden>
                {item.agentEmoji || "🤖"}
              </span>
              <span className="tx-feed-text">{describe(item)}</span>
              <span className="tx-feed-time">{relativeTime(item.tickAt)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
