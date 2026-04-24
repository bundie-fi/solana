import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchAllMarkets } from "@/lib/markets";
import {
  resolveSns,
  resolveVaultFromSns,
  truncatePubkey,
  HERO_AGENTS,
} from "@/lib/sns-resolver";
import { PortfolioCompositionBar } from "@/components/portfolio-composition-bar";
import { AgentMarketColumn } from "@/components/agent-market-column";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Agent profile page — e.g. /agent/charlie.bundie.
 *
 * Layout:
 *   - Hero with emoji + SNS name + vault pubkey
 *   - Stat cards (markets created / active / resolved / yes-no split)
 *   - Portfolio composition bar (%SOL / %USDC / %mSOL / %kTokens)
 *   - Two-column markets list:
 *       left: "Markets I created on others"
 *       right: "Markets created on me" (kind=6 with target_agent=me)
 *   - SNS record strip
 */
export default async function AgentProfilePage({
  params,
}: {
  params: { sns: string };
}) {
  const decoded = decodeURIComponent(params.sns);

  const vaultFromName = resolveVaultFromSns(decoded);
  const vault = vaultFromName ?? decoded;
  const sns = resolveSns(vault);

  if (!sns && !vaultFromName) {
    notFound();
  }

  const connection = getDevnetConnection();
  const allMarkets = await fetchAllMarkets(connection);
  const createdByMe = allMarkets.filter((m) => m.createdBy === vault);
  const onMe = allMarkets.filter(
    (m) => m.kind === 6 && m.targetAgent === vault,
  );

  // Pull vault balances for the composition bar. We read SOL + parsed SPL
  // token accounts; the bar component decides the stack colors + labels.
  let solLamports = 0;
  let tokenAccounts: Array<{ mint: string; uiAmount: number }> = [];
  try {
    const [sol, parsed] = await Promise.all([
      connection.getBalance(new PublicKey(vault), "confirmed"),
      connection.getParsedTokenAccountsByOwner(new PublicKey(vault), {
        programId: new PublicKey(
          "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        ),
      }),
    ]);
    solLamports = sol;
    tokenAccounts = parsed.value
      .map((ta) => {
        const info = ta.account.data.parsed?.info;
        const uiAmount: number = info?.tokenAmount?.uiAmount ?? 0;
        return {
          mint: (info?.mint as string) ?? "",
          uiAmount,
        };
      })
      .filter((t) => t.uiAmount > 0 && t.mint);
  } catch {
    // Swallow — composition bar has its own empty state.
  }

  const resolvedMarkets = createdByMe.filter((m) => m.status === "resolved");
  const activeMarkets = createdByMe.filter((m) => m.status === "active");
  const yesWins = resolvedMarkets.filter((m) => m.outcome === "yes").length;
  const noWins = resolvedMarkets.filter((m) => m.outcome === "no").length;

  const displayName = sns?.devnetName ?? truncatePubkey(vault);
  const mainnetName = sns?.mainnetName ?? null;
  const heroEmoji =
    HERO_AGENTS.find((a) => a.vault === vault)?.emoji ?? "🤖";
  const solBalance = solLamports / LAMPORTS_PER_SOL;

  return (
    <main className="mx-auto w-full max-w-content px-4 py-8 pb-safe">
      <Link
        href="/agents"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-purple-300 hover:text-purple-200"
      >
        ← All agents
      </Link>

      {/* Hero */}
      <section className="mt-6 flex items-start gap-5">
        <div className="h-16 w-16 shrink-0 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-4xl">
          {heroEmoji}
        </div>
        <div className="min-w-0">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-400">
            Bundie agent
          </span>
          <h1 className="font-serif text-display text-neutral-900 leading-tight mt-1 break-all">
            <em>{displayName}</em>
          </h1>
          {mainnetName && (
            <p className="mt-1 font-mono text-sm text-neutral-700">
              mainnet:{" "}
              <span className="text-amber-400">{mainnetName}</span>
            </p>
          )}
          <p className="mt-1 font-mono text-xs text-neutral-600 break-all">
            vault:{" "}
            <a
              href={`https://explorer.solana.com/address/${vault}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-amber-400"
            >
              {vault}
            </a>
          </p>
        </div>
      </section>

      {/* Stat cards */}
      <section className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="SOL balance" value={solBalance.toFixed(4)} />
        <StatCard
          label="Markets created"
          value={createdByMe.length.toString()}
        />
        <StatCard label="On me (kind=6)" value={onMe.length.toString()} />
        <StatCard
          label="Resolved (Y/N)"
          value={
            resolvedMarkets.length === 0
              ? "—"
              : `${yesWins}/${noWins}`
          }
        />
      </section>

      {/* Portfolio composition */}
      <section className="mt-8">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600 mb-3">
          Portfolio composition
        </h2>
        <PortfolioCompositionBar
          solLamports={solLamports}
          tokenAccounts={tokenAccounts}
        />
      </section>

      {/* Two-column markets */}
      <section className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        <AgentMarketColumn
          title="Markets I created"
          subtitle="kind=5 rate barriers + kind=6 on other agents"
          emptyLabel="This agent hasn't opened a market yet."
          markets={createdByMe}
          showTarget
          selfVault={vault}
        />
        <AgentMarketColumn
          title="Markets on me"
          subtitle="Other agents betting on this vault's performance"
          emptyLabel="No markets target this agent yet."
          markets={onMe}
          showCreator
          selfVault={vault}
        />
      </section>

      {/* Active vs resolved stat strip (under the columns) */}
      <div className="mt-6 grid grid-cols-2 gap-3 text-sm text-neutral-700">
        <span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-success-400 mr-2">
            active
          </span>
          {activeMarkets.length}
        </span>
        <span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-500 mr-2">
            resolved
          </span>
          {resolvedMarkets.length}
        </span>
      </div>

      {/* SNS record strip */}
      {sns && (
        <section className="mt-12 rounded-xl border border-neutral-300 bg-surface/60 p-5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600 mb-2">
            SNS record
          </h2>
          <p className="text-sm text-neutral-800">
            <span className="font-mono text-amber-400">{sns.devnetName}</span>{" "}
            lives on devnet under the{" "}
            <span className="font-mono">.bundie</span> root owned by the Bundie
            protocol authority.
          </p>
          <p className="text-xs text-neutral-600 mt-2">
            NameRegistry PDA:{" "}
            <a
              href={`https://explorer.solana.com/address/${sns.devnetSnsPda}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="underline text-amber-400 break-all"
            >
              {sns.devnetSnsPda}
            </a>
          </p>
          {mainnetName ? (
            <p className="text-xs text-neutral-600 mt-2">
              Mainnet{" "}
              <span className="font-mono text-amber-400">{mainnetName}</span>{" "}
              is planned under{" "}
              <span className="font-mono">bundie.sol</span> (protocol-owned
              root).
              <span className="block mt-1 text-[10px] text-neutral-500">
                Footnote: mainnet registration is queued for the next batch;
                the subdomain namespace stays under Bundie protocol control.
              </span>
            </p>
          ) : (
            <p className="text-xs text-neutral-600 mt-2">
              No mainnet subdomain registered — devnet only.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-300 bg-gradient-to-b from-neutral-200 to-neutral-100 p-4 hover:border-amber-400/60 transition-colors">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600">
        {label}
      </div>
      <div className="font-serif text-2xl text-neutral-900 mt-1 nums">
        {value}
      </div>
    </div>
  );
}
