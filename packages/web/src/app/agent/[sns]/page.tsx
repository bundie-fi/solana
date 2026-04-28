import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchAllMarkets, fetchBundieVault } from "@/lib/markets";
import {
  fetchRegisteredAgents,
  fetchRegisteredVaultSet,
} from "@/lib/registry";
import { PROGRAM_IDS } from "@/lib/constants";
import {
  resolveSns,
  resolveVaultFromSns,
  truncatePubkey,
  HERO_AGENTS,
} from "@/lib/sns-resolver";
import { PortfolioCompositionBar } from "@/components/portfolio-composition-bar";
import { AgentMarketColumn } from "@/components/agent-market-column";
import {
  SurfpoolActivityPanel,
  type SurfpoolAction,
} from "@/components/surfpool-activity-panel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ARCHETYPES: Record<string, string> = {
  "alice.bundie":   "LST Rotation",
  "bob.bundie":     "Basis Trade",
  "charlie.bundie": "60/40 Conservative",
};

const AGENT_CLASSES: Record<string, string> = {
  "alice.bundie":   "agent-alice",
  "bob.bundie":     "agent-bob",
  "charlie.bundie": "agent-cha",
};

export default async function AgentProfilePage({
  params,
}: {
  params: { sns: string };
}) {
  const decoded = decodeURIComponent(params.sns);

  // Vault resolution has three sources, in order:
  //   (1) hardcoded HERO_AGENTS map (alice/bob/charlie hand-rolled SNS)
  //   (2) Supabase agent registry by SNS , wizard-created agents land here
  //   (3) raw decoded , if the URL is already a vault pubkey
  // The registry round-trip lets newly-launched agents work on first load
  // without waiting for an SNS-resolver redeploy.
  let vaultFromName = resolveVaultFromSns(decoded);
  // The chaos-sim signs create_market_v2 with the agent's KEYPAIR, so
  // Market.created_by stores agent_pubkey, not vault_pda. The "markets
  // I created" filter below needs both pubkeys to match.
  let agentPubkey: string | null = null;
  if (decoded.includes(".bundie")) {
    const registry = await fetchRegisteredAgents({ cache: "no-store" });
    const match = registry.find(
      (a) => a.sns === decoded || a.sns === `${decoded}.sol`,
    );
    if (match) {
      if (!vaultFromName && match.vault_pda) vaultFromName = match.vault_pda;
      if (match.agent_pubkey) agentPubkey = match.agent_pubkey;
    }
  }
  const vault = vaultFromName ?? decoded;
  const sns = resolveSns(vault);

  // Authoritative agent set is the Supabase registry. If the resolved
  // vault isn't in it, this is an unknown / zombie agent , surface 404
  // rather than rendering chain data for a creator the protocol no
  // longer recognises. Registry unreachable → empty set → 404 (we
  // deliberately don't fall through to HERO_AGENTS so old chaos-sim
  // pubkeys can't keep their profile pages alive).
  const allowedCreators = await fetchRegisteredVaultSet({
    cache: "no-store",
  });
  if (!allowedCreators.has(vault)) {
    notFound();
  }

  const connection = getDevnetConnection();
  // Pass the registry through so "markets on me" doesn't surface bets
  // opened by unregistered creators against this vault either.
  const allMarkets = await fetchAllMarkets(connection, { allowedCreators });
  // "Markets I created": the on-chain Market.created_by field stores
  // whichever pubkey signed create_market_v2 — that's vault_pda for the
  // legacy hero agents, agent_pubkey for chaos-sim / wizard agents.
  // Build a self-set so both flavors hit.
  const myKeys = new Set<string>([vault]);
  if (agentPubkey) myKeys.add(agentPubkey);
  const createdByMe = allMarkets.filter((m) => myKeys.has(m.createdBy));
  // "Markets opened against me": the brain's create_market action
  // populates Market.strategy with the predicted vault PDA (kind=1/3),
  // and additionally sets Market.targetAgent for kind=2's B side.
  // Match both fields against this agent's vault.
  const onMe = allMarkets.filter(
    (m) => m.strategy === vault || m.targetAgent === vault,
  );

  // Phase B+ NAV history for this agent , null until the agent has called
  // commit_nav at least once. Server-fetched alongside markets/balances so
  // the page stays SSR.
  const bundieVault = await fetchBundieVault(
    connection,
    PROGRAM_IDS.predictionMarket,
    vault,
  );

  // Known devnet token mints → protocol label + selector for rate context.
  // mSOL devnet is the Marinade mSOL mint deployed on devnet.
  const KNOWN_MINTS: Record<string, { label: string; protocol: string; selector: number; unit: string }> = {
    // Marinade mSOL (devnet) , when an agent stakes SOL via Beethoven execute
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": { label: "Marinade mSOL", protocol: "marinade", selector: 2, unit: "mSOL" },
    // Kamino kUSDC (devnet main-market reserve)
    "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy": { label: "Kamino kUSDC", protocol: "kamino", selector: 1, unit: "kUSDC" },
  };

  let solLamports = 0;
  let tokenAccounts: Array<{ mint: string; uiAmount: number }> = [];
  try {
    const [sol, parsed] = await Promise.all([
      // No string commitment , rpcfast strict-mode rejects it.
      connection.getBalance(new PublicKey(vault)),
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
    // swallow
  }

  // Strategy positions = token accounts that map to a known protocol.
  const strategyPositions = tokenAccounts
    .map((t) => ({ ...t, meta: KNOWN_MINTS[t.mint] }))
    .filter((t) => t.meta != null);

  // Surfpool activity feed , chaos-sim daemon writes each landed mainnet-fork
  // tx to the Postgres `agent_action_log` table; backend route serves them
  // keyed by the full SNS (alice.bundie.sol). resolveSns() returns
  // `devnetName: "alice.bundie"` (no .sol) for the on-chain devnet record,
  // but the agent registry stores the full form , so append `.sol` if
  // missing to make the lookup match. Failure here must NOT break the page
  // render , empty array is fine.
  const rawSns = sns?.devnetName ?? decoded;
  const surfpoolSns = rawSns.endsWith(".sol") ? rawSns : `${rawSns}.sol`;
  const backendBase =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
  let surfpoolActions: SurfpoolAction[] = [];
  try {
    const res = await fetch(
      `${backendBase}/api/agent/${encodeURIComponent(surfpoolSns)}/surfpool-activity?limit=20`,
    );
    if (res.ok) {
      const body = (await res.json()) as { actions?: SurfpoolAction[] };
      surfpoolActions = body.actions ?? [];
    }
  } catch {
    // backend down or unreachable , render empty panel rather than 500
  }

  const resolvedMarkets = createdByMe.filter((m) => m.status === "resolved");
  const activeMarkets = createdByMe.filter((m) => m.status === "active");
  const yesWins = resolvedMarkets.filter((m) => m.outcome === "yes").length;
  const noWins = resolvedMarkets.filter((m) => m.outcome === "no").length;
  const accuracy =
    resolvedMarkets.length === 0
      ? null
      : Math.round((noWins / resolvedMarkets.length) * 100);

  const displayName = sns?.devnetName ?? truncatePubkey(vault);
  const mainnetName = sns?.mainnetName ?? null;
  const heroEmoji =
    HERO_AGENTS.find((a) => a.vault === vault)?.emoji ?? "🤖";
  const solBalance = solLamports / LAMPORTS_PER_SOL;
  const archetype = ARCHETYPES[displayName] ?? "Agent";
  const agentClass = AGENT_CLASSES[displayName] ?? "";

  return (
    <main style={{ background: "var(--bg-0)", minHeight: "100vh" }}>
      {/* Mobile header with back */}
      <div className="sm:hidden top-header" style={{ paddingLeft: 8 }}>
        <Link
          href="/agents"
          className="btn btn-ghost"
          style={{ padding: "7px 10px", fontSize: 11, gap: 6, textDecoration: "none" }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>‹</span> Agents
        </Link>
        <span className="pill pill-gold" style={{ fontSize: 9 }}>{archetype}</span>
      </div>

      {/* Desktop back */}
      <div className="hidden sm:block" style={{ padding: "12px 20px 0" }}>
        <Link
          href="/agents"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            color: "var(--purple)",
            textDecoration: "none",
          }}
        >
          ← All agents
        </Link>
      </div>

      <div className="scroll-area" style={{ overflowY: "auto" }}>
        {/* Hero section */}
        <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid var(--line-1)" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
            {/* Avatar with gradient ring */}
            <span
              className={`agent-avatar ${agentClass}`}
              style={{ width: 64, height: 64 } as React.CSSProperties}
            >
              <span className="ring" />
              <span className="face" style={{ fontSize: 28 }}>{heroEmoji}</span>
              <span className="heartbeat" />
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bd-eyebrow" style={{ marginBottom: 4 }}>Bundie agent</div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 24,
                  color: "var(--fg-0)",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.1,
                  wordBreak: "break-all",
                }}
              >
                {displayName}
              </div>
              {mainnetName && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4, fontFamily: "var(--font-mono)" }}>
                  mainnet: <span style={{ color: "var(--gold)" }}>{mainnetName}</span>
                </div>
              )}
            </div>
          </div>

          {/* Vault strip */}
          <div
            className="card inset"
            style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}
          >
            <span className="bd-eyebrow" style={{ fontSize: 8.5 }}>Vault</span>
            <a
              href={`https://orbmarkets.io/address/${vault}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={{ fontSize: 10, color: "var(--gold)", wordBreak: "break-all", flex: 1, textDecoration: "none" }}
            >
              {vault}
            </a>
          </div>
        </div>

        {/* Stat cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 8,
            padding: "14px 16px",
            borderBottom: "1px solid var(--line-1)",
          }}
        >
          <StatCard label="SOL balance" value={`${solBalance.toFixed(4)} SOL`} />
          <StatCard label="Accuracy" value={accuracy === null ? "-" : `${accuracy}%`} accent="green" />
          <StatCard label="Markets created" value={createdByMe.length.toString()} />
          <StatCard label="Markets on me" value={onMe.length.toString()} accent="purple" />
        </div>

        {/* NAV history , last commit_nav snapshot from BundieVault PDA */}
        <div style={{ padding: "0 16px 12px" }}>
          <div className="card" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>NAV history</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, color: "var(--fg-0)" }}>
              {(Number(bundieVault?.navLamports ?? 0n) / 1_000_000).toFixed(2)}{" "}
              <span className="muted" style={{ fontSize: 13 }}>bUSD</span>
            </div>
            <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
              Last commit at slot {bundieVault?.navSlot?.toString() ?? "-"} (epoch {bundieVault?.navEpoch?.toString() ?? "0"})
            </div>
          </div>
        </div>

        {/* Resolved Y/N strip */}
        {resolvedMarkets.length > 0 && (
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line-1)" }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <span className="bd-eyebrow" style={{ fontSize: 9 }}>
                Resolved
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--fg-2)",
                }}
              >
                <span style={{ color: "var(--green-2)", fontWeight: 600 }}>YES {yesWins}</span>
                {" / "}
                <span style={{ color: "var(--red-2)", fontWeight: 600 }}>NO {noWins}</span>
              </span>
              <span className="dim mono-tiny">
                {activeMarkets.length} active
              </span>
            </div>
          </div>
        )}

        {/* Portfolio composition */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line-1)" }}>
          <div className="bd-eyebrow" style={{ marginBottom: 10 }}>Portfolio composition</div>
          <PortfolioCompositionBar
            solLamports={solLamports}
            tokenAccounts={tokenAccounts}
          />
        </div>

        {/* Strategy positions , live devnet positions from Beethoven execution */}
        {strategyPositions.length > 0 && (
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line-1)" }}>
            <div className="bd-eyebrow" style={{ marginBottom: 10 }}>
              Strategy positions
              <span className="muted mono" style={{ fontSize: 9, marginLeft: 8 }}>devnet execution · mainnet rate context</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {strategyPositions.map((pos) => (
                <div
                  key={pos.mint}
                  className="card inset"
                  style={{
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      className="pill pill-gold"
                      style={{ fontSize: 9, padding: "2px 6px" }}
                    >
                      {pos.meta!.protocol.toUpperCase()}
                    </span>
                    <div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-0)" }}>
                        {pos.uiAmount.toFixed(6)} {pos.meta!.unit}
                      </div>
                      <div className="muted" style={{ fontSize: 10, marginTop: 1 }}>
                        {pos.meta!.label} · selector={pos.meta!.selector}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="mono" style={{ fontSize: 10, color: "var(--gold)" }}>
                      rate market ready
                    </div>
                    <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>
                      resolution via on-chain reader
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live surfpool activity , mainnet-fork strategy txs */}
        <SurfpoolActivityPanel actions={surfpoolActions} />

        {/* Two-column markets */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(1, 1fr)",
            gap: 16,
            padding: "16px 16px 0",
          }}
          className="md-grid-2"
        >
          <AgentMarketColumn
            title="Markets I created"
            subtitle="Agent-vs-benchmark markets on peers"
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
        </div>

        {/* SNS record strip */}
        {sns && (
          <div style={{ padding: "16px 16px 32px" }}>
            <div className="card" style={{ padding: 16 }}>
              <div className="bd-eyebrow" style={{ marginBottom: 8 }}>SNS record</div>
              <p style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5, marginBottom: 10 }}>
                <span className="mono gold">{sns.devnetName}</span>{" "}
                lives on devnet under the{" "}
                <span className="mono">.bundie</span> root owned by the Bundie protocol authority.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span className="bd-eyebrow" style={{ fontSize: 8.5 }}>NameRegistry PDA</span>
                <a
                  href={`https://orbmarkets.io/address/${sns.devnetSnsPda}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="mono"
                  style={{ fontSize: 10, color: "var(--gold)", wordBreak: "break-all", textDecoration: "none" }}
                >
                  {sns.devnetSnsPda.slice(0, 8)}…{sns.devnetSnsPda.slice(-8)}
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  let valueColor = "var(--fg-0)";
  if (accent === "green") valueColor = "var(--green-2)";
  if (accent === "purple") valueColor = "var(--purple)";

  return (
    <div className="card" style={{ padding: "10px 14px" }}>
      <div className="bd-eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>{label}</div>
      <div
        className="mono"
        style={{ fontSize: 18, fontWeight: 600, color: valueColor }}
      >
        {value}
      </div>
    </div>
  );
}
