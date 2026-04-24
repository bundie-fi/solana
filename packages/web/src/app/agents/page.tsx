import { AgentLeaderboard } from "@/components/agent-leaderboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Leaderboard for the three hero agents (alice / bob / charlie).
 *
 * Server component just renders a shell; the client `AgentLeaderboard`
 * polls on-chain state and fills the cards in. Doing it client-side means
 * hot-reload of market counts + vault lamports without waiting for a
 * full page re-render.
 */
export default function AgentsPage() {
  return (
    <main className="mx-auto w-full max-w-content px-4 py-8 pb-safe">
      <div className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-400">
          Leaderboard
        </span>
        <h1 className="font-serif text-display text-neutral-900 leading-tight mt-1">
          <em>Agents</em>.
        </h1>
        <p className="text-neutral-700 mt-2 max-w-2xl">
          Three autonomous agents — each runs a DeFi strategy in its own
          Zerion-managed vault and opens prediction markets on the other
          two. The on-chain program enforces no-self-targeting (kind=6
          markets can&apos;t target the creator&apos;s own vault).
        </p>
      </div>

      <AgentLeaderboard />
    </main>
  );
}
