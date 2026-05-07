import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getDevnetConnection } from "@/lib/rpc";
import { fetchAllMarkets, fetchBundieVault } from "@/lib/markets";
import {
  fetchRegisteredAgents,
  fetchRegisteredVaultSet,
  fetchAgentDirectory,
} from "@/lib/registry";
import { PROGRAM_IDS } from "@/lib/constants";
import {
  resolveSns,
  resolveVaultFromSns,
  truncatePubkey,
} from "@/lib/sns-resolver";
import {
  isBootstrapAgent,
  BOOTSTRAP_BADGE_TOOLTIP,
} from "@/lib/bootstrap-owner";
import {
  fetchAgentPnl,
  microsToUsd,
  fmtReturnBps,
  fmtUsd,
} from "@/lib/pnl";
import {
  DeAvatar,
  DeMarketCard,
  NavChartLarge,
  RecentTradesCard,
  DiscussionThread,
  StatusPill,
  hashSeed,
  type NavChartRange,
} from "@/components/de";
import type { SurfpoolAction } from "@/components/surfpool-activity-panel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Strategy-flavour blurb, used when the registered agent has no tagline
// stored. Keyed by `preset` first, falling back to a generic line.
const PRESET_TAGLINES: Record<string, string> = {
  "lst-rotation":
    "Rotates SOL across liquid-staking tokens, chasing the highest validator yield.",
  "kamino-stacker":
    "Stacks lending positions on Kamino, harvesting variable rate spreads.",
  "stable-arb":
    "Arbs USDC across stable lending desks, parking idle balance at the best rate.",
  "stable-arber":
    "Arbs USDC across stable lending desks, parking idle balance at the best rate.",
  "apy-rotator":
    "Hunts the highest variable APY across Solana lending markets and rotates.",
  "funding-shorter":
    "Shorts perp funding when the rate flips, paid to fade the crowd.",
  barbell:
    "Barbell allocation: bUSD on one side, leveraged perps on the other.",
  "lst-shopper":
    "Shops liquid-staking tokens for the best discount-to-NAV.",
  "60-40":
    "Classic 60% staking, 40% lending — quiet compounding.",
  basis: "Basis trade: long spot, short perp, harvest funding.",
};

const PROTOCOL_LOGOS: Record<string, { name: string; src: string }> = {
  kamino: { name: "Kamino", src: "/protocols/kamino.png" },
  marinade: { name: "Marinade", src: "/protocols/marinade.png" },
  jito: { name: "Jito", src: "/protocols/jito.png" },
  solend: { name: "Solend", src: "/protocols/solend.png" },
  jupiter: { name: "Jupiter", src: "/protocols/jupiter.png" },
  "jupiter-perps": { name: "Jupiter Perps", src: "/protocols/jupiter-perps.png" },
  marginfi: { name: "MarginFi", src: "/protocols/marginfi.png" },
};

// Map the `?range=` query param onto the typed values used by both the
// PnL fetch (lower-case) and the NavChartLarge tabs (upper-case).
function normaliseRange(raw: string | undefined): {
  pnl: "7d" | "30d" | "all";
  chart: NavChartRange;
} {
  switch ((raw ?? "30d").toLowerCase()) {
    case "1h":
      // PnL endpoint doesn't expose 1H, fall through to 7D for the data
      // fetch but keep the chart tab highlighted on 1H so the URL is honest.
      return { pnl: "7d", chart: "1H" };
    case "24h":
      return { pnl: "7d", chart: "24H" };
    case "7d":
      return { pnl: "7d", chart: "7D" };
    case "all":
      return { pnl: "all", chart: "ALL" };
    case "30d":
    default:
      return { pnl: "30d", chart: "30D" };
  }
}

export default async function AgentProfilePage(props: {
  params: Promise<{ sns: string }>;
  searchParams?: Promise<{ range?: string }>;
}) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const decoded = decodeURIComponent(params.sns);
  const { pnl: pnlRange, chart: chartRange } = normaliseRange(
    searchParams?.range,
  );

  // Vault resolution: hardcoded HERO_AGENTS map → registry SNS lookup → raw
  // pubkey. Mirrors the pre-redesign behaviour exactly so wizard-created
  // agents keep working on first load.
  let vaultFromName = resolveVaultFromSns(decoded);
  let agentPubkey: string | null = null;
  let ownerWallet: string | null = null;
  let snsVerified = false;
  let registeredTagline: string | null = null;
  let registeredBrainMd: string | null = null;
  let registeredPreset: string | null = null;
  let registeredDisplayName: string | null = null;

  const registry = await fetchRegisteredAgents({ cache: "no-store" });
  const registryMatch = registry.find(
    (a) =>
      a.sns === decoded ||
      a.sns === `${decoded}.sol` ||
      a.sns === `${decoded}.bundie.sol` ||
      a.vault_pda === decoded ||
      a.agent_pubkey === decoded,
  );
  if (registryMatch) {
    if (!vaultFromName && registryMatch.vault_pda) {
      vaultFromName = registryMatch.vault_pda;
    }
    if (registryMatch.agent_pubkey) agentPubkey = registryMatch.agent_pubkey;
    ownerWallet = registryMatch.owner_wallet ?? null;
    snsVerified = registryMatch.sns_verified === true;
    registeredTagline = registryMatch.tagline ?? null;
    registeredBrainMd = registryMatch.brain_md ?? null;
    registeredPreset = registryMatch.preset ?? null;
    registeredDisplayName = registryMatch.display_name ?? null;
  }

  const vault = vaultFromName ?? decoded;
  const sns = resolveSns(vault);

  // 404 unknown vaults — registry is authoritative.
  const allowedCreators = await fetchRegisteredVaultSet({
    cache: "no-store",
  });
  if (!allowedCreators.has(vault)) {
    notFound();
  }

  const connection = getDevnetConnection();
  const [allMarkets, agentDir, bundieVault] = await Promise.all([
    fetchAllMarkets(connection, { allowedCreators }),
    fetchAgentDirectory({ cache: "no-store" }),
    fetchBundieVault(connection, PROGRAM_IDS.predictionMarket, vault),
  ]);

  const myKeys = new Set<string>([vault]);
  if (agentPubkey) myKeys.add(agentPubkey);
  const createdByMe = allMarkets.filter((m) => myKeys.has(m.createdBy));
  const onMe = allMarkets.filter(
    (m) => m.strategy === vault || m.targetAgent === vault,
  );

  // PnL series for the hero NAV chart + headline metadata.
  const rawSns = sns?.devnetName ?? decoded;
  const surfpoolSns = rawSns.endsWith(".sol") ? rawSns : `${rawSns}.sol`;
  const pnl = await fetchAgentPnl(rawSns, pnlRange);
  const navSeries = pnl.snapshots
    .map((s) => {
      const nav = microsToUsd(s.navLamports);
      const ts = new Date(s.ts).getTime();
      if (nav == null || !Number.isFinite(ts)) return null;
      return { ts, nav };
    })
    .filter((p): p is { ts: number; nav: number } => p !== null);

  // Vault inspection — surface SOL balance + token positions for the
  // strategy section. Best-effort; failure renders an empty composition.
  let solLamports = 0;
  let tokenAccounts: Array<{ mint: string; uiAmount: number }> = [];
  try {
    const [sol, parsed] = await Promise.all([
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
        return { mint: (info?.mint as string) ?? "", uiAmount };
      })
      .filter((t) => t.uiAmount > 0 && t.mint);
  } catch {
    // swallow — agent page should not 500 on RPC blip
  }

  // Surfpool / agent-action-log feed for the recent-trades sidebar card.
  const backendBase =
    process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
  let surfpoolActions: SurfpoolAction[] = [];
  try {
    const res = await fetch(
      `${backendBase}/api/agent/${encodeURIComponent(surfpoolSns)}/surfpool-activity?limit=20`,
      { cache: "no-store" },
    );
    if (res.ok) {
      const body = (await res.json()) as { actions?: SurfpoolAction[] };
      surfpoolActions = body.actions ?? [];
    }
  } catch {
    // backend down → empty list, page still renders
  }

  // Derived stats
  const resolvedMarkets = createdByMe.filter((m) => m.status === "resolved");
  const activeMarkets = createdByMe.filter((m) => m.status === "active");
  const onMeActive = onMe.filter((m) => m.status === "active");
  const noWins = resolvedMarkets.filter((m) => m.outcome === "no").length;
  const accuracy =
    resolvedMarkets.length === 0
      ? null
      : Math.round((noWins / resolvedMarkets.length) * 100);

  const displayName =
    registeredDisplayName ?? sns?.devnetName ?? truncatePubkey(vault);
  const handle = sns?.devnetName ?? registryMatch?.sns ?? null;
  const mainnetName = sns?.mainnetName ?? null;
  const solBalance = solLamports / LAMPORTS_PER_SOL;
  const tagline =
    registeredTagline?.trim() ||
    PRESET_TAGLINES[(registeredPreset ?? "").toLowerCase()] ||
    PRESET_TAGLINES[displayName.toLowerCase()] ||
    "On-chain agent operating live strategies on Solana devnet.";

  const tvlUsd = microsToUsd(pnl.stats.currentNavLamports);
  const return30d = pnl.stats.return30dBps;
  const winRatePct = pnl.stats.winRatePct ?? null;

  // Inspect the recent trade log to derive the protocol set this agent
  // actually touches. Falls back to the full preset palette when there's
  // nothing to learn from yet.
  const usedProtocols = new Set<string>();
  for (const a of surfpoolActions) {
    if (a.protocol) usedProtocols.add(a.protocol);
  }
  for (const t of tokenAccounts) {
    // mSOL → marinade; kUSDC → kamino; covers the two known devnet
    // execution routes recognised on the legacy page.
    if (t.mint === "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So")
      usedProtocols.add("marinade");
    if (t.mint === "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy")
      usedProtocols.add("kamino");
  }
  const protocolBadges = Array.from(usedProtocols)
    .map((p) => ({ id: p, ...PROTOCOL_LOGOS[p] }))
    .filter((p): p is { id: string; name: string; src: string } => !!p.name);

  // NAV chart resolution thresholds — pull target_nav from any open kind=1
  // markets pointing at this vault. Caps to 3 lines so the chart stays clean.
  const thresholds = onMeActive
    .filter((m) => m.kind === 1 && m.targetNavLamports != null)
    .slice(0, 3)
    .map((m) => ({
      value: Number(m.targetNavLamports ?? 0n) / 1_000_000,
      label: `target ${(Number(m.targetNavLamports ?? 0n) / 1_000_000).toFixed(2)}`,
      tone: "mint" as const,
    }));

  const heroBadgeTone =
    return30d != null && return30d > 0
      ? "mint"
      : return30d != null && return30d < 0
      ? "rose"
      : "neutral";

  const basePath = `/agent/${encodeURIComponent(params.sns)}`;

  return (
    <main
      style={{
        background: "var(--de-bg)",
        color: "var(--de-ink)",
        minHeight: "100vh",
      }}
    >
      {/* Top breadcrumb */}
      <div
        style={{
          padding: "20px clamp(20px, 4vw, 40px) 0",
          maxWidth: 1440,
          margin: "0 auto",
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--de-ink-3)",
            textDecoration: "none",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          ← Discover
        </Link>
      </div>

      {/* Page body — two-column layout */}
      <div
        className="agent-detail-grid"
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          padding: "32px clamp(20px, 4vw, 40px) 64px",
        }}
      >
        <style>{`
          .agent-detail-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 32px;
          }
          .agent-detail-side {
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          @media (min-width: 768px) {
            .agent-detail-grid {
              grid-template-columns: 6fr 4fr;
              gap: 36px;
            }
          }
          @media (min-width: 1280px) {
            .agent-detail-grid {
              grid-template-columns: 65fr 35fr;
              gap: 48px;
            }
            .agent-detail-side {
              position: sticky;
              top: 80px;
              align-self: start;
              max-height: calc(100vh - 96px);
              overflow-y: auto;
            }
          }
          .agent-detail-side::-webkit-scrollbar { width: 6px; }
          .agent-detail-side::-webkit-scrollbar-thumb {
            background: var(--de-line-2);
            border-radius: 3px;
          }
        `}</style>

        {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          {/* Header strip */}
          <header
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 24,
                flexWrap: "wrap",
              }}
            >
              <DeAvatar seed={hashSeed(handle ?? vault)} size={80} />
              <div style={{ flex: 1, minWidth: 240 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      color: "var(--de-ink-3)",
                      letterSpacing: "0.20em",
                      textTransform: "uppercase",
                    }}
                  >
                    Bundie agent
                  </span>
                  <StatusPill variant="LIVE">LIVE</StatusPill>
                  {isBootstrapAgent(ownerWallet) && (
                    <span
                      title={BOOTSTRAP_BADGE_TOOLTIP}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 9.5,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.16em",
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: "var(--de-amber-tint)",
                        color: "var(--de-amber)",
                        border: "1px solid rgba(232,197,138,0.32)",
                      }}
                    >
                      Bootstrap
                    </span>
                  )}
                </div>

                <h1
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "clamp(36px, 5vw, 52px)",
                    letterSpacing: "-0.025em",
                    lineHeight: 1.05,
                    color: "var(--de-ink)",
                    margin: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span>{displayName}</span>
                  {snsVerified && (
                    <span
                      aria-label="SNS verified"
                      style={{
                        fontSize: 22,
                        color: "var(--de-lavender)",
                      }}
                    >
                      ✓
                    </span>
                  )}
                </h1>

                {handle && (
                  <div
                    style={{
                      marginTop: 8,
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      color: "var(--de-ink-3)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {handle}
                    {mainnetName && (
                      <span
                        style={{ color: "var(--de-ink-4)", marginLeft: 8 }}
                      >
                        · mainnet:{" "}
                        <span style={{ color: "var(--de-lavender)" }}>
                          {mainnetName}
                        </span>
                      </span>
                    )}
                  </div>
                )}

                {/* Tagline (italic display) */}
                <p
                  style={{
                    marginTop: 16,
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: 18,
                    lineHeight: 1.4,
                    color: "var(--de-ink-2)",
                    maxWidth: 620,
                  }}
                >
                  {tagline}
                </p>
              </div>
            </div>

            {/* Metadata row — TVL · 30D RETURN · MARKETS RESOLVED · WIN RATE */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 1,
                background: "var(--de-line)",
                border: "1px solid var(--de-line-2)",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <MetaCell label="TVL" value={tvlUsd != null ? `$${fmtUsd(tvlUsd)}` : "—"} />
              <MetaCell
                label="30D Return"
                value={fmtReturnBps(return30d)}
                tone={heroBadgeTone}
              />
              <MetaCell
                label="Markets resolved"
                value={resolvedMarkets.length.toString()}
              />
              <MetaCell
                label="Win rate"
                value={
                  winRatePct != null
                    ? `${winRatePct.toFixed(0)}%`
                    : accuracy != null
                    ? `${accuracy}%`
                    : "—"
                }
              />
            </div>
          </header>

          {/* Large NAV chart with range tabs */}
          <NavChartLarge
            series={navSeries}
            range={chartRange}
            basePath={basePath}
            thresholds={thresholds}
            eyebrow="Live NAV"
            height={400}
          />

          {/* On-chain anchor strip — slot/epoch provenance */}
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--de-ink-4)",
              letterSpacing: "0.04em",
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              padding: "10px 14px",
              border: "1px solid var(--de-line)",
              borderRadius: 8,
              background: "var(--de-bg-3)",
            }}
          >
            <span>
              Anchor slot{" "}
              <span style={{ color: "var(--de-ink-2)" }}>
                {bundieVault?.navSlot?.toString() ?? "—"}
              </span>
            </span>
            <span aria-hidden style={{ color: "var(--de-ink-5)" }}>
              ·
            </span>
            <span>
              Epoch{" "}
              <span style={{ color: "var(--de-ink-2)" }}>
                {bundieVault?.navEpoch?.toString() ?? "0"}
              </span>
            </span>
            <span aria-hidden style={{ color: "var(--de-ink-5)" }}>
              ·
            </span>
            <span>
              On-chain NAV{" "}
              <span style={{ color: "var(--de-lavender)" }}>
                {(Number(bundieVault?.navLamports ?? 0n) / 1_000_000).toFixed(2)} bUSD
              </span>
            </span>
          </div>

          {/* Strategy section */}
          <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 28,
                letterSpacing: "-0.02em",
                margin: 0,
                color: "var(--de-ink)",
              }}
            >
              Strategy
            </h2>
            <p
              style={{
                fontSize: 15,
                lineHeight: 1.65,
                color: "var(--de-ink-2)",
                margin: 0,
                maxWidth: 720,
              }}
            >
              {registeredBrainMd
                ? extractBrainSummary(registeredBrainMd)
                : strategyProseFor(registeredPreset, displayName, tagline)}
            </p>

            {/* Protocols used */}
            {protocolBadges.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--de-ink-3)",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                  }}
                >
                  Protocols
                </span>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  {protocolBadges.map((p) => (
                    <span
                      key={p.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 12px 6px 6px",
                        background: "var(--de-bg-raised)",
                        border: "1px solid var(--de-line-2)",
                        borderRadius: 999,
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--de-ink-2)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.src}
                        alt={p.name}
                        width={20}
                        height={20}
                        style={{
                          borderRadius: 4,
                          objectFit: "cover",
                        }}
                      />
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Risk policy block */}
            <div
              style={{
                marginTop: 6,
                padding: "20px 22px",
                background: "var(--de-bg-raised)",
                border: "1px solid var(--de-line-2)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--de-ink-3)",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                Risk policy
              </span>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 16,
                }}
              >
                <PolicyCell
                  label="Per-protocol cap"
                  value={protocolBadges.length > 0 ? `≤ 60% NAV` : "—"}
                />
                <PolicyCell
                  label="Drawdown trigger"
                  value={
                    pnl.stats.maxDrawdownBps
                      ? `${(pnl.stats.maxDrawdownBps / 100).toFixed(2)}% observed`
                      : "—"
                  }
                />
                <PolicyCell
                  label="Vault SOL"
                  value={`${solBalance.toFixed(4)} SOL`}
                />
                <PolicyCell
                  label="Action log"
                  value={`${surfpoolActions.length} on record`}
                />
              </div>
            </div>
          </section>

          {/* Vault address strip */}
          <section
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              background: "var(--de-bg-3)",
              border: "1px solid var(--de-line-2)",
              borderRadius: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--de-ink-3)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              Vault PDA
            </span>
            <a
              href={`https://orbmarkets.io/address/${vault}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: "var(--de-lavender)",
                wordBreak: "break-all",
                flex: 1,
                textDecoration: "none",
                minWidth: 0,
              }}
            >
              {vault}
            </a>
            <StatusPill variant="DEVNET">DEVNET</StatusPill>
          </section>
        </div>

        {/* ── RIGHT COLUMN (sticky on desktop) ────────────────────────── */}
        <aside className="agent-detail-side">
          {/* Open markets card */}
          <section
            style={{
              background: "var(--de-bg-raised)",
              border: "1px solid var(--de-line-2)",
              borderRadius: 12,
              padding: 20,
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
                gap: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--de-ink-3)",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                Open markets
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--de-ink-4)",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                {onMeActive.length} live
              </span>
            </div>

            {onMeActive.length === 0 ? (
              <div
                style={{
                  padding: "28px 16px",
                  textAlign: "center",
                  border: "1px dashed var(--de-line-2)",
                  borderRadius: 10,
                  background: "var(--de-bg-3)",
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: 14,
                    color: "var(--de-ink-2)",
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  No markets target this agent yet.
                </p>
                <p
                  style={{
                    marginTop: 6,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--de-ink-4)",
                  }}
                >
                  Be the first to open one
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {onMeActive.slice(0, 4).map((m) => (
                  <DeMarketCard
                    key={m.address}
                    market={m}
                    dir={agentDir}
                    size="compact"
                  />
                ))}
                {onMeActive.length > 4 && (
                  <Link
                    href="/markets"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--de-lavender)",
                      textDecoration: "none",
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      padding: "10px 0",
                      textAlign: "center",
                    }}
                  >
                    View all {onMeActive.length} →
                  </Link>
                )}
              </div>
            )}

            {/* Markets created by this agent (compact pill list) */}
            {createdByMe.length > 0 && (
              <div
                style={{
                  marginTop: 4,
                  paddingTop: 14,
                  borderTop: "1px solid var(--de-line)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--de-ink-3)",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                  }}
                >
                  Created by agent · {createdByMe.length}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--de-ink-2)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {activeMarkets.length} active · {resolvedMarkets.length} resolved
                </span>
              </div>
            )}
          </section>

          {/* Recent trades card */}
          <RecentTradesCard actions={surfpoolActions} limit={6} />

          {/* Operator info card */}
          <section
            style={{
              background: "var(--de-bg-raised)",
              border: "1px solid var(--de-line-2)",
              borderRadius: 12,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--de-ink-3)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              Operator
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <DeAvatar seed={hashSeed(ownerWallet ?? vault)} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--de-ink)",
                    fontWeight: 500,
                  }}
                >
                  {isBootstrapAgent(ownerWallet)
                    ? "Bundie Bootstrap"
                    : "Independent operator"}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--de-ink-4)",
                    letterSpacing: "0.04em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={ownerWallet ?? undefined}
                >
                  {ownerWallet ? truncatePubkey(ownerWallet, 6, 6) : "—"}
                </div>
              </div>
            </div>
            {ownerWallet && (
              <a
                href={`https://orbmarkets.io/address/${ownerWallet}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: "var(--de-lavender)",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                  alignSelf: "flex-start",
                }}
              >
                View wallet ↗
              </a>
            )}
          </section>
        </aside>
      </div>

      {/* ── Discussion / activity (full width) ───────────────────────── */}
      <div
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          padding: "0 clamp(20px, 4vw, 40px) 80px",
        }}
      >
        <DiscussionThread agentSns={handle ?? undefined} />
      </div>
    </main>
  );
}

/** Tiny eyebrow + value cell for the metadata strip. */
function MetaCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "mint" | "rose" | "neutral";
}) {
  const valueColor =
    tone === "mint"
      ? "var(--de-mint)"
      : tone === "rose"
      ? "var(--de-rose)"
      : "var(--de-ink)";
  return (
    <div
      style={{
        background: "var(--de-bg-raised)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: "var(--de-ink-3)",
          letterSpacing: "0.20em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 20,
          fontWeight: 600,
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.005em",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PolicyCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: "var(--de-ink-3)",
          letterSpacing: "0.20em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          color: "var(--de-ink)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Pull the first non-empty paragraph from a brain.md blob. */
function extractBrainSummary(md: string): string {
  const lines = md
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("---"));
  if (lines.length === 0) return "";
  // Take up to the first 3 short paragraphs joined by a space.
  return lines.slice(0, 3).join(" ").slice(0, 600);
}

/** Editorial fallback prose when no brain.md is available. */
function strategyProseFor(
  preset: string | null,
  displayName: string,
  tagline: string,
): string {
  const presetCopy: Record<string, string> = {
    "lst-rotation":
      `${displayName} watches the validator stake market, swapping between liquid-staking tokens whenever a fresh APY edge opens up. Idle SOL parks at the highest yielding LST until the next rotation.`,
    "kamino-stacker":
      `${displayName} runs a layered Kamino lending strategy. The agent supplies stables and SOL, monitors utilisation, and tops up positions whenever the variable rate crosses a profitable threshold.`,
    "stable-arb":
      `${displayName} hunts for spread between stable lending desks. Capital sits in whichever pool offers the highest variable rate, and rotates the moment a competing desk pulls ahead.`,
  };
  return (
    presetCopy[(preset ?? "").toLowerCase()] ??
    `${tagline} The agent commits NAV on every action, so on-chain history fully describes its P&L. Markets resolve directly off that NAV record — there is no oracle, only the chart.`
  );
}
