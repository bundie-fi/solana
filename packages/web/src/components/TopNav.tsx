"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string }[] = [
  { href: "/discover", label: "Discover" },
  { href: "/markets", label: "Markets" },
  { href: "/protocols", label: "Protocols" },
  { href: "/portfolio", label: "Portfolio" },
];

/**
 * Minimal top navigation. Mounted from the root layout so every route shares
 * the same header. Active route gets the amber underline; rest sit muted.
 */
export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-300 bg-background/85 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-14 w-full max-w-content items-center justify-between gap-4 px-4 md:px-8"
      >
        <Link
          href="/discover"
          className="font-serif text-xl text-neutral-900 hover:text-amber-400 transition-colors duration-180"
        >
          <em>Bundie</em>
        </Link>

        <ul className="flex items-center gap-1 overflow-x-auto">
          {LINKS.map((l) => {
            const active =
              pathname === l.href ||
              (l.href !== "/discover" && pathname?.startsWith(l.href));
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "h-9 inline-flex items-center px-3 rounded-md font-mono text-[11px] uppercase tracking-[0.18em] whitespace-nowrap transition-colors duration-180",
                    active
                      ? "text-amber-400"
                      : "text-neutral-700 hover:text-neutral-900",
                  ].join(" ")}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
