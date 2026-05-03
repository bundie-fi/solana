"use client";

/**
 * Discover home — trending markets section (client component).
 *
 * Server feeds in pre-fetched markets + agent directory; the only client
 * concern is the filter pill toggle (which updates the URL search param).
 *
 * Card shape mirrors the redesign:
 *   [TYPE chip] [agent attribution] [time-to-resolve]
 *   Question text
 *   [YES weighted bar  XX¢] [NO weighted bar  XX¢]   sparkline
 *   Vol $X · Closes in Y
 */
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { MarketView } from "@/lib/markets";
import type { AgentDirectory } from "@/lib/registry";

type FilterId = "all" | "rate" | "benchmark" | "agent_nav";

const FILTERS: { id: FilterId; label: string; kindMatches: (k: number) => boolean }[] = [
  { id: "all",        label: "All",                kindMatches: () => true },
  { id: "rate",       label: "Rate threshold",     kindMatches: (k) => k === 3 /* drawdown ≈ rate barrier */ },
  { id: "benchmark",  label: "Strategy vs benchmark", kindMatches: (k) => k === 2 /* head-to-head */ },
  { id: "agent_nav",  label: "NAV target",         kindMatches: (k) => k === 1 /* navTarget */ },
];

export function DiscoverMarketGrid({
  markets, dir, activeFilter,
}: {
  markets: MarketView[];
  dir: AgentDirectory;
  activeFilter: FilterId;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const filterDef = FILTERS.find((f) => f.id === activeFilter) ?? FILTERS[0];
  const filtered = markets.filter((m) => filterDef.kindMatches(m.kind));
  const trending = [...filtered].sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 8);

  const setFilter = (id: FilterId) => {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (id === "all") params.delete("filter");
    else params.set("filter", id);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <>
      <div
        style={{
          display: "flex", gap: 6, overflowX: "auto",
          padding: "6px 16px 4px", scrollbarWidth: "none",
        }}
      >
        {FILTERS.map((f) => {
          const active = activeFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              style={{
                padding: "6px 12px", borderRadius: 999,
                border: "1px solid",
                borderColor: active ? "var(--predict)" : "var(--line-1)",
                background: active ? "var(--predict-tint)" : "transparent",
                color: active ? "var(--predict)" : "var(--fg-3)",
                fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {trending.length === 0 ? (
        <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--fg-4)", fontSize: 12.5 }}>
          No markets in this category yet. Try All.
        </div>
      ) : (
        <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {trending.map((m) => (
            <MarketCard key={m.address} market={m} dir={dir} />
          ))}
        </div>
      )}
    </>
  );
}

function MarketCard({ market, dir }: { market: MarketView; dir: AgentDirectory }) {
  const yesShares = Number(market.yesShares) || 0;
  const noShares = Number(market.noShares) || 0;
  const total = yesShares + noShares;
  const yesPrice = total > 0 ? yesShares / total : 0.5;
  const yesPct = Math.round(yesPrice * 100);
  const noPct = 100 - yesPct;

  const agent = dir[market.createdBy];
  const kindMeta = MARKET_KIND[market.kind] ?? { label: "MKT", color: "var(--fg-3)" };
  const closes = relativeCloses(market.resolutionSlot);

  return (
    <Link
      href={`/market/${encodeURIComponent(market.address)}`}
      style={{
        display: "flex", flexDirection: "column", gap: 10,
        padding: 14, background: "var(--bg-1)",
        border: "1px solid var(--line-1)", borderRadius: 10,
        textDecoration: "none", color: "var(--fg-0)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span
            className="mono"
            style={{
              fontSize: 9, padding: "2px 5px", borderRadius: 3,
              background: kindMeta.color + "1a", color: kindMeta.color,
              letterSpacing: 0.6, fontWeight: 700,
            }}
          >
            {kindMeta.label}
          </span>
          {agent && (
            <span
              style={{
                fontSize: 11, color: "var(--fg-4)", minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {agent.displayName}
            </span>
          )}
        </div>
        <span
          className="mono"
          style={{
            fontSize: 11, color: "var(--fg-4)",
            fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
          }}
        >
          {closes}
        </span>
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--fg-0)" }}>
        {market.question}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <div
          style={{
            flex: Math.max(yesPrice, 0.18),
            padding: "8px 10px", borderRadius: 6,
            background: "rgba(31,158,106,0.12)",
            border: "1px solid rgba(31,158,106,0.3)",
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--pos)", letterSpacing: 0.6 }}>YES</span>
          <span
            className="mono"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--pos)", fontVariantNumeric: "tabular-nums" }}
          >
            {yesPct}¢
          </span>
        </div>
        <div
          style={{
            flex: Math.max(1 - yesPrice, 0.18),
            padding: "8px 10px", borderRadius: 6,
            background: "rgba(209,69,69,0.10)",
            border: "1px solid rgba(209,69,69,0.25)",
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--neg)", letterSpacing: 0.6 }}>NO</span>
          <span
            className="mono"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--neg)", fontVariantNumeric: "tabular-nums" }}
          >
            {noPct}¢
          </span>
        </div>
      </div>

      <div
        className="mono"
        style={{
          display: "flex", gap: 12, fontSize: 10,
          color: "var(--fg-4)", fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>Vol ${(market.totalVolume / 1e6).toFixed(0)}</span>
        <span>·</span>
        <span>Closes in {closes}</span>
      </div>
    </Link>
  );
}

const MARKET_KIND: Record<number, { label: string; color: string }> = {
  1: { label: "NAV",   color: "#7c5cf0" },
  2: { label: "VS",    color: "#f0a45b" },
  3: { label: "RATE",  color: "#5b8def" },
};

const SLOT_TIME_MS = 400; // approximate Solana slot time
function relativeCloses(slot: number): string {
  // We don't have current slot at render-time without an extra RPC.
  // Use a rough estimate from now + ⌊(slot − now)·400ms⌋. Falls back to "—"
  // if `slot` looks unreasonable. This is the same approach the prior
  // rate-market-card used; revisit if/when we add a slot oracle to the
  // home server route.
  if (!slot || slot < 1_000_000) return "—";
  // Pretend we're roughly at slot N — best we can do server-side without
  // an RPC roundtrip on the home page. Show the resolution slot directly
  // as an epoch label so the user has SOMETHING numeric to anchor on.
  if (slot > 1_000_000_000) return `slot ${(slot / 1_000_000).toFixed(0)}M`;
  return `slot ${slot.toLocaleString()}`;
}
