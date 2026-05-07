"use client";

/**
 * TrendingFilters — client component that mirrors the legacy filter pill
 * row from `discover-market-grid.tsx` but in the dark editorial palette.
 *
 * Updates the `?filter=` searchParam without scrolling the page (filter
 * changes are an in-place tab, not a navigation).
 */
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export type TrendingFilterId = "all" | "rate" | "benchmark" | "agent_nav";

const FILTERS: { id: TrendingFilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "rate", label: "Rate threshold" },
  { id: "benchmark", label: "Strategy vs benchmark" },
  { id: "agent_nav", label: "NAV target" },
];

export function TrendingFilters({
  active,
}: {
  active: TrendingFilterId;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const setFilter = (id: TrendingFilterId) => {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (id === "all") params.delete("filter");
    else params.set("filter", id);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div
      className="no-scrollbar"
      style={{
        display: "flex",
        gap: 8,
        overflowX: "auto",
        padding: "4px 0",
      }}
    >
      {FILTERS.map((f) => {
        const isActive = active === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: `1px solid ${isActive ? "var(--de-lavender)" : "var(--de-line-2)"}`,
              background: isActive ? "var(--de-lavender-tint)" : "transparent",
              color: isActive ? "var(--de-lavender)" : "var(--de-ink-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              cursor: "pointer",
              transition: "border-color 160ms ease, background 160ms ease, color 160ms ease",
            }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
