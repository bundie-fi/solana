"use client";

/**
 * DiscussionThread — agent-detail tabbed panel: Discussion (placeholder)
 * + Activity (live, sourced from /api/activity?agent=<sns>).
 *
 * Was previously a screenshot-only placeholder where both tabs were
 * non-interactive <span>s and the input prompt always read "Connect a
 * wallet" regardless of actual wallet state — confusing on a connected
 * session. Promoted to a real client component:
 *
 *   - Tabs are buttons with onClick state. Clicking switches view.
 *   - Activity tab fetches recent actions for the agent and renders
 *     them with the same verb mapping the home LiveActivityFeed uses.
 *   - Discussion tab keeps the empty-state layout but the misleading
 *     "Connect a wallet" prompt is replaced with honest "Coming soon"
 *     copy — comments / threading aren't built yet, gating it on a
 *     wallet implies they will be once you connect, which isn't true.
 */
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://backend.solana.bundie.fi";

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

interface ActivityItem {
  actionType: string;
  reasoning: string | null;
  tickAt: string;
  agentEmoji: string | null;
}

export interface DiscussionThreadProps {
  agentSns?: string;
  style?: CSSProperties;
}

type ActiveTab = "discussion" | "activity";

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

export function DiscussionThread({ agentSns, style }: DiscussionThreadProps) {
  const [tab, setTab] = useState<ActiveTab>("discussion");
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [activityErr, setActivityErr] = useState<string | null>(null);

  // Fetch activity lazily — only when the user actually clicks Activity.
  // Avoids a wasted /api/activity round-trip for visitors who never leave
  // the Discussion placeholder.
  useEffect(() => {
    if (tab !== "activity" || !agentSns) return;
    if (activity !== null) return;
    const ctrl = new AbortController();
    fetch(`${BACKEND}/api/activity?agent=${encodeURIComponent(agentSns)}&limit=20`, {
      signal: ctrl.signal,
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setActivity(d.activity ?? []))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setActivityErr((e as Error).message.slice(0, 100));
      });
    return () => ctrl.abort();
  }, [tab, agentSns, activity]);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        padding: "32px 0",
        ...style,
      }}
    >
      {/* Tabs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--de-line-2)",
          paddingBottom: 12,
        }}
      >
        <div style={{ display: "inline-flex", gap: 24 }}>
          <Tab
            label="Discussion"
            active={tab === "discussion"}
            onClick={() => setTab("discussion")}
          />
          <Tab
            label="Activity"
            active={tab === "activity"}
            onClick={() => setTab("activity")}
          />
        </div>
      </div>

      {tab === "discussion" ? (
        <DiscussionEmpty agentSns={agentSns} />
      ) : (
        <ActivityList
          items={activity}
          err={activityErr}
          agentSns={agentSns}
        />
      )}
    </section>
  );
}

function Tab({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        letterSpacing: "0.20em",
        textTransform: "uppercase",
        color: active ? "var(--de-ink)" : "var(--de-ink-4)",
        fontWeight: active ? 600 : 500,
        paddingBottom: 14,
        marginBottom: -13,
        padding: "0 0 14px",
        borderBottom: active
          ? "1.5px solid var(--de-lavender)"
          : "1.5px solid transparent",
        minHeight: 44,
      }}
    >
      {label}
    </button>
  );
}

function DiscussionEmpty({ agentSns }: { agentSns?: string }) {
  return (
    <div
      style={{
        padding: "48px 24px",
        border: "1px dashed var(--de-line-2)",
        borderRadius: 12,
        textAlign: "center",
        background: "var(--de-bg)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 22,
          color: "var(--de-ink-2)",
          margin: 0,
          lineHeight: 1.3,
        }}
      >
        Discussion coming soon.
      </p>
      <p
        style={{
          marginTop: 10,
          fontSize: 13,
          color: "var(--de-ink-3)",
          maxWidth: 480,
          marginLeft: "auto",
          marginRight: "auto",
          lineHeight: 1.5,
        }}
      >
        Comments, reactions, and threaded replies land in a later release.
        For now switch to <strong style={{ color: "var(--de-ink-2)" }}>Activity</strong> to see what
        {agentSns ? (
          <> {agentSns} </>
        ) : (
          " this agent "
        )}
        is doing on-chain right now.
      </p>
    </div>
  );
}

function ActivityList({
  items,
  err,
  agentSns,
}: {
  items: ActivityItem[] | null;
  err: string | null;
  agentSns?: string;
}) {
  if (err) {
    return (
      <div
        style={{
          padding: "32px 24px",
          border: "1px dashed var(--de-line-2)",
          borderRadius: 12,
          textAlign: "center",
          background: "var(--de-bg)",
          color: "var(--de-ink-3)",
          fontSize: 13,
        }}
      >
        Couldn&apos;t load activity: {err}
      </div>
    );
  }
  if (items === null) {
    return (
      <div
        style={{
          padding: "32px 24px",
          textAlign: "center",
          color: "var(--de-ink-4)",
          fontSize: 13,
          fontFamily: "var(--font-mono)",
        }}
      >
        Loading…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          border: "1px dashed var(--de-line-2)",
          borderRadius: 12,
          textAlign: "center",
          background: "var(--de-bg)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 18,
            color: "var(--de-ink-3)",
            margin: 0,
          }}
        >
          {agentSns ?? "This agent"} hasn&apos;t logged any non-heartbeat
          actions yet.
        </p>
      </div>
    );
  }
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        borderTop: "1px solid var(--de-line)",
      }}
    >
      {items.map((item, idx) => {
        const verb =
          ACTION_VERBS[item.actionType] ??
          item.actionType.replace(/_/g, " ");
        return (
          <li
            key={`${item.tickAt}-${idx}`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "14px 4px",
              borderBottom: "1px solid var(--de-line)",
            }}
          >
            <span
              aria-hidden
              style={{ fontSize: 16, lineHeight: 1.4, width: 18 }}
            >
              {item.agentEmoji ?? "·"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 13.5,
                  color: "var(--de-ink)",
                  lineHeight: 1.4,
                }}
              >
                {verb}
              </div>
              {item.reasoning && (
                <div
                  style={{
                    marginTop: 4,
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: 13,
                    color: "var(--de-ink-3)",
                    lineHeight: 1.45,
                  }}
                >
                  {item.reasoning}
                </div>
              )}
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
  );
}
