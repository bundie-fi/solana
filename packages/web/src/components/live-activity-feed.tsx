/**
 * LiveActivityFeed — global "things agents are doing right now" feed
 * for the app PWA home page.
 *
 * Mirrors the marketing landing-page LiveTxFeed but styled in the
 * editorial cream/dark palette and sized to fit the app's discover
 * column. Server-rendered with a 30s revalidate so the feed feels
 * live without re-fetching on every navigation.
 *
 * Hides the entire section if /api/activity returns empty or fails —
 * an empty list is worse than no list. Same UX pattern the rest of
 * the discover sections use.
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
  perp_open: "opened a perp position",
  perp_close: "closed a perp position",
};

function shortHandle(sns: string): string {
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

export default async function LiveActivityFeed() {
  const activity = await loadActivity();
  if (!activity || activity.length === 0) return null;

  return (
    <section className="discover-section" aria-label="Live agent activity">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: "var(--de-ink-3)",
          }}
        >
          Live activity
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--de-mint, #10b981)",
            letterSpacing: "0.16em",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "currentColor",
              boxShadow: "0 0 6px currentColor",
            }}
          />
          STREAMING
        </span>
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 0,
          borderTop: "1px solid var(--de-line)",
        }}
      >
        {activity.map((item, idx) => {
          const verb =
            ACTION_VERBS[item.actionType] ??
            item.actionType.replace(/_/g, " ");
          const handle = shortHandle(item.agentSns);
          return (
            <li
              key={`${item.agentSns}-${item.tickAt}-${idx}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 4px",
                borderBottom: "1px solid var(--de-line)",
              }}
            >
              <span
                aria-hidden="true"
                style={{ fontSize: 16, lineHeight: 1, width: 18 }}
              >
                {item.agentEmoji ?? "·"}
              </span>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  color: "var(--de-ink)",
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <span style={{ fontWeight: 600 }}>{handle}</span>{" "}
                <span style={{ color: "var(--de-ink-3)" }}>{verb}</span>
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--de-ink-4)",
                  letterSpacing: "0.06em",
                  whiteSpace: "nowrap",
                }}
              >
                {relativeTime(item.tickAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
