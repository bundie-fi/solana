"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Reordered May 2026: Markets first (root surface), Feed second (live
// activity stream — used to be `/`), Portfolio third, Strategies fourth.
// The standalone "Agents" tab was folded into Strategies (`/strategists`)
// which now holds both the leaderboard and the launch flow.
const NAV_ITEMS = [
  {
    href: "/",
    label: "Markets",
    activePrefix: "/markets",
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
        <polyline points="16 7 22 7 22 13"/>
      </svg>
    ),
  },
  {
    href: "/feed",
    label: "Feed",
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h16M4 18h10"/>
      </svg>
    ),
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M8 21h8M12 17v4"/>
      </svg>
    ),
  },
  {
    href: "/agents",
    label: "Strategies",
    activePrefix: "/agent",
    icon: (active: boolean) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="bottom-nav fixed bottom-0 left-0 right-0 z-40 sm:hidden"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      aria-label="Mobile navigation"
    >
      {NAV_ITEMS.map((item) => {
        // Markets points at `/` but should also light up on /markets,
        // so treat an explicit activePrefix as "also match this path
        // family" — independent of href === "/".
        const active =
          pathname === item.href ||
          (item.activePrefix
            ? (pathname?.startsWith(item.activePrefix) ?? false)
            : item.href !== "/" && (pathname?.startsWith(item.href) ?? false));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`bottom-nav-item${active ? " active" : ""}`}
          >
            {item.icon(active)}
            <span className="label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
