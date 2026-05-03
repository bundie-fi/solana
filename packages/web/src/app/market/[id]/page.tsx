import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getDevnetConnection } from "@/lib/rpc";
import {
  fetchMarketByAddress,
  fetchAllMarkets,
  fetchBundieVault,
} from "@/lib/markets";
import { fetchAgentDirectory } from "@/lib/registry";
import { PROGRAM_IDS } from "@/lib/constants";
import {
  resolveSns,
  truncatePubkey,
  HERO_AGENTS,
} from "@/lib/sns-resolver";
import { MarketBuyPanel } from "@/components/market-buy-panel";
import { checkAgentQualityGate } from "@/lib/quality-gate";

interface AgentLabel {
  name: string;
  emoji: string;
  sns: string | null;
}

function labelFor(
  pubkey: string,
  dir: Awaited<ReturnType<typeof fetchAgentDirectory>>,
): AgentLabel {
  const fromDir = dir[pubkey];
  if (fromDir) {
    return {
      name: fromDir.displayName,
      emoji: fromDir.emoji ?? "🤖",
      sns: fromDir.sns,
    };
  }
  const legacy = resolveSns(pubkey);
  if (legacy?.devnetName) {
    const emoji =
      HERO_AGENTS.find((a) => a.vault === pubkey)?.emoji ?? "🤖";
    return { name: legacy.devnetName, emoji, sns: legacy.devnetName };
  }
  return { name: truncatePubkey(pubkey), emoji: "🤖", sns: null };
}

/** Convert a slot delta into a friendly "in ~5h" / "in ~2d" string,
 *  using Solana's ~400ms slot time. Handles negative deltas (resolution
 *  in the past = "ready to resolve"). */
function relativeSlotLabel(deltaSlots: number): string {
  if (deltaSlots <= 0) return "ready to resolve";
  const seconds = deltaSlots * 0.4;
  if (seconds < 60) return `in ~${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `in ~${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `in ~${hours.toFixed(1)}h`;
  return `in ~${(hours / 24).toFixed(1)}d`;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarketDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const connection = getDevnetConnection();
  // Critical-path reads only — everything the page needs to render the
  // header, hero, and bet panel. `fetchAllMarkets` (= getProgramAccounts,
  // ~2-3s on devnet) is deliberately NOT in here; it now powers a
  // Suspense-streamed creator-accuracy line further down so the page
  // doesn't block on a single decorative stat.
  const [market, agentDir, currentSlot] = await Promise.all([
    fetchMarketByAddress(connection, params.id),
    fetchAgentDirectory({ cache: "no-store" }),
    connection.getSlot("confirmed").catch(() => 0),
  ]);

  if (!market) notFound();

  const creator = labelFor(market.createdBy, agentDir);
  // Track-record quality gate. Resolved server-side so the buy panel
  // ships with the disabled state pre-baked , no client fetch flicker.
  // Fails open when the creator has no SNS (legacy hero vaults, etc.).
  const qualityGate = await checkAgentQualityGate(creator.sns);
  // For kinds 1 and 3 the predicted vault sits on Market.strategy.
  // Kind 2 (head-to-head) uses both: strategy = agent A, targetAgent = B.
  const targetA = market.strategy
    ? labelFor(market.strategy, agentDir)
    : null;
  const targetB = market.targetAgent
    ? labelFor(market.targetAgent, agentDir)
    : null;

  const totalShares = market.yesShares + market.noShares;
  const yesProbability =
    totalShares > 0 ? market.yesShares / totalShares : 0.5;
  const yesPct = Math.round(yesProbability * 100);
  const noPct = 100 - yesPct;
  const yesPrice = yesProbability;
  const noPrice = 1 - yesProbability;

  // Live bettor signal: pull the predicted vault's CURRENT NAV so the
  // user can see how close the target is to the threshold without
  // having to leave the page. For kind=2 we also fetch B so we can
  // show both NAVs side-by-side.
  const [vaultA, vaultB] = await Promise.all([
    market.strategy
      ? fetchBundieVault(connection, PROGRAM_IDS.predictionMarket, market.strategy).catch(
          () => null,
        )
      : Promise.resolve(null),
    market.kind === 2 && market.targetAgent
      ? fetchBundieVault(
          connection,
          PROGRAM_IDS.predictionMarket,
          market.targetAgent,
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  const navA = vaultA ? Number(vaultA.navLamports) / 1_000_000 : null;
  const navB = vaultB ? Number(vaultB.navLamports) / 1_000_000 : null;
  const initialNavA = Number(market.initialNavA) / 1_000_000;
  const initialNavB = Number(market.initialNavB) / 1_000_000;
  const navAChangePct =
    navA != null && initialNavA > 0
      ? ((navA - initialNavA) / initialNavA) * 100
      : null;
  const navBChangePct =
    navB != null && initialNavB > 0
      ? ((navB - initialNavB) / initialNavB) * 100
      : null;

  const slotsToResolution =
    currentSlot > 0 ? market.resolutionSlot - currentSlot : 0;
  const resolutionTimeLabel = relativeSlotLabel(slotsToResolution);

  // Phase B+ NAV-aware resolution copy. The target is whichever agent's
  // NAV is being measured (Market.strategy for kinds 1/3, both for 2).
  let resolutionProse: string;
  const slotLabel = market.resolutionSlot.toLocaleString();
  const targetAName = targetA?.name ?? "the agent";
  const targetBName = targetB?.name ?? "the other agent";
  if (market.kind === 1) {
    const targetBusd = (market.targetNavLamports ?? 0) / 1_000_000;
    resolutionProse =
      `Resolves YES if ${targetAName}'s vault NAV reaches ` +
      `${targetBusd.toLocaleString(undefined, { maximumFractionDigits: 2 })} bUSD ` +
      `by slot ${slotLabel}.`;
  } else if (market.kind === 2) {
    resolutionProse =
      `Resolves YES if ${targetAName}'s NAV growth beats ` +
      `${targetBName}'s by slot ${slotLabel}.`;
  } else if (market.kind === 3) {
    const pct = ((market.drawdownBps ?? 0) / 100).toFixed(2);
    resolutionProse =
      `Resolves YES if ${targetAName}'s NAV drops by ${pct}% or more ` +
      `by slot ${slotLabel}.`;
  } else {
    resolutionProse =
      market.question || "Resolves via program-native NAV reads.";
  }

  const totalVolumeBusd = (market.totalVolume / 1e6).toFixed(2);

  return (
    <main style={{ background: "var(--bg-0)", minHeight: "100vh" }}>
      {/* Mobile header with back button */}
      <div className="sm:hidden top-header" style={{ paddingLeft: 8 }}>
        <Link
          href="/markets"
          className="btn btn-ghost"
          style={{ padding: "7px 10px", fontSize: 11, gap: 6, textDecoration: "none" }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>‹</span> Markets
        </Link>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="pulse-dot" />
          <span className="mono-tiny" style={{ color: "var(--green-2)" }}>LIVE</span>
        </span>
      </div>

      {/* Desktop back link */}
      <div className="hidden sm:block" style={{ padding: "12px 20px 0" }}>
        <Link
          href="/markets"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            color: "var(--purple)",
            textDecoration: "none",
          }}
        >
          ← All markets
        </Link>
      </div>

      <div className="scroll-area" style={{ overflowY: "auto" }}>
        {/* Question section */}
        <div style={{ padding: "18px 16px 14px" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <span className="pill pill-gold">Strategy market</span>
            <span
              className={`pill ${market.status === "active" ? "pill-green" : "pill-muted"}`}
              style={{ fontSize: 9 }}
            >
              {market.status}
              {market.outcome ? ` · ${market.outcome.toUpperCase()}` : ""}
            </span>
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
              color: "var(--fg-0)",
              margin: 0,
            }}
          >
            {market.question || "-"}
          </h1>
        </div>

        {/* Creator / Target row — clickable into the agent profile so a
            bettor can dive into the agent's recent trades + NAV history
            before placing a bet. */}
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <AgentBadge
              eyebrow="Created by"
              label={creator.name}
              emoji={creator.emoji}
              href={creator.sns ? `/agent/${creator.sns}` : undefined}
              accent="gold"
            />
            {targetA && (
              <AgentBadge
                eyebrow={market.kind === 2 ? "Side A" : "Predicting"}
                label={targetA.name}
                emoji={targetA.emoji}
                href={targetA.sns ? `/agent/${targetA.sns}` : undefined}
                accent="purple"
              />
            )}
            {targetB && (
              <AgentBadge
                eyebrow="Side B"
                label={targetB.name}
                emoji={targetB.emoji}
                href={targetB.sns ? `/agent/${targetB.sns}` : undefined}
                accent="purple"
              />
            )}
          </div>
        </div>

        {/* Probability gauge */}
        <div style={{ padding: "0 16px 18px" }}>
          <ProbabilityGauge
            yesPct={yesPct}
            noPct={noPct}
            yesPrice={yesPrice}
            noPrice={noPrice}
            volume={totalVolumeBusd}
            windowEndSlot={market.windowEndSlot}
            resolutionTimeLabel={resolutionTimeLabel}
          />
        </div>

        {/* Where the target is RIGHT NOW — the most actionable signal
            for a bettor. Shows current NAV vs initial + threshold, plus
            growth %. For kind=2 shows both A and B side-by-side. */}
        {(navA != null || navB != null) && (
          <div style={{ padding: "0 16px 18px" }}>
            <div className="bd-eyebrow" style={{ marginBottom: 10 }}>
              Where they are now
            </div>
            <div className="card" style={{ padding: 14 }}>
              <NavRow
                label={targetA?.name ?? "Target"}
                emoji={targetA?.emoji ?? "🤖"}
                currentBusd={navA}
                initialBusd={initialNavA}
                changePct={navAChangePct}
                thresholdBusd={
                  market.kind === 1 && market.targetNavLamports != null
                    ? market.targetNavLamports / 1_000_000
                    : null
                }
              />
              {targetB && (
                <>
                  <div style={{ height: 1, background: "var(--line-1)", margin: "10px 0" }} />
                  <NavRow
                    label={targetB.name}
                    emoji={targetB.emoji}
                    currentBusd={navB}
                    initialBusd={initialNavB}
                    changePct={navBChangePct}
                    thresholdBusd={null}
                  />
                </>
              )}
            </div>
            <p
              className="muted"
              style={{ fontSize: 11, marginTop: 8, lineHeight: 1.4 }}
            >
              NAV is committed on-chain by the agent every tick. Resolution
              reads the same number the program saw at the resolution slot.
            </p>
          </div>
        )}

        {/* Resolution method */}
        <div style={{ padding: "0 16px 18px" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span className="pill pill-green" style={{ fontSize: 9 }}>
              <span style={{ fontSize: 11, lineHeight: 1 }}>✓</span> NAV-resolved
            </span>
            <span className="pill pill-muted" style={{ fontSize: 9 }}>
              Resolves {resolutionTimeLabel}
            </span>
          </div>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--fg-1)",
              margin: "0 0 8px 0",
            }}
          >
            {resolutionProse}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span className="green" style={{ fontSize: 11 }}>✓</span>
            <span className="muted" style={{ lineHeight: 1.4 }}>
              Insider-trading protection: the on-chain program rejects any
              market a creator tries to open against their own vault.
            </span>
          </div>
          <Suspense fallback={null}>
            <CreatorAccuracyLine
              createdBy={market.createdBy}
              creatorName={creator.name}
            />
          </Suspense>
        </div>

        {/* Bet panel */}
        <div style={{ padding: "0 16px 18px" }}>
          <MarketBuyPanel
            market={market}
            yesProbability={yesProbability}
            qualityGate={qualityGate}
          />
        </div>

        {/* Resolution data */}
        <div style={{ padding: "0 16px 18px" }}>
          <div className="bd-eyebrow" style={{ marginBottom: 10 }}>Resolution data</div>
          <div className="card inset" style={{ padding: 14 }}>
            <DataRow
              label="Resolves"
              value={`${resolutionTimeLabel} (slot ${market.resolutionSlot.toLocaleString()})`}
            />
            {market.windowEndSlot != null && (
              <DataRow label="Window end" value={market.windowEndSlot.toLocaleString()} />
            )}
            <DataRow label="Fee" value={`${(market.feeBps / 100).toFixed(2)}%`} />
            <DataRow label="Volume" value={`${totalVolumeBusd} bUSD`} />
            <DataRow
              label="Market PDA"
              value={
                <a
                  href={`https://orbmarkets.io/address/${market.address}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--gold)", textDecoration: "underline", fontFamily: "var(--font-mono)", fontSize: 10, wordBreak: "break-all" }}
                >
                  {market.address.slice(0, 12)}…{market.address.slice(-8)}
                </a>
              }
              last
            />
          </div>
        </div>

        {/* Footer breadcrumb */}
        <div style={{ padding: "0 16px 32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="pill pill-blue" style={{ padding: "2px 7px", fontSize: 9 }}>devnet</span>
            <span className="dim mono-tiny">·</span>
            <span className="dim mono-tiny" style={{ fontSize: 9 }}>
              market {market.address.slice(0, 6)}…
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}

function AgentBadge({
  eyebrow,
  label,
  emoji,
  href,
  accent,
}: {
  eyebrow: string;
  label: string;
  emoji: string;
  href?: string;
  accent: "gold" | "purple";
}) {
  const inner = (
    <div
      className="card hairline"
      style={{
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flex: 1,
        minWidth: 0,
        textDecoration: "none",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "var(--bg-3)",
          border: "1px solid var(--line-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {emoji}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
        <span className="bd-eyebrow" style={{ fontSize: 8.5 }}>{eyebrow}</span>
        <span
          className={`mono ${accent}`}
          style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {label}
        </span>
      </div>
    </div>
  );
  if (href) {
    return (
      <Link href={href} style={{ flex: 1, minWidth: 0, textDecoration: "none" }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

function NavRow({
  label,
  emoji,
  currentBusd,
  initialBusd,
  changePct,
  thresholdBusd,
}: {
  label: string;
  emoji: string;
  currentBusd: number | null;
  initialBusd: number;
  changePct: number | null;
  thresholdBusd: number | null;
}) {
  const fmt = (n: number) =>
    `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const distanceToThreshold =
    thresholdBusd != null && currentBusd != null
      ? thresholdBusd - currentBusd
      : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{emoji}</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--fg-0)", fontWeight: 600 }}>
          {label}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="bd-eyebrow" style={{ fontSize: 8.5 }}>Current NAV</span>
          <span className="mono" style={{ fontSize: 18, color: "var(--fg-0)", fontWeight: 600 }}>
            {currentBusd != null ? fmt(currentBusd) : "—"} bUSD
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
          <span className="bd-eyebrow" style={{ fontSize: 8.5 }}>Since market open</span>
          <span
            className="mono"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color:
                changePct == null
                  ? "var(--fg-2)"
                  : changePct >= 0
                    ? "var(--green-2)"
                    : "var(--red-2)",
            }}
          >
            {changePct == null
              ? "—"
              : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
          </span>
        </div>
      </div>
      {thresholdBusd != null && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-2)",
            background: "var(--bg-2)",
            padding: "6px 10px",
            borderRadius: 6,
          }}
        >
          Threshold: {fmt(thresholdBusd)} bUSD
          {distanceToThreshold != null && (
            <span style={{ color: distanceToThreshold <= 0 ? "var(--green-2)" : "var(--fg-1)", marginLeft: 6 }}>
              ({distanceToThreshold <= 0
                ? `already past by ${fmt(Math.abs(distanceToThreshold))}`
                : `${fmt(distanceToThreshold)} to go`})
            </span>
          )}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }}>
        <span className="muted">Opened at</span>
        <span className="mono dim">{fmt(initialBusd)} bUSD</span>
      </div>
    </div>
  );
}

function ProbabilityGauge({
  yesPct,
  noPct,
  yesPrice,
  noPrice,
  volume,
  windowEndSlot,
  resolutionTimeLabel,
}: {
  yesPct: number;
  noPct: number;
  yesPrice: number;
  noPrice: number;
  volume: string;
  windowEndSlot?: number | null;
  resolutionTimeLabel?: string;
}) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 14,
          alignItems: "baseline",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="bd-eyebrow" style={{ fontSize: 9 }}>YES</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 600, color: "var(--green-2)" }}>
            {yesPct}<span style={{ fontSize: 14, fontWeight: 400 }}>%</span>
          </span>
          <span className="mono-tiny dim">◎ {yesPrice.toFixed(2)} / share</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
          <span className="bd-eyebrow" style={{ fontSize: 9 }}>NO</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 600, color: "var(--red-2)" }}>
            {noPct}<span style={{ fontSize: 14, fontWeight: 400 }}>%</span>
          </span>
          <span className="mono-tiny dim">◎ {noPrice.toFixed(2)} / share</span>
        </div>
      </div>

      {/* Inline prob bar */}
      <div className="probbar" style={{ height: 10 }}>
        <div className="yes" style={{ width: `${yesPct}%` }} />
        <div className="hairline" />
        <div className="no" style={{ width: `${noPct}%` }} />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 14,
          fontSize: 11.5,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <span className="muted mono-tiny">Volume</span>
          <span className="hl mono" style={{ fontSize: 11 }}>{volume} bUSD</span>
        </div>
        {resolutionTimeLabel ? (
          <div style={{ display: "flex", gap: 8 }}>
            <span className="muted mono-tiny">Resolves</span>
            <span className="hl mono" style={{ fontSize: 11 }}>
              {resolutionTimeLabel}
            </span>
          </div>
        ) : windowEndSlot != null ? (
          <div style={{ display: "flex", gap: 8 }}>
            <span className="muted mono-tiny">Window end</span>
            <span className="hl mono" style={{ fontSize: 11 }}>
              slot {windowEndSlot.toLocaleString()}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DataRow({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "7px 0",
        borderBottom: last ? "none" : "1px solid var(--line-1)",
      }}
    >
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
      <span className="mono hl" style={{ fontSize: 12, fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>
        {value}
      </span>
    </div>
  );
}

// Streamed via <Suspense> from the page render. Keeping this server-side
// avoids exposing the full markets list to the client; keeping it OUT of
// the parent's Promise.all means the page header / hero / bet panel render
// in ~1 RPC roundtrip instead of waiting on a getProgramAccounts scan.
async function CreatorAccuracyLine({
  createdBy,
  creatorName,
}: {
  createdBy: string;
  creatorName: string;
}) {
  const connection = getDevnetConnection();
  const all = await fetchAllMarkets(connection);
  const resolved = all.filter(
    (m) => m.createdBy === createdBy && m.status === "resolved",
  );
  if (resolved.length === 0) return null;
  const accuracy = Math.round(
    (resolved.filter((m) => m.outcome === "no").length / resolved.length) * 100,
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, marginTop: 6 }}>
      <span className="muted" style={{ lineHeight: 1.4 }}>
        {creatorName} has resolved {resolved.length} markets with NO winning{" "}
        {accuracy}% of the time.
      </span>
    </div>
  );
}
