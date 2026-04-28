"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  deriveMarketPdas,
  fetchAllMarkets,
  type MarketView,
} from "@/lib/markets";
import { PROGRAM_IDS } from "@/lib/constants";
import { PositionCard, type Position } from "@/components/position-card";
import {
  fetchPendingAgents,
  type AgentRowFull,
} from "@/app/create-agent/lib/api";

/**
 * My Bets , shows the connected wallet's YES/NO positions across every
 * Bundie prediction market.
 *
 * Read strategy: fetch every Market account, derive YES/NO mint PDAs,
 * derive the user's ATAs for each, and read balances in parallel. This is
 * N*2 RPC reads but devnet has <100 markets so the cost is trivial.
 */
export default function PortfolioPage() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();

  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingAgents, setPendingAgents] = useState<AgentRowFull[]>([]);

  const load = useCallback(async () => {
    if (!publicKey || !connected) {
      setPositions([]);
      setMarkets([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      // Use Promise.allSettled so a single transient RPC blip on getBalance
      // or getSlot doesn't kill the whole page render. fetchAllMarkets
      // already swallows its own errors.
      const [marketsRes, lamportsRes, slotRes] = await Promise.allSettled([
        fetchAllMarkets(connection),
        // Drop string commitment , rpcfast rejects positional `"confirmed"`
        // with `expected struct RpcContextConfig`. Connection default applies.
        connection.getBalance(publicKey),
        connection.getSlot(),
      ]);
      const allMkts =
        marketsRes.status === "fulfilled" ? marketsRes.value : [];
      const lamports =
        lamportsRes.status === "fulfilled" ? lamportsRes.value : null;
      const slot =
        slotRes.status === "fulfilled"
          ? slotRes.value
          : Math.floor(Date.now() / 400); // rough fallback; only used for "active" gating
      setMarkets(allMkts);
      setSolBalance(lamports == null ? null : lamports / LAMPORTS_PER_SOL);

      // For every market, derive YES and NO ATA balances for the user.
      // Each ATA read is wrapped in `.catch(() => 0)` so a single missing
      // account / RPC failure doesn't poison the rest. RPC providers
      // commonly throttle 100+ concurrent requests; a chunked fan-out
      // could go further but for <100 markets this is fine.
      const programId = PROGRAM_IDS.predictionMarket;
      const balances = await Promise.all(
        allMkts.flatMap((m) => {
          const marketPk = new PublicKey(m.address);
          const { yesMint, noMint } = deriveMarketPdas(programId, marketPk);
          const yesAta = getAssociatedTokenAddressSync(yesMint, publicKey);
          const noAta = getAssociatedTokenAddressSync(noMint, publicKey);
          return [
            readSplBalance(connection, yesAta)
              .catch(() => 0)
              .then((b) => ({ m, side: "yes" as const, shares: b })),
            readSplBalance(connection, noAta)
              .catch(() => 0)
              .then((b) => ({ m, side: "no" as const, shares: b })),
          ];
        }),
      );

      const live = balances
        .filter((x) => x.shares > 0)
        .map<Position>((x) => ({
          market: x.m,
          side: x.side,
          shares: x.shares,
          state: positionState(x.m, slot),
        }));
      setPositions(live);

      // Surface only top-level failures the user can act on; silent ATA
      // misses are normal (most users only hold a handful of positions).
      if (lamportsRes.status === "rejected") {
        setErr(
          "RPC unavailable , your bUSD balance couldn't load. Refresh in a moment.",
        );
      }
    } catch (e) {
      console.error("[portfolio] load error", e);
      setErr(
        e instanceof Error
          ? `Couldn't load portfolio: ${e.message}. The devnet RPC may be rate-limiting; refresh in a moment.`
          : "Couldn't load portfolio , refresh in a moment.",
      );
    } finally {
      setLoading(false);
    }
  }, [publicKey, connected, connection]);

  useEffect(() => {
    load();
  }, [load]);

  // Pending registrations live in Postgres, not on-chain , fetched
  // separately from the markets/positions load so a transient backend
  // hiccup doesn't break the rest of the page.
  useEffect(() => {
    if (!publicKey || !connected) {
      setPendingAgents([]);
      return;
    }
    let cancelled = false;
    fetchPendingAgents(publicKey.toBase58()).then((rows) => {
      if (!cancelled) setPendingAgents(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey, connected]);

  const { open, pending, resolved } = useMemo(() => {
    const open: Position[] = [];
    const pending: Position[] = [];
    const resolved: Position[] = [];
    for (const p of positions) {
      if (p.state === "open") open.push(p);
      else if (p.state === "pending") pending.push(p);
      else resolved.push(p);
    }
    return { open, pending, resolved };
  }, [positions]);

  if (!connected) {
    return (
      <main style={{ background: "var(--bg-0)", minHeight: "100vh", padding: "0 16px 32px" }}>
        <PageHeader />
        <div className="card" style={{ padding: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <p className="muted" style={{ fontSize: 13, textAlign: "center" }}>
            Connect your wallet to view your YES / NO positions.
          </p>
          <WalletMultiButton
            style={{
              background: "var(--purple-tint)",
              border: "1px solid rgba(167,139,250,0.3)",
              borderRadius: "8px",
              color: "var(--purple)",
              fontSize: "13px",
              fontFamily: "var(--font-mono)",
              height: "42px",
              padding: "0 20px",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main style={{ background: "var(--bg-0)", minHeight: "100vh", padding: "0 16px 32px" }}>
      <PageHeader />

      {/* Wallet summary */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(1, 1fr)", gap: 8, marginBottom: 24 }}>
        <div className="card" style={{ padding: "10px 14px" }}>
          <div className="bd-eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>Connected</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--fg-2)", wordBreak: "break-all" }}>
            {publicKey?.toBase58().slice(0, 8)}…{publicKey?.toBase58().slice(-4)}
          </div>
        </div>
        <div className="card" style={{ padding: "10px 14px" }}>
          <div className="bd-eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>SOL balance</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: "var(--gold)" }}>
            {solBalance == null ? "-" : `${solBalance.toFixed(4)} SOL`}
          </div>
        </div>
        <div className="card" style={{ padding: "10px 14px" }}>
          <div className="bd-eyebrow" style={{ fontSize: 9, marginBottom: 4 }}>Markets scanned</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: "var(--fg-0)" }}>
            {markets.length}
          </div>
        </div>
      </section>

      {err && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--red-tint)", border: "1px solid rgba(239,68,68,0.24)", color: "var(--red-2)", fontSize: 11, marginBottom: 16 }}>
          {err}
        </div>
      )}

      <PendingAgentsSection agents={pendingAgents} />


      {loading && positions.length === 0 && <LoadingSkeleton />}

      {!loading && positions.length === 0 && (
        <div className="card hairline" style={{ padding: 32, textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--fg-0)", letterSpacing: "-0.015em", marginBottom: 6 }}>
            No positions yet.
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Head over to{" "}
            <Link href="/markets" style={{ color: "var(--gold)", textDecoration: "underline" }}>
              /markets
            </Link>{" "}
            and pick a side.
          </div>
        </div>
      )}

      <PositionSection
        title="Open positions"
        tint="success"
        subtitle="Markets still accepting bets"
        positions={open}
      />
      <PositionSection
        title="Pending resolution"
        tint="amber"
        subtitle="Resolution slot reached , awaiting on-chain resolver"
        positions={pending}
      />
      <PositionSection
        title="Resolved"
        tint="purple"
        subtitle="Redeem winning shares below"
        positions={resolved}
      />
    </main>
  );
}

function PageHeader() {
  return (
    <div style={{ padding: "20px 0 16px" }}>
      <div className="bd-eyebrow" style={{ marginBottom: 8 }}>Portfolio</div>
      <div className="section-title">
        My <em>bets.</em>
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
        Every YES / NO position you hold across Bundie prediction markets.
      </div>
    </div>
  );
}

function PositionSection({
  title,
  subtitle,
  tint,
  positions,
}: {
  title: string;
  subtitle: string;
  tint: "success" | "amber" | "purple";
  positions: Position[];
}) {
  if (positions.length === 0) return null;
  const tintColor =
    tint === "success"
      ? "var(--green-2)"
      : tint === "amber"
        ? "var(--amber)"
        : "var(--purple)";
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <div
          className="mono"
          style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.18em", color: tintColor, fontWeight: 500 }}
        >
          {title} · {positions.length}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{subtitle}</div>
      </div>
      <div className="card-stack">
        {positions.map((p) => (
          <PositionCard key={`${p.market.address}:${p.side}`} position={p} />
        ))}
      </div>
    </section>
  );
}

function PendingAgentsSection({ agents }: { agents: AgentRowFull[] }) {
  if (agents.length === 0) return null;
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            color: "var(--gold)",
            fontWeight: 500,
          }}
        >
          Pending registrations · {agents.length}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          Agents whose vault is on-chain but the $50 seed deposit hasn&rsquo;t cleared.
        </div>
      </div>
      <div className="card-stack">
        {agents.map((a) => (
          <PendingAgentCard key={a.sns} agent={a} />
        ))}
      </div>
    </section>
  );
}

function PendingAgentCard({ agent }: { agent: AgentRowFull }) {
  const seedDollars = Number(agent.seed_amount_busd) / 1_000_000;
  return (
    <div
      className="card hairline"
      style={{
        padding: 14,
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderColor: "var(--gold)",
      }}
    >
      <div style={{ fontSize: 28, lineHeight: 1 }}>{agent.emoji ?? "🤖"}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            color: "var(--fg-0)",
            letterSpacing: "-0.015em",
          }}
        >
          {agent.display_name || agent.sns}
        </div>
        <div className="mono gold" style={{ fontSize: 11 }}>
          {agent.sns}
        </div>
        <div className="muted mono-tiny" style={{ fontSize: 10.5, marginTop: 4 }}>
          ${seedDollars.toFixed(2)} bUSD seed pending · vault {agent.vault_pda.slice(0, 6)}…{agent.vault_pda.slice(-4)}
        </div>
      </div>
      <Link
        href={`/create-agent?resume=${encodeURIComponent(agent.sns)}`}
        style={{
          height: 36,
          padding: "0 14px",
          background: "var(--gold)",
          color: "#fff",
          border: "1px solid var(--gold)",
          borderRadius: 8,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        Resume →
      </Link>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="card-stack">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 80, borderRadius: 12 }}
        />
      ))}
    </div>
  );
}

function positionState(
  m: MarketView,
  currentSlot: number,
): Position["state"] {
  if (m.status === "resolved") return "resolved";
  if (m.resolutionSlot > 0 && currentSlot >= m.resolutionSlot) return "pending";
  return "open";
}

async function readSplBalance(
  connection: ReturnType<typeof useConnection>["connection"],
  ata: PublicKey,
): Promise<number> {
  try {
    // No string commitment , rpcfast rejects it with `expected struct
    // CommitmentConfig`, which would silently zero out every position.
    const info = await connection.getTokenAccountBalance(ata);
    return info.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}
