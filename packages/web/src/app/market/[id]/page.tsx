/**
 * Market detail page — dark editorial rebuild.
 *
 * Two-column layout (XO Market style):
 *   - Left  (~65%): header strip, big NAV chart with resolution threshold,
 *     rules & resolution panel, agent insight, discussion thread.
 *   - Right (~35%): sticky trading panel that owns the buy flow end-to-end.
 *
 * All visual chrome is driven by `--de-*` tokens via the components in
 * `components/de/`. Server component; the on-chain bet flow stays inside
 * the legacy `<MarketBuyPanel>`, wrapped by `<TradingPanel>` so the tx
 * submission path is unchanged.
 */
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
import { resolveSns, truncatePubkey } from "@/lib/sns-resolver";
import { fetchAgentPnl, microsToUsd } from "@/lib/pnl";
import { AgentInsight } from "@/components/agent-insight";
import { checkAgentQualityGate } from "@/lib/quality-gate";
import {
  AgentCardCompact,
  DiscussionThread,
  NavChartWithThreshold,
  RulesAndResolution,
  StatusPill,
  TradingPanel,
  hashSeed,
} from "@/components/de";

interface AgentLabel {
  name: string;
  sns: string | null;
}

// Avatars in the dark editorial system come from monogram tiles
// derived from the SNS handle, never emoji. The emoji field that
// previously rode along with this shape was dead weight in this
// surface — `SnsName` and `AgentCardCompact` derive their own
// monogram from `sns`.
function labelFor(
  pubkey: string,
  dir: Awaited<ReturnType<typeof fetchAgentDirectory>>,
): AgentLabel {
  const fromDir = dir[pubkey];
  if (fromDir) {
    return { name: fromDir.displayName, sns: fromDir.sns };
  }
  const legacy = resolveSns(pubkey);
  if (legacy?.devnetName) {
    return { name: legacy.devnetName, sns: legacy.devnetName };
  }
  return { name: truncatePubkey(pubkey), sns: null };
}

/** Convert a slot delta into a friendly "in ~5h" / "in ~2d" string,
 *  using Solana's ~400ms slot time. Negative deltas → "ready to resolve". */
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

function fmtVolumeBusd(raw: number): string {
  const usd = raw / 1_000_000;
  if (usd >= 1_000_000) return `${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `${(usd / 1_000).toFixed(1)}k`;
  return usd.toFixed(2);
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarketDetailPage(
  props: {
    params: Promise<{ id: string }>;
  },
) {
  const params = await props.params;
  const connection = getDevnetConnection();
  // Critical-path reads — header, hero, and bet panel. `fetchAllMarkets`
  // (= getProgramAccounts, ~2-3s on devnet) is deliberately deferred to a
  // <Suspense> below so the rest of the page can render in ~1 RPC hop.
  const [market, agentDir, currentSlot] = await Promise.all([
    fetchMarketByAddress(connection, params.id),
    fetchAgentDirectory({ cache: "no-store" }),
    connection.getSlot("confirmed").catch(() => 0),
  ]);

  if (!market) notFound();

  const creator = labelFor(market.createdBy, agentDir);
  const qualityGate = await checkAgentQualityGate(creator.sns);
  const targetA = market.strategy
    ? labelFor(market.strategy, agentDir)
    : null;
  const targetB = market.targetAgent
    ? labelFor(market.targetAgent, agentDir)
    : null;

  const totalShares = market.yesShares + market.noShares;
  const yesProbability =
    totalShares > 0 ? market.yesShares / totalShares : 0.5;

  // Live target NAV(s).
  const [vaultA, vaultB] = await Promise.all([
    market.strategy
      ? fetchBundieVault(
          connection,
          PROGRAM_IDS.predictionMarket,
          market.strategy,
        ).catch(() => null)
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
  const initialNavA = Number(market.initialNavA) / 1_000_000;

  // NAV history for the big chart — same backend route the agent insight
  // panel uses. The 30-day series is more than enough resolution to draw
  // a meaningful trajectory; the chart auto-scales.
  const navPnl = targetA?.sns
    ? await fetchAgentPnl(targetA.sns, "30d")
    : null;
  const navSeries: number[] =
    navPnl?.snapshots
      .map((s) => microsToUsd(s.navLamports))
      .filter((v): v is number => v != null) ?? [];
  const navTimestamps: string[] =
    navPnl?.snapshots.map((s) => s.ts) ?? [];

  const slotsToResolution =
    currentSlot > 0 ? market.resolutionSlot - currentSlot : 0;
  const resolutionTimeLabel = relativeSlotLabel(slotsToResolution);

  // Resolution prose — kind-specific.
  const slotLabel = market.resolutionSlot.toLocaleString();
  const targetAName = targetA?.name ?? "the agent";
  const targetBName = targetB?.name ?? "the other agent";
  let resolutionProse: string;
  let thresholdBusd: number | null = null;
  if (market.kind === 1) {
    thresholdBusd = (market.targetNavLamports ?? 0) / 1_000_000;
    resolutionProse =
      `Resolves YES if ${targetAName}'s vault NAV reaches ` +
      `${thresholdBusd.toLocaleString(undefined, { maximumFractionDigits: 2 })} bUSD ` +
      `by slot ${slotLabel}.`;
  } else if (market.kind === 2) {
    resolutionProse =
      `Resolves YES if ${targetAName}'s NAV growth beats ` +
      `${targetBName}'s by slot ${slotLabel}.`;
  } else if (market.kind === 3) {
    const pct = ((market.drawdownBps ?? 0) / 100).toFixed(2);
    // For drawdown markets the threshold is initialNav * (1 - drawdown).
    if (initialNavA > 0 && market.drawdownBps != null) {
      thresholdBusd = initialNavA * (1 - market.drawdownBps / 10_000);
    }
    resolutionProse =
      `Resolves YES if ${targetAName}'s NAV drops by ${pct}% or more ` +
      `by slot ${slotLabel}.`;
  } else {
    resolutionProse =
      market.question || "Resolves via program-native NAV reads.";
  }

  const totalVolumeBusd = fmtVolumeBusd(market.totalVolume);
  const feeLabel = `${(market.feeBps / 100).toFixed(2)}%`;

  // Caption underneath the chart — surfaces the live NAV vs threshold.
  const caption =
    navA != null && thresholdBusd != null
      ? `NAV ${fmtBusd(navA)} bUSD · threshold ${fmtBusd(thresholdBusd)} bUSD`
      : navA != null
        ? `NAV ${fmtBusd(navA)} bUSD · benchmark mode`
        : "Live NAV unavailable";

  const yesPctRound = Math.round(yesProbability * 100);

  return (
    <main
      style={{
        background: "var(--de-bg)",
        minHeight: "100vh",
        color: "var(--de-ink)",
      }}
    >
      {/* Mobile back strip */}
      <div className="md:hidden" style={{ padding: "14px 16px 0" }}>
        <Link
          href="/markets"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            color: "var(--de-lavender)",
            textDecoration: "none",
          }}
        >
          ← All markets
        </Link>
      </div>

      {/* Page container */}
      <div
        style={{
          maxWidth: 1320,
          margin: "0 auto",
          padding: "32px 24px 96px",
        }}
      >
        {/* Desktop crumb */}
        <div className="hidden md:block" style={{ marginBottom: 20 }}>
          <Link
            href="/markets"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.20em",
              color: "var(--de-ink-3)",
              textDecoration: "none",
            }}
          >
            ← All markets
          </Link>
        </div>

        <div className="market-grid">
          {/* ─── Left column ────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 32,
              minWidth: 0,
            }}
          >
            {/* Header strip */}
            <header
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                {creator.sns ? (
                  <AgentCardCompact
                    sns={creator.sns}
                    displayName={creator.name}
                    avatarSeed={hashSeed(creator.sns)}
                    href={`/agent/${creator.sns}`}
                    mode="row"
                    avatarSize={36}
                    meta={
                      <>
                        <span style={{ color: "var(--de-ink-4)" }}>Created by</span>
                        <span style={{ color: "var(--de-lavender)" }}>•</span>
                        <span>NAV-resolved market</span>
                      </>
                    }
                  />
                ) : (
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--de-ink-3)",
                    }}
                  >
                    {creator.name}
                  </div>
                )}
                <div
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  {market.status === "active" ? (
                    <StatusPill variant="ACTIVE">LIVE</StatusPill>
                  ) : (
                    <StatusPill variant="RESOLVED" />
                  )}
                </div>
              </div>

              {/* Question */}
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "clamp(28px, 4vw, 44px)",
                  lineHeight: 1.15,
                  letterSpacing: "-0.02em",
                  color: "var(--de-ink)",
                  margin: 0,
                  fontWeight: 400,
                }}
              >
                {market.question || "—"}
              </h1>

              {/* Metadata row */}
              <div
                style={{
                  display: "flex",
                  gap: 32,
                  flexWrap: "wrap",
                  paddingTop: 8,
                  borderTop: "1px solid var(--de-line)",
                }}
              >
                <MetaCell
                  label="Volume"
                  value={`${totalVolumeBusd} bUSD`}
                />
                <MetaCell label="Time left" value={resolutionTimeLabel} />
                <MetaCell label="Fee" value={feeLabel} />
                <MetaCell
                  label="Eligible"
                  value={qualityGate.passes ? "Open" : "Track-record gate"}
                  tone={qualityGate.passes ? "default" : "amber"}
                />
              </div>
            </header>

            {/* NAV chart with threshold */}
            <section
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.20em",
                    color: "var(--de-ink-3)",
                  }}
                >
                  NAV trajectory · {targetA?.name ?? "Target"}
                </div>
              </div>
              <NavChartWithThreshold
                series={navSeries}
                timestamps={navTimestamps}
                thresholdBusd={thresholdBusd}
                caption={caption}
                height={320}
              />
            </section>

            {/* Rules & Resolution */}
            <RulesAndResolution
              kind={market.kind}
              resolutionProse={resolutionProse}
              resolutionSlot={market.resolutionSlot}
              resolutionTimeLabel={resolutionTimeLabel}
              trailing={
                <Suspense fallback={null}>
                  <CreatorAccuracyLine
                    createdBy={market.createdBy}
                    creatorName={creator.name}
                  />
                </Suspense>
              }
            />

            {/* Creator notes — collapsed by default */}
            <details
              className="creator-notes"
              style={{
                padding: "20px 24px",
                border: "1px solid var(--de-line-2)",
                borderRadius: 12,
                background: "var(--de-bg-raised)",
                color: "var(--de-ink-2)",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.20em",
                  textTransform: "uppercase",
                  color: "var(--de-ink-3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>Creator notes</span>
                <span className="creator-notes-chevron" aria-hidden="true">▾</span>
              </summary>
              <p
                style={{
                  marginTop: 12,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: "var(--de-ink-2)",
                }}
              >
                {creator.name} created this market on devnet. Insider-trading
                protection is enforced by the on-chain program: a creator
                cannot open a market against their own vault.
              </p>
            </details>

            {/* Agent insight (legacy component, retained inside the dark
                editorial canvas — its body still uses legacy tokens but
                renders cleanly on the dark page). */}
            <section
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.20em",
                  color: "var(--de-ink-3)",
                }}
              >
                Agent signal
              </div>
              <Suspense
                fallback={<InsightSkeleton label={targetA?.name ?? "Target"} />}
              >
                <AgentInsight
                  sns={targetA?.sns ?? null}
                  vaultPda={market.strategy ?? null}
                  connection={connection}
                  displayName={targetA?.name}
                />
              </Suspense>
              {market.kind === 2 && market.targetAgent && (
                <Suspense
                  fallback={
                    <InsightSkeleton label={targetB?.name ?? "Target B"} />
                  }
                >
                  <AgentInsight
                    sns={targetB?.sns ?? null}
                    vaultPda={market.targetAgent}
                    connection={connection}
                    displayName={targetB?.name}
                  />
                </Suspense>
              )}
            </section>

            {/* Discussion */}
            <DiscussionThread agentSns={creator.sns ?? undefined} />

            {/* Footer breadcrumb */}
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                color: "var(--de-ink-4)",
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                letterSpacing: "0.14em",
              }}
            >
              <span>MARKET</span>
              <span>·</span>
              <a
                href={`https://orbmarkets.io/address/${market.address}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: "var(--de-lavender)",
                  textDecoration: "none",
                  letterSpacing: "0.04em",
                }}
              >
                {market.address.slice(0, 12)}…{market.address.slice(-8)}
              </a>
            </div>
          </div>

          {/* ─── Right column (sticky trading panel) ────────────────── */}
          <aside className="market-aside">
            <div className="market-sticky">
              <TradingPanel
                market={market}
                yesProbability={yesProbability}
                qualityGate={qualityGate}
                resolutionTimeLabel={resolutionTimeLabel}
                outcomeALabel={
                  market.kind === 2
                    ? `${targetA?.name ?? "Side A"} wins · ${yesPctRound}%`
                    : "YES"
                }
                outcomeBLabel={
                  market.kind === 2
                    ? `${targetB?.name ?? "Side B"} wins · ${100 - yesPctRound}%`
                    : "NO"
                }
              />
            </div>
          </aside>
        </div>
      </div>

      <style>{`
        .creator-notes > summary { list-style: none; }
        .creator-notes > summary::-webkit-details-marker { display: none; }
        .creator-notes > summary::marker { display: none; }
        details[open] .creator-notes-chevron { transform: rotate(180deg); }
        .market-grid {
          display: grid;
          grid-template-columns: minmax(0, 65fr) minmax(0, 35fr);
          gap: 40px;
        }
        .market-sticky {
          position: sticky;
          /* Respect notched / dynamic-island devices — without this the
             panel slides under the system UI on iPhone Pro / Android
             punch-hole screens during scroll. */
          top: calc(env(safe-area-inset-top, 0px) + 80px);
        }
        @media (max-width: 1279px) {
          .market-grid {
            grid-template-columns: minmax(0, 60fr) minmax(0, 40fr);
            gap: 28px;
          }
        }
        @media (max-width: 768px) {
          .market-grid {
            grid-template-columns: 1fr;
            gap: 24px;
          }
          .market-sticky {
            position: static;
            top: auto;
          }
        }
      `}</style>
    </main>
  );
}

function MetaCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "amber";
}) {
  const valueColor =
    tone === "amber" ? "var(--de-amber)" : "var(--de-ink)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.20em",
          color: "var(--de-ink-4)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 14,
          fontWeight: 500,
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.02em",
        }}
      >
        {value}
      </span>
    </div>
  );
}


function InsightSkeleton({ label }: { label: string }) {
  return (
    <section
      style={{
        padding: 20,
        border: "1px solid var(--de-line-2)",
        borderRadius: 12,
        background: "var(--de-bg-raised)",
        minHeight: 220,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.20em",
          color: "var(--de-ink-3)",
          marginBottom: 8,
        }}
      >
        Target · {label}
      </div>
      <div style={{ fontSize: 12, color: "var(--de-ink-4)" }}>
        Loading agent insight…
      </div>
    </section>
  );
}

function fmtBusd(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)}k`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Streamed via <Suspense> so the page header / hero / bet panel render in
// ~1 RPC roundtrip instead of waiting on a getProgramAccounts scan.
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
    (resolved.filter((m) => m.outcome === "no").length / resolved.length) *
      100,
  );
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        marginTop: 6,
        color: "var(--de-ink-3)",
        lineHeight: 1.5,
      }}
    >
      <span>
        {creatorName} has created{" "}
        <span style={{ color: "var(--de-lavender)" }}>{resolved.length}</span>{" "}
        resolved {resolved.length === 1 ? "market" : "markets"} on devnet.
      </span>
    </div>
  );
}
