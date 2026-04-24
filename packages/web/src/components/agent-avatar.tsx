"use client";

import React from "react";

interface AgentAvatarProps {
  /** "alice" | "bob" | "charlie" — maps to CSS class */
  agent: string;
  size?: number;
  beat?: boolean;
  delay?: number;
  style?: "emoji" | "mono" | "sigil";
}

const AGENT_MAP: Record<string, { cls: string; emoji: string }> = {
  alice:   { cls: "agent-alice", emoji: "🌱" },
  bob:     { cls: "agent-bob",   emoji: "💰" },
  charlie: { cls: "agent-cha",   emoji: "⚖️" },
};

// Resolve from vault pubkey or sns name to agent key
export function resolveAgentKey(identifier: string): string | null {
  const lower = identifier.toLowerCase();
  if (lower.includes("alice")) return "alice";
  if (lower.includes("bob")) return "bob";
  if (lower.includes("charlie")) return "charlie";
  return null;
}

export function AgentAvatar({ agent, size = 36, beat = true, delay = 0, style = "emoji" }: AgentAvatarProps) {
  const a = AGENT_MAP[agent.toLowerCase()];
  if (!a) {
    // Fallback for unknown agents
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--bg-3)",
          border: "1px solid var(--line-2)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontFamily: "var(--font-mono)",
          fontSize: size * 0.4,
          color: "var(--fg-4)",
          fontWeight: 600,
        }}
      >
        {agent[0]?.toUpperCase() ?? "?"}
      </span>
    );
  }

  const monogram = agent[0].toUpperCase();

  return (
    <span
      className={`agent-avatar ${a.cls}`}
      style={{ width: size, height: size, "--hb-delay": `${delay}s` } as React.CSSProperties}
    >
      <span className="ring" />
      <span className="face" style={{ fontSize: style === "mono" ? size * 0.4 : size * 0.5 }}>
        {style === "mono" ? (
          <span className="mono" style={{ color: "currentColor", fontWeight: 600, letterSpacing: "0.04em" }}>
            {monogram}
          </span>
        ) : style === "sigil" ? (
          <AgentSigil agent={agent.toLowerCase()} size={size * 0.55} />
        ) : (
          <span style={{ fontSize: size * 0.55 }}>{a.emoji}</span>
        )}
      </span>
      {beat && <span className="heartbeat" />}
    </span>
  );
}

function AgentSigil({ agent, size = 18 }: { agent: string; size: number }) {
  const paths: Record<string, React.ReactNode> = {
    alice: (
      <g>
        <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="12" cy="12" r="2" fill="currentColor"/>
        <path d="M12 4v3M12 17v3M4 12h3M17 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </g>
    ),
    bob: (
      <g>
        <path d="M5 17 L9 9 L13 14 L17 6 L19 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"/>
        <circle cx="19" cy="11" r="1.5" fill="currentColor"/>
      </g>
    ),
    charlie: (
      <g>
        <rect x="6" y="6" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M6 12h12M12 6v12" stroke="currentColor" strokeWidth="1" opacity=".6"/>
      </g>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {paths[agent] ?? null}
    </svg>
  );
}
