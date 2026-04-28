/**
 * LiveAgentCards — server-rendered "Examples on devnet today" strip.
 *
 * Tries the live backend first. Falls back to the hard-coded seed copy if
 * the API is unreachable so the section is never visibly broken.
 *
 * The agents endpoint currently returns metadata only (no NAV / slot fields)
 * so the live-NAV / last-commit-slot UI lights up the moment the backend
 * starts surfacing those fields — no further code change needed.
 */

export const revalidate = 30;

const APP_URL = "https://app.solana.bundie.fi";
const DOCS_URL = "/docs";
const BACKEND = "https://backend.solana.bundie.fi";

interface AgentRow {
  id?: string;
  sns: string;
  display_name?: string | null;
  tagline?: string | null;
  emoji?: string | null;
  status?: string | null;
  navLamports?: number | string | null;
  nav_lamports?: number | string | null;
  lastCommitSlot?: number | string | null;
  last_commit_slot?: number | string | null;
}

interface AgentCard {
  handle: string;
  emoji: string;
  bias: string;
  description: string;
  status: "active" | "paused" | "unknown";
  navUsd: string | null;
  lastSlot: string | null;
}

// Empty state when the backend is unreachable. Previously held
// alice/bob/charlie seed copy that kept rendering on the live site
// even after those agents stopped existing in the registry — fake
// data is worse than no data, so we now return nothing and let the
// downstream renderer hide the strip when there's nothing real to
// show.
const FALLBACK_AGENTS: AgentCard[] = [];

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function biasFromTagline(tagline: string | null | undefined): string {
  if (!tagline) return "Balanced";
  const t = tagline.toLowerCase();
  if (t.includes("aggressive")) return "Aggressive";
  if (t.includes("conservative")) return "Conservative";
  if (t.includes("balanced")) return "Balanced";
  return "Custom";
}

function normalizeStatus(s: string | null | undefined): AgentCard["status"] {
  if (s === "active") return "active";
  if (s === "paused") return "paused";
  return "unknown";
}

async function loadAgents(): Promise<AgentCard[]> {
  try {
    const res = await fetch(`${BACKEND}/api/agents`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return FALLBACK_AGENTS;
    const data = (await res.json()) as { agents?: AgentRow[] };
    const live = (data.agents ?? [])
      .filter((a) => a.sns)
      // Stable order: Alice, Bob, Charlie even though backend returns DESC.
      .sort((a, b) => (a.sns < b.sns ? -1 : a.sns > b.sns ? 1 : 0))
      .slice(0, 3)
      .map<AgentCard>((a) => {
        const nav = toNumber(a.navLamports ?? a.nav_lamports);
        const slot = toNumber(a.lastCommitSlot ?? a.last_commit_slot);
        return {
          handle: a.sns,
          emoji: a.emoji || "🤖",
          bias: biasFromTagline(a.tagline),
          description: a.tagline || "Autonomous DeFi agent.",
          status: normalizeStatus(a.status),
          navUsd:
            nav !== null ? `$${(nav / 1_000_000).toFixed(2)} bUSD` : null,
          lastSlot: slot !== null ? `slot ${slot}` : null,
        };
      });
    return live.length > 0 ? live : FALLBACK_AGENTS;
  } catch {
    return FALLBACK_AGENTS;
  }
}

export default async function LiveAgentCards() {
  const agents = await loadAgents();
  // No live agents AND no fallback → render nothing; the parent section
  // header reads fine on its own.
  if (agents.length === 0) return null;

  return (
    <div className="agent-strip">
      {agents.map((a) => (
        <article key={a.handle} className="agent-tile">
          <div className="agent-tile-head">
            <span className="agent-emoji" aria-hidden>
              {a.emoji}
            </span>
            <span
              className={`pill-status ${
                a.status === "active" ? "pill-live" : "pill-soon"
              }`}
            >
              {a.status === "active"
                ? "Active"
                : a.status === "paused"
                ? "Paused"
                : "Idle"}
            </span>
          </div>
          <div className="agent-handle">{a.handle}</div>
          <div className="agent-bias">{a.bias} bias</div>
          <p className="agent-desc">{a.description}</p>
          {(a.navUsd || a.lastSlot) && (
            <div className="agent-meta">
              {a.navUsd && (
                <div className="agent-meta-row">
                  <span className="agent-meta-label">NAV</span>
                  <span className="agent-meta-val">{a.navUsd}</span>
                </div>
              )}
              {a.lastSlot && (
                <div className="agent-meta-row">
                  <span className="agent-meta-label">last commit</span>
                  <span className="agent-meta-val">{a.lastSlot}</span>
                </div>
              )}
            </div>
          )}
          <a
            href={`${APP_URL}/agents/${a.handle.split(".")[0]}`}
            target="_blank"
            rel="noopener noreferrer"
            className="agent-cta"
          >
            View agent →
          </a>
          <div className="agent-credit">created by Bundie team</div>
        </article>
      ))}
      <article className="agent-tile agent-tile-cta">
        <div className="agent-tile-head">
          <span className="agent-emoji" aria-hidden>
            +
          </span>
        </div>
        <div className="agent-handle">launch your own</div>
        <div className="agent-bias">your brain · your strategy</div>
        <p className="agent-desc">
          Write a brain.md, wire policies, deploy a vault. Your agent shows up
          here.
        </p>
        <a href={DOCS_URL} className="agent-cta">
          Builder docs →
        </a>
        <div className="agent-credit">coming soon</div>
      </article>
    </div>
  );
}

