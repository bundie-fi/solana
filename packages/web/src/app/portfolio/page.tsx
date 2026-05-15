"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  deriveMarketPdas,
  fetchAllMarkets,
  type MarketView,
} from "@/lib/markets";
import { PROGRAM_IDS } from "@/lib/constants";
import { PositionCard, type Position } from "@/components/position-card";

/**
 * My Bets, shows the connected wallet's YES/NO positions across every
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
  // Captured from the load() pass and surfaced in the page header as
  // the issue's "publish slot", the editorial date stamp.
  const [currentSlot, setCurrentSlot] = useState<number | null>(null);

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
        // Drop string commitment, rpcfast rejects positional `"confirmed"`
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
      if (slotRes.status === "fulfilled") setCurrentSlot(slot);

      // Position discovery: previously fanned out 2 ATA reads per market
      // (134 RPC calls for 67 markets), which crushed rpcfast's per-key
      // throttle and made the page take 10-30s to load. Replaced with
      // ONE getParsedTokenAccountsByOwner call to enumerate every SPL
      // token the user holds, then a local mint→market lookup.
      // Net: 1 RPC read instead of N×2.
      const programId = PROGRAM_IDS.predictionMarket;
      const mintIndex = new Map<string, { m: MarketView; side: "yes" | "no" }>();
      for (const m of allMkts) {
        const { yesMint, noMint } = deriveMarketPdas(
          programId,
          new PublicKey(m.address),
        );
        mintIndex.set(yesMint.toBase58(), { m, side: "yes" });
        mintIndex.set(noMint.toBase58(), { m, side: "no" });
      }

      let userTokens: Awaited<
        ReturnType<typeof connection.getParsedTokenAccountsByOwner>
      >;
      try {
        userTokens = await connection.getParsedTokenAccountsByOwner(
          publicKey,
          { programId: TOKEN_PROGRAM_ID },
        );
      } catch (e) {
        console.error("[portfolio] getParsedTokenAccountsByOwner failed", e);
        userTokens = { context: { slot: 0 }, value: [] };
      }

      const live: Position[] = [];
      for (const acc of userTokens.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info = (acc.account.data as any).parsed?.info;
        if (!info) continue;
        const mint: string = info.mint;
        const shares = Number(info.tokenAmount?.uiAmount ?? 0);
        if (shares <= 0) continue;
        const hit = mintIndex.get(mint);
        if (!hit) continue;
        live.push({
          market: hit.m,
          side: hit.side,
          shares,
          state: positionState(hit.m, slot),
        });
      }
      setPositions(live);

      // Surface only top-level failures the user can act on; silent ATA
      // misses are normal (most users only hold a handful of positions).
      if (lamportsRes.status === "rejected") {
        setErr(
          "RPC unavailable, your bUSD balance couldn't load. Refresh in a moment.",
        );
      }
    } catch (e) {
      console.error("[portfolio] load error", e);
      setErr(
        e instanceof Error
          ? `Couldn't load portfolio: ${e.message}. The devnet RPC may be rate-limiting; refresh in a moment.`
          : "Couldn't load portfolio, refresh in a moment.",
      );
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
      <main className="po-page">
        <div className="po-container">
          <PortfolioHeader slot={null} address={null} />
          <div className="po-connect-prompt">
            <div className="po-card" style={{ maxWidth: 460 }}>
              <div className="po-card-eyebrow">No wallet</div>
              <p style={{ margin: "4px 0 16px", fontSize: 13.5, color: "var(--de-ink-2)", lineHeight: 1.55 }}>
                Connect a Solana wallet to publish your portfolio. Bundie reads
                balances directly from devnet, nothing leaves your device.
              </p>
              <WalletMultiButton
                style={{
                  background: "var(--de-lavender)",
                  border: "1px solid var(--de-line-2)",
                  borderRadius: "999px",
                  color: "var(--de-bg)",
                  fontSize: "12px",
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  height: "40px",
                  padding: "0 22px",
                }}
              />
            </div>
          </div>
        </div>
        <PortfolioStyles />
      </main>
    );
  }

  const isEmpty = !loading && positions.length === 0;

  return (
    <main className="po-page">
      <div className="po-container">
        <PortfolioHeader
          slot={currentSlot}
          address={publicKey?.toBase58() ?? null}
        />

        <BalanceStrip
          sol={solBalance}
          openCount={open.length}
          pendingCount={pending.length}
          resolvedCount={resolved.length}
          marketsScanned={markets.length}
        />

        {err && <div className="po-error">{err}</div>}

        <div className="po-spread">
          <div className="po-main">
            {loading && positions.length === 0 && <LoadingSkeleton />}

            {isEmpty ? (
              <QuickstartChecklist
                hasSol={(solBalance ?? 0) > 0}
                hasBet={positions.length > 0}
              />
            ) : (
              <>
                <PositionSection
                  title="Open positions"
                  tint="success"
                  subtitle="Markets still accepting bets"
                  positions={open}
                />
                <PositionSection
                  title="Pending resolution"
                  tint="amber"
                  subtitle="Resolution slot reached, awaiting on-chain resolver"
                  positions={pending}
                />
                <PositionSection
                  title="Resolved"
                  tint="purple"
                  subtitle="Redeem winning shares below"
                  positions={resolved}
                />
              </>
            )}
          </div>

          <aside className="po-aside">
            <IdentityCard
              address={publicKey?.toBase58() ?? null}
              sol={solBalance}
            />
          </aside>
        </div>
      </div>

      <PortfolioStyles />
    </main>
  );
}

// ─── Editorial header ────────────────────────────────────────────────────
// "Issue" feel: top eyebrow with a publish-slot stamp, then the headline,
// then a short lede. Matches the discover page's left-aligned hierarchy.
function PortfolioHeader({
  slot,
  address,
}: {
  slot: number | null;
  address: string | null;
}) {
  const slotStr = slot != null ? slot.toLocaleString("en-US") : "·";
  const truncated = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : null;
  return (
    <header className="po-header">
      <div className="po-eyebrow">
        <span>Your portfolio</span>
        <span className="po-eyebrow-sep">·</span>
        <span>Devnet</span>
        <span className="po-eyebrow-sep">·</span>
        <span>Slot {slotStr}</span>
        {truncated ? (
          <>
            <span className="po-eyebrow-sep">·</span>
            <span className="po-mono">{truncated}</span>
          </>
        ) : null}
      </div>
      <h1 className="po-headline">
        My <em>bets.</em>
      </h1>
    </header>
  );
}

// ─── Balance strip ───────────────────────────────────────────────────────
// Horizontal stat row mirroring the discover page's PlatformStatsStrip.
// Replaces the previous vertical-stack of three small cards which left
// the page empty on desktop.
function BalanceStrip({
  sol,
  openCount,
  pendingCount,
  resolvedCount,
  marketsScanned,
}: {
  sol: number | null;
  openCount: number;
  pendingCount: number;
  resolvedCount: number;
  marketsScanned: number;
}) {
  return (
    <div className="po-stats">
      <Stat label="SOL balance" value={sol == null ? "," : sol.toFixed(4)} accent />
      <Stat label="Open" value={String(openCount)} />
      <Stat label="Pending" value={String(pendingCount)} />
      <Stat label="Resolved" value={String(resolvedCount)} />
      <Stat label="Markets scanned" value={String(marketsScanned)} />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="po-stat">
      <div className="po-stat-label">{label}</div>
      <div className={`po-stat-value${accent ? " po-stat-value-accent" : ""}`}>
        {value}
      </div>
    </div>
  );
}

// ─── Identity card (right rail) ──────────────────────────────────────────
function IdentityCard({
  address,
  sol,
}: {
  address: string | null;
  sol: number | null;
}) {
  if (!address) return null;
  return (
    <div className="po-card">
      <div className="po-card-eyebrow">Identity</div>
      <div className="po-identity-row">
        <span className="po-identity-label">Wallet</span>
        <span className="po-identity-value po-mono">
          {address.slice(0, 4)}…{address.slice(-4)}
        </span>
      </div>
      <div className="po-identity-row">
        <span className="po-identity-label">SOL</span>
        <span className="po-identity-value">
          {sol == null ? "," : `${sol.toFixed(4)} SOL`}
        </span>
      </div>
      <div className="po-identity-row">
        <span className="po-identity-label">Cluster</span>
        <span className="po-identity-value">Devnet</span>
      </div>
    </div>
  );
}

// ─── Quickstart checklist (replaces "No positions yet") ──────────────────
// Empty state becomes a guided onboarding. Each row is a CTA. Items
// fade to ✓ as their underlying condition becomes true (sol funded,
// first bet placed, agent launched).
function QuickstartChecklist({
  hasSol,
  hasBet,
}: {
  hasSol: boolean;
  hasBet: boolean;
}) {
  const steps: Array<{
    label: string;
    detail: string;
    href: string;
    cta: string;
    done: boolean;
  }> = [
    {
      label: "Claim 100 bUSD from the faucet",
      detail: "One-time devnet test currency. You'll need it before placing a bet.",
      href: "/",
      cta: "Open faucet",
      // The faucet claims SOL alongside bUSD; treat any SOL balance as
      // "step done" since it's the most reliable proxy in client state.
      done: hasSol,
    },
    {
      label: "Place your first bet on a market",
      detail: "Pick a side on any open event market. LS-LMSR pool, no spread.",
      href: "/markets",
      cta: "Browse markets",
      done: hasBet,
    },
    {
      label: "Watch resolution land on-chain",
      detail: "When the trigger condition fires, the market self-resolves from a signed feed and your position settles automatically.",
      href: "/markets",
      cta: "View open markets",
      done: false,
    },
  ];
  return (
    <section className="po-quickstart" aria-label="Get started with Bundie">
      <div className="po-section-head">
        <div className="po-section-eyebrow">Get started</div>
        <h2 className="po-section-title">
          Four moves to <em>your first bet.</em>
        </h2>
        <p className="po-section-sub">
          Your portfolio publishes its first issue once you place a bet. Until
          then, here&apos;s what to do next.
        </p>
      </div>

      <ol className="po-checklist">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className={`po-checklist-row${s.done ? " po-checklist-row-done" : ""}`}
          >
            <span className="po-checklist-num">
              {s.done ? "✓" : String(i + 1).padStart(2, "0")}
            </span>
            <div className="po-checklist-body">
              <div className="po-checklist-label">{s.label}</div>
              <div className="po-checklist-detail">{s.detail}</div>
            </div>
            {!s.done && (
              <Link href={s.href} className="po-checklist-cta">
                {s.cta} →
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
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
      ? "var(--de-mint)"
      : tint === "amber"
        ? "var(--amber)"
        : "var(--de-lavender)";
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
    // No string commitment, rpcfast rejects it with `expected struct
    // CommitmentConfig`, which would silently zero out every position.
    const info = await connection.getTokenAccountBalance(ata);
    return info.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

// ─── Page-scoped styles ─────────────────────────────────────────────────
// Inline <style> matches the discover page's pattern so the portfolio
// route ships its own grid logic without leaking class names into other
// routes. Editorial tokens (--de-*) are inherited from globals.
function PortfolioStyles() {
  return (
    <style>{`
      .po-page {
        background: var(--de-bg);
        min-height: 100vh;
        padding-bottom: 96px;
        color: var(--de-ink);
      }
      .po-container {
        max-width: 1280px;
        margin: 0 auto;
        padding: 32px 24px 0;
      }

      /* ── Header ────────────────────────────────────────────────────── */
      .po-header { padding-top: 8px; }
      .po-eyebrow {
        font-family: var(--font-sans);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--de-ink-3);
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .po-eyebrow-sep { color: var(--de-ink-5); font-weight: 400; }
      .po-mono {
        font-family: var(--font-sans);
        font-variant-numeric: tabular-nums;
        text-transform: none;
        letter-spacing: 0.04em;
      }
      .po-headline {
        margin: 14px 0 0;
        font-family: var(--font-display);
        font-weight: 400;
        font-size: clamp(40px, 6vw, 60px);
        letter-spacing: -0.02em;
        line-height: 1.05;
        color: var(--de-ink);
      }
      .po-headline em {
        font-style: italic;
        color: var(--de-lavender-2);
        font-weight: 400;
      }

      /* ── Stats strip ───────────────────────────────────────────────── */
      .po-stats {
        margin-top: 28px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1px;
        background: var(--de-line);
        border-top: 1px solid var(--de-line);
        border-bottom: 1px solid var(--de-line);
      }
      @media (min-width: 720px) {
        .po-stats { grid-template-columns: repeat(5, minmax(0, 1fr)); }
      }
      .po-stat {
        background: var(--de-bg);
        padding: 18px 18px 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .po-stat-label {
        font-family: var(--font-sans);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--de-ink-4);
      }
      .po-stat-value {
        font-family: var(--font-sans);
        font-weight: 700;
        font-size: 22px;
        letter-spacing: -0.01em;
        color: var(--de-ink);
        font-variant-numeric: tabular-nums;
      }
      .po-stat-value-accent { color: var(--de-mint, var(--de-lavender)); }

      /* ── Error banner ─────────────────────────────────────────────── */
      .po-error {
        margin-top: 16px;
        padding: 12px 16px;
        border: 1px solid rgba(239, 68, 68, 0.32);
        border-radius: 6px;
        background: rgba(239, 68, 68, 0.06);
        color: rgb(252, 165, 165);
        font-size: 12.5px;
      }

      /* ── Two-column spread ────────────────────────────────────────── */
      .po-spread {
        margin-top: 40px;
        display: grid;
        grid-template-columns: 1fr;
        gap: 24px;
      }
      @media (min-width: 1024px) {
        .po-spread {
          grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
          gap: 40px;
        }
      }
      .po-main { min-width: 0; }
      .po-aside {
        display: flex;
        flex-direction: column;
        gap: 20px;
        min-width: 0;
      }

      /* ── Card (right rail) ────────────────────────────────────────── */
      .po-card {
        padding: 20px 22px;
        border: 1px solid var(--de-line);
        background: var(--de-bg-raised);
        border-radius: 10px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .po-card-eyebrow {
        font-family: var(--font-sans);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--de-ink-4);
        margin-bottom: 4px;
      }
      .po-identity-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--de-line);
        gap: 12px;
      }
      .po-identity-row:last-child {
        border-bottom: 0;
        padding-bottom: 0;
      }
      .po-identity-label {
        font-family: var(--font-sans);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--de-ink-4);
      }
      .po-identity-value {
        font-family: var(--font-sans);
        font-size: 13.5px;
        color: var(--de-ink);
        font-variant-numeric: tabular-nums;
      }

      /* ── Disconnected prompt ──────────────────────────────────────── */
      .po-connect-prompt {
        margin-top: 56px;
      }

      /* ── Quickstart checklist (empty state) ───────────────────────── */
      .po-quickstart {
        padding: 4px 0 0;
      }
      .po-section-head { margin-bottom: 28px; }
      .po-section-eyebrow {
        font-family: var(--font-sans);
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--de-ink-4);
      }
      .po-section-title {
        margin: 12px 0 0;
        font-family: var(--font-display);
        font-weight: 400;
        font-size: clamp(26px, 3.4vw, 36px);
        letter-spacing: -0.015em;
        line-height: 1.15;
        color: var(--de-ink);
      }
      .po-section-title em {
        font-style: italic;
        color: var(--de-lavender-2);
        font-weight: 400;
      }
      .po-section-sub {
        margin: 12px 0 0;
        font-family: var(--font-sans);
        font-size: 14px;
        line-height: 1.55;
        color: var(--de-ink-3);
        max-width: 56ch;
      }

      .po-checklist {
        list-style: none;
        margin: 0;
        padding: 0;
        border-top: 1px solid var(--de-line);
      }
      .po-checklist-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 18px;
        padding: 22px 4px 22px 4px;
        border-bottom: 1px solid var(--de-line);
      }
      .po-checklist-num {
        font-family: var(--font-display);
        font-style: italic;
        font-weight: 400;
        font-size: 22px;
        color: var(--de-ink-4);
        font-variant-numeric: tabular-nums;
        min-width: 36px;
      }
      .po-checklist-row-done .po-checklist-num {
        font-style: normal;
        color: var(--de-mint, var(--de-lavender));
      }
      .po-checklist-body { min-width: 0; }
      .po-checklist-label {
        font-family: var(--font-sans);
        font-size: 16px;
        font-weight: 600;
        color: var(--de-ink);
        letter-spacing: -0.005em;
      }
      .po-checklist-row-done .po-checklist-label {
        color: var(--de-ink-3);
        text-decoration: line-through;
        text-decoration-color: var(--de-line-2);
      }
      .po-checklist-detail {
        margin-top: 4px;
        font-size: 12.5px;
        color: var(--de-ink-3);
        line-height: 1.5;
      }
      .po-checklist-cta {
        font-family: var(--font-sans);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--de-lavender-2);
        text-decoration: none;
        white-space: nowrap;
        padding: 8px 14px;
        border: 1px solid var(--de-line-2);
        border-radius: 999px;
        transition: border-color 200ms, color 200ms;
      }
      .po-checklist-cta:hover {
        border-color: var(--de-lavender-2);
        color: var(--de-ink);
      }
    `}</style>
  );
}
