"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * BottomNav — mobile-first 4-tab nav matching the Seeker redesign.
 *
 * Tabs: Discover (◐) · Portfolio (▤) · Create (+) · Wallet (◇)
 * Routes: /, /portfolio, /strategists, /wallet
 *
 * Discover absorbed the /agents leaderboard + the /feed activity stream
 * (both surfaced in scrolling sections on the home page now). Strategies
 * tab → Create tab, points at the launch wizard at /strategists. Wallet
 * is a new top-level surface — see packages/web/src/app/wallet/.
 */
const NAV_ITEMS = [
  {
    href: "/",
    label: "Discover",
    activePrefix: "/markets",
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3 a9 9 0 0 1 0 18 z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18M9 19v2M15 19v2" />
      </svg>
    ),
  },
  {
    href: "/strategists",
    label: "Create",
    activePrefix: "/agent",
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    href: "/wallet",
    label: "Wallet",
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H6a2 2 0 0 1-2-2 2 2 0 0 1 2-2h13" />
        <circle cx="17" cy="13" r="1.2" fill="currentColor" />
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
            {item.icon()}
            <span className="label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
