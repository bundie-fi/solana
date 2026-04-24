import Link from "next/link";
import { notFound } from "next/navigation";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchMarketsByCreator } from "@/lib/markets";
import { rateCategoryById } from "@/lib/rate-categories";
import {
  resolveSns,
  resolveVaultFromSns,
  truncatePubkey,
} from "@/lib/sns-resolver";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Agent profile page — e.g. /agent/alice.bundie.
 *
 * Lookup order:
 *   1. Treat `sns` param as a `.bundie[.sol]` name and reverse-resolve
 *      via the static map in lib/sns-resolver.
 *   2. Fall back to treating the param as a raw base58 vault pubkey
 *      (so `/agent/5ZnHt…` links still work when we don't have a name).
 *
 * The SNS record strip at the bottom calls out what's registered where
 * and what's still documented intent (mainnet `.bundie.sol`).
 */
export default async function AgentProfilePage({
  params,
}: {
  params: { sns: string };
}) {
  const decoded = decodeURIComponent(params.sns);

  // 1) try name lookup, 2) fall back to raw vault pubkey
  const vaultFromName = resolveVaultFromSns(decoded);
  const vault = vaultFromName ?? decoded;
  const sns = resolveSns(vault);

  if (!sns && !vaultFromName) {
    // The param was neither a known SNS name nor a pubkey we recognise;
    // 404 rather than silently showing an empty profile.
    notFound();
  }

  const connection = getDevnetConnection();
  const markets = await fetchMarketsByCreator(connection, vault);

  const resolvedMarkets = markets.filter((m) => m.status === "resolved");
  const activeMarkets = markets.filter((m) => m.status === "active");
  const yesWins = resolvedMarkets.filter((m) => m.outcome === "yes").length;
  const noWins = resolvedMarkets.filter((m) => m.outcome === "no").length;

  const displayName = sns?.devnetName ?? truncatePubkey(vault);
  const mainnetName = sns?.mainnetName ?? null;

  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <Link
        href="/markets"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-purple-300 hover:text-purple-200"
      >
        ← Back to markets
      </Link>

      {/* ─── Hero ─── */}
      <section className="mt-6 flex items-start gap-5">
        <div className="h-16 w-16 shrink-0 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-4xl">
          🤖
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
              mainnet: <span className="text-amber-400">{mainnetName}</span>
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

      {/* ─── Stat cards ─── */}
      <section className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Markets created" value={markets.length.toString()} />
        <StatCard label="Active" value={activeMarkets.length.toString()} />
        <StatCard
          label="Resolved"
          value={resolvedMarkets.length.toString()}
        />
        <StatCard
          label="YES / NO split"
          value={
            resolvedMarkets.length === 0
              ? "— (no resolutions yet)"
              : `${yesWins} / ${noWins}`
          }
        />
      </section>

      {/* ─── Markets list ─── */}
      <section className="mt-10">
        <h2 className="font-serif text-h1 text-neutral-900 mb-4">
          <em>Markets by {displayName}</em>
        </h2>
        {markets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-surface p-8 text-center">
            <p className="text-sm text-neutral-700">
              No markets yet for this agent.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {markets.map((m) => {
              const cat = rateCategoryById(m.rateReaderSelector);
              return (
                <li key={m.address}>
                  <Link
                    href={`/market/${m.address}`}
                    className="flex items-start gap-3 rounded-lg border border-neutral-300 bg-surface p-4 hover:border-amber-400/80 transition-colors"
                  >
                    <span className="text-lg shrink-0" aria-hidden="true">
                      {cat?.emoji ?? "📊"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600">
                        {cat?.label ?? `Kind ${m.kind}`}
                      </div>
                      <div className="font-serif text-base text-neutral-900 line-clamp-2">
                        {m.question || "—"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-600">
                        {m.status}
                        {m.outcome ? ` · ${m.outcome}` : ""}
                      </div>
                      <div className="font-mono text-xs text-neutral-700 nums">
                        {(m.totalVolume / 1e6).toFixed(2)} USDC
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ─── SNS record strip ─── */}
      {sns && (
        <section className="mt-12 rounded-xl border border-neutral-300 bg-surface/60 p-5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600 mb-2">
            SNS record
          </h2>
          <p className="text-sm text-neutral-800">
            <span className="font-mono text-amber-400">{sns.devnetName}</span>{" "}
            is a real SPL Name Service registration on devnet under the{" "}
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
              <span className="font-mono text-amber-400">{mainnetName}</span> is
              registered under <span className="font-mono">bundie.sol</span>{" "}
              (owned by the Bundie protocol authority).
            </p>
          ) : (
            <p className="text-xs text-neutral-600 mt-2">
              Mainnet subdomain not yet registered — this agent lives on
              devnet only.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-300 bg-surface p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600">
        {label}
      </div>
      <div className="font-serif text-2xl text-neutral-900 mt-1 nums">
        {value}
      </div>
    </div>
  );
}
