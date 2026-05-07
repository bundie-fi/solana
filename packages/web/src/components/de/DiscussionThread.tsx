/**
 * DiscussionThread — placeholder layout for the agent-detail discussion
 * surface. Mirrors the XO-Market IA (DISCUSSION / ACTIVITY tabs, sort
 * dropdown, comment input prompt) but ships as a screenshot-ready empty
 * state. Threading, replies, reactions, and the comment input handler are
 * intentionally out of scope until the moderation surface lands.
 *
 * Pure server component, no state, no client hooks.
 */
import type { CSSProperties } from "react";

export interface DiscussionThreadProps {
  /** SNS handle the empty-state copy is keyed against (display only). */
  agentSns?: string;
  style?: CSSProperties;
}

export function DiscussionThread({ agentSns, style }: DiscussionThreadProps) {
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
      {/* Tabs + sort */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          borderBottom: "1px solid var(--de-line-2)",
          paddingBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "inline-flex", gap: 24 }}>
          <Tab label="Discussion" active />
          <Tab label="Activity" />
        </div>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--de-ink-4)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Sort
          </span>
          <span
            aria-disabled
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--de-ink-2)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "6px 12px",
              border: "1px solid var(--de-line-2)",
              borderRadius: 8,
              background: "var(--de-bg-3)",
              cursor: "not-allowed",
              opacity: 0.7,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            Newest <span aria-hidden>▾</span>
          </span>
        </div>
      </div>

      {/* Comment input prompt (display-only) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          background: "var(--de-bg-raised)",
          border: "1px solid var(--de-line-2)",
          borderRadius: 12,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background:
              "linear-gradient(135deg, var(--de-lavender) 0%, var(--de-lavender-3) 100%)",
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--de-ink)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ?
        </span>
        <span
          style={{
            flex: 1,
            color: "var(--de-ink-4)",
            fontSize: 13.5,
            fontStyle: "italic",
            fontFamily: "var(--font-display)",
          }}
        >
          Connect a wallet to weigh in on{" "}
          {agentSns ? (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontStyle: "normal",
                color: "var(--de-ink-3)",
                fontSize: 12,
                letterSpacing: "0.02em",
              }}
            >
              {agentSns}
            </span>
          ) : (
            "this agent"
          )}
          .
        </span>
        <span
          aria-disabled
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--de-ink-4)",
            border: "1px solid var(--de-line-2)",
            borderRadius: 6,
            padding: "6px 12px",
            cursor: "not-allowed",
          }}
        >
          Post
        </span>
      </div>

      {/* Empty state */}
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
          No one has weighed in yet.
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
          For now, the agent's NAV chart and recent trades carry the conversation.
        </p>
      </div>
    </section>
  );
}

function Tab({ label, active }: { label: string; active?: boolean }) {
  return (
    <span
      style={{
        position: "relative",
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        letterSpacing: "0.20em",
        textTransform: "uppercase",
        color: active ? "var(--de-ink)" : "var(--de-ink-4)",
        fontWeight: active ? 600 : 500,
        paddingBottom: 14,
        marginBottom: -13,
        borderBottom: active
          ? "1.5px solid var(--de-lavender)"
          : "1.5px solid transparent",
      }}
    >
      {label}
    </span>
  );
}
