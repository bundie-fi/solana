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

/**
 * My Bets — shows the connected wallet's YES/NO positions across every
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

  const load = useCallback(async () => {
    if (!publicKey || !connected) {
      setPositions([]);
      setMarkets([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const [allMkts, lamports, slot] = await Promise.all([
        fetchAllMarkets(connection),
        connection.getBalance(publicKey, "confirmed"),
        connection.getSlot("confirmed"),
      ]);
      setMarkets(allMkts);
      setSolBalance(lamports / LAMPORTS_PER_SOL);

      // For every market, derive YES and NO ATA balances for the user.
      const programId = PROGRAM_IDS.predictionMarket;
      const balances = await Promise.all(
        allMkts.flatMap((m) => {
          const marketPk = new PublicKey(m.address);
          const { yesMint, noMint } = deriveMarketPdas(programId, marketPk);
          const yesAta = getAssociatedTokenAddressSync(yesMint, publicKey);
          const noAta = getAssociatedTokenAddressSync(noMint, publicKey);
          return [
            readSplBalance(connection, yesAta).then((b) => ({
              m,
              side: "yes" as const,
              shares: b,
            })),
            readSplBalance(connection, noAta).then((b) => ({
              m,
              side: "no" as const,
              shares: b,
            })),
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
    } catch (e) {
      console.error("[portfolio] load error", e);
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [publicKey, connected, connection]);

  useEffect(() => {
    load();
  }, [load]);

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
      <main className="mx-auto w-full max-w-content px-4 py-8 pb-safe">
        <PageHeader />
        <div className="rounded-xl border border-neutral-300 bg-surface p-10 flex flex-col items-center gap-4">
          <p className="text-neutral-700 text-sm text-center">
            Connect your wallet to view your YES / NO positions.
          </p>
          <WalletMultiButton
            style={{
              background: "rgba(109,40,217,0.18)",
              border: "1px solid rgba(109,40,217,0.4)",
              borderRadius: "10px",
              color: "#b691f1",
              fontSize: "14px",
              height: "42px",
              padding: "0 20px",
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-content px-4 py-8 pb-safe">
      <PageHeader />

      {/* Wallet summary */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <div className="rounded-xl border border-neutral-300 bg-surface p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600">
            Connected
          </div>
          <div className="font-mono text-xs text-neutral-800 mt-1 break-all">
            {publicKey?.toBase58().slice(0, 6)}…
            {publicKey?.toBase58().slice(-4)}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-300 bg-surface p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600">
            SOL balance
          </div>
          <div className="font-serif text-2xl text-neutral-900 nums mt-1">
            {solBalance == null
              ? "—"
              : `${solBalance.toFixed(4)} SOL`}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-300 bg-surface p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-600">
            Markets scanned
          </div>
          <div className="font-serif text-2xl text-neutral-900 nums mt-1">
            {markets.length}
          </div>
        </div>
      </section>

      {err && (
        <div className="rounded-lg border border-danger-400/40 bg-danger-400/10 p-3 text-xs text-danger-400 mb-4">
          {err}
        </div>
      )}

      {loading && positions.length === 0 && <LoadingSkeleton />}

      {!loading && positions.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-surface p-10 text-center">
          <p className="font-serif text-[18px] text-neutral-900 mb-1">
            No positions yet.
          </p>
          <p className="text-xs text-neutral-600">
            Head over to <Link href="/markets" className="underline text-amber-400">/markets</Link> and
            pick a side.
          </p>
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
        subtitle="Resolution slot reached — awaiting on-chain resolver"
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
    <div className="mb-6">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-purple-300">
        Portfolio
      </span>
      <h1 className="font-serif text-display text-neutral-900 mt-1 leading-tight">
        My <em className="text-amber-400">bets</em>.
      </h1>
      <p className="text-neutral-700 mt-2 max-w-2xl">
        Every YES / NO position you hold across Bundie prediction markets.
      </p>
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
  const tintClass =
    tint === "success"
      ? "text-success-400"
      : tint === "amber"
        ? "text-amber-400"
        : "text-purple-300";
  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2
          className={`font-mono text-[11px] uppercase tracking-[0.18em] ${tintClass}`}
        >
          {title} · {positions.length}
        </h2>
        <p className="text-xs text-neutral-600">{subtitle}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {positions.map((p) => (
          <PositionCard key={`${p.market.address}:${p.side}`} position={p} />
        ))}
      </ul>
    </section>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 rounded-xl border border-neutral-300 bg-surface animate-pulse"
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
    const info = await connection.getTokenAccountBalance(ata, "confirmed");
    return info.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}
