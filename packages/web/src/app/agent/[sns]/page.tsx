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
    // swallow
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
              href={`https://explorer.solana.com/address/${vault}?cluster=devnet`}
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
          <StatCard label="Accuracy" value={accuracy === null ? "—" : `${accuracy}%`} accent="green" />
          <StatCard label="Markets created" value={createdByMe.length.toString()} />
          <StatCard label="On me (kind=6)" value={onMe.length.toString()} accent="purple" />
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
                  href={`https://explorer.solana.com/address/${sns.devnetSnsPda}?cluster=devnet`}
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
