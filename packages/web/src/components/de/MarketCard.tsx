/**
 * MarketCard — the dark editorial market card.
 *
 * Used in:
 *   - trending-markets grid          (size="standard")
 *   - featured-markets sidebar slot  (size="compact")
 *   - agent detail open-markets list (size="expanded")
 *
 * Layout:
 *   row 1 — creator badge (AgentCardCompact, mode="badge")  · category tag · status pill
 *   row 2 — market question (display serif)
 *   row 3 — metadata pills: VOLUME · TIME LEFT · FEE
 *   row 4 — ConvictionBar
 *   row 5 — outcome buttons (YES / NO)
 *
 * Subtle 1px border with hover state lavender border + 1px elevation.
 *
 * Server-renderable. Wrapping <Link> performs the navigation; outcome
 * buttons short-circuit the click so they can be wired to a buy panel
 * without triggering navigation.
 */
import Link from "next/link";
import type { MarketView } from "@/lib/markets";
import type { AgentDirectory } from "@/lib/registry";
import { AgentCardCompact, hashSeed } from "./AgentCardCompact";
import { ConvictionBar } from "./ConvictionBar";
import { OutcomeButton } from "./OutcomeButton";
import { StatusPill } from "./StatusPill";

export type MarketCardSize = "compact" | "standard" | "expanded";

export interface DeMarketCardProps {
  market: MarketView;
  /** Used to resolve the agent SNS / display name from the on-chain creator pubkey. */
  dir: AgentDirectory;
  size?: MarketCardSize;
}

const KIND_META: Record<
  number,
  { label: string; tone: "lavender" | "blue" | "amber" | "mint"; description: string }
> = {
  1: { label: "NAV TARGET", tone: "lavender", description: "Above target NAV" },
  2: { label: "VS BENCHMARK", tone: "blue", description: "Strategy vs benchmark" },
  3: { label: "RATE THRESHOLD", tone: "amber", description: "Drawdown threshold" },
};

const TONE_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  lavender: {
    bg: "var(--de-lavender-tint)",
    fg: "var(--de-lavender)",
    border: "rgba(168,153,245,0.28)",
  },
  blue: {
    bg: "var(--de-blue-tint)",
    fg: "var(--de-blue)",
    border: "rgba(138,182,240,0.28)",
  },
  amber: {
    bg: "var(--de-amber-tint)",
    fg: "var(--de-amber)",
    border: "rgba(232,197,138,0.28)",
  },
  mint: {
    bg: "var(--de-mint-tint)",
    fg: "var(--de-mint)",
    border: "rgba(168,230,207,0.28)",
  },
};

export function DeMarketCard({ market, dir, size = "standard" }: DeMarketCardProps) {
  const yesShares = Number(market.yesShares) || 0;
  const noShares = Number(market.noShares) || 0;
  const total = yesShares + noShares;
  const yesProb = total > 0 ? yesShares / total : 0.5;
  const yesPct = Math.round(yesProb * 100);
  const noPct = 100 - yesPct;

  const agent = dir[market.createdBy];
  const kind = KIND_META[market.kind] ?? {
    label: "MARKET",
    tone: "lavender" as const,
    description: "",
  };
  const kindColor = TONE_COLOR[kind.tone];

  const padding =
    size === "compact" ? 16 : size === "expanded" ? 28 : 22;
  const titleSize =
    size === "compact" ? 15 : size === "expanded" ? 22 : 18;

  return (
    <Link
      href={`/market/${encodeURIComponent(market.address)}`}
      className="de-market-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding,
        background: "var(--de-bg-raised)",
        border: "1px solid var(--de-line-2)",
        borderRadius: 12,
        textDecoration: "none",
        color: "var(--de-ink)",
        transition:
          "border-color 200ms ease, transform 200ms ease, box-shadow 200ms ease",
      }}
    >
      {/* Top row: creator badge + kind chip + status pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          {agent ? (
            <AgentCardCompact
              sns={agent.sns}
              displayName={agent.displayName}
              avatarSeed={hashSeed(agent.sns)}
              mode="badge"
              avatarSize={20}
            />
          ) : (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--de-ink-3)",
                letterSpacing: "0.04em",
              }}
            >
              {short(market.createdBy)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              padding: "3px 8px",
              borderRadius: 4,
              background: kindColor.bg,
              color: kindColor.fg,
              border: `1px solid ${kindColor.border}`,
              whiteSpace: "nowrap",
            }}
          >
            {kind.label}
          </span>
          {market.status === "active" ? (
            <StatusPill variant="ACTIVE">LIVE</StatusPill>
          ) : (
            <StatusPill variant="RESOLVED" />
          )}
        </div>
      </div>

      {/* Question */}
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: titleSize,
          lineHeight: 1.25,
          letterSpacing: "-0.015em",
          color: "var(--de-ink)",
          minHeight: size === "compact" ? "auto" : 48,
        }}
      >
        {market.question}
      </div>

      {/* Metadata pills */}
      <div
        style={{
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "var(--de-ink-3)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <Pill label="Volume" value={fmtVol(market.totalVolume)} />
        <Pill label="Closes" value={closesLabel(market.resolutionSlot)} />
        <Pill label="Fee" value={`${(market.feeBps / 100).toFixed(2)}%`} />
      </div>

      {/* Conviction bar */}
      <ConvictionBar
        yes={yesProb}
        label={`${yesPct}% YES`}
      />

      {/* Outcome buttons */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 4,
        }}
      >
        <OutcomeButton
          variant="YES"
          label="YES"
          price={`${yesPct}¢`}
          fullWidth
          // Defer to parent navigation — clicking the button still falls
          // through to the Link wrapper, taking the user to /market/[addr].
          // A future TradingPanel can override this via a custom card variant.
        />
        <OutcomeButton
          variant="NO"
          label="NO"
          price={`${noPct}¢`}
          fullWidth
        />
      </div>

      <style>{`
        .de-market-card:hover {
          border-color: rgba(168,153,245,0.42) !important;
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.2),
                      0 0 0 1px rgba(168,153,245,0.18);
        }
      `}</style>
    </Link>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ color: "var(--de-ink-4)" }}>{label}</span>
      <span style={{ color: "var(--de-ink-2)", fontWeight: 500 }}>{value}</span>
    </span>
  );
}

function fmtVol(raw: number): string {
  // Volume is in collateral base units (USDC = 6dp). Scale to USD.
  const usd = raw / 1_000_000;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}k`;
  return `$${usd.toFixed(0)}`;
}

function closesLabel(slot: number): string {
  // We can't fetch the current slot from a server component without an extra
  // RPC roundtrip per card, so fall back to a label that reads as a relative
  // hint. The market detail page surfaces the precise slot.
  if (!slot || slot < 1_000_000) return "soon";
  if (slot > 1_000_000_000) return `${(slot / 1_000_000).toFixed(0)}M slots`;
  return "soon";
}

function short(addr: string): string {
  if (!addr) return "—";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
