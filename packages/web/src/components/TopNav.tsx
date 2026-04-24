"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

// The wallet-adapter modal button pulls in a chunk of DOM at mount time;
// dynamic-import keeps it out of the initial page paint.
const WalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (m) => m.WalletMultiButton,
    ),
  { ssr: false },
);

const LINKS: {
  href: string;
  label: string;
  activePrefix?: string;
}[] = [
  { href: "/", label: "Feed" },
  { href: "/markets", label: "Markets" },
  { href: "/agents", label: "Agents", activePrefix: "/agent" },
  { href: "/protocols", label: "Protocols" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/identity", label: "Identity" },
];

/**
 * Top navigation — sticky on every route.
 *
 * Mobile: logo + hamburger-free pill list that horizontally scrolls when
 * the label count overflows. The links themselves keep a 44px touch target.
 * Desktop: same pill list inline; the live-pulse dot sits next to the logo
 * and the wallet button floats on the right.
 */
export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-300 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-14 w-full max-w-content items-center gap-3 px-3 sm:px-4 md:gap-4 md:px-8"
      >
        {/* Brand + live dot */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 group shrink-0"
        >
          <Image
            src="/assets/bundie-mark-white.png"
            alt=""
            width={28}
            height={28}
            priority
            className="rounded-sm"
          />
          <span className="font-serif text-xl text-neutral-900 group-hover:text-amber-400 transition-colors duration-180 hidden sm:inline">
            <em>Bundie</em>
          </span>
          <LivePulseDot />
        </Link>

        {/* Nav pills — scrolls on small screens */}
        <ul className="flex flex-1 min-w-0 items-center gap-1 overflow-x-auto no-scrollbar">
          {LINKS.map((l) => {
            const matchPrefix = l.activePrefix ?? l.href;
            const active =
              pathname === l.href ||
              (matchPrefix !== "/" &&
                matchPrefix !== "/markets" &&
                pathname?.startsWith(matchPrefix));
            return (
              <li key={l.href} className="shrink-0">
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "h-11 inline-flex items-center px-3 rounded-md font-mono text-[11px] uppercase tracking-[0.18em] whitespace-nowrap transition-colors duration-180",
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

        {/* Wallet button — hidden under sm on very narrow screens; the
            Portfolio page still has a prominent connect affordance. */}
        <div className="shrink-0 hidden sm:block">
          <WalletButton
            style={{
              background: "rgba(109,40,217,0.18)",
              border: "1px solid rgba(109,40,217,0.4)",
              borderRadius: "10px",
              color: "#b691f1",
              fontSize: "12px",
              height: "36px",
              padding: "0 14px",
              lineHeight: "36px",
            }}
          />
        </div>
      </nav>
    </header>
  );
}

/**
 * Small pulsing green dot next to the logo — confirms the page is
 * connected to live data. Pure CSS animation.
 */
function LivePulseDot() {
  return (
    <span
      className="relative inline-flex h-2 w-2 ml-1"
      title="Live data stream"
      aria-label="Live data stream"
    >
      <span className="absolute inline-flex h-full w-full rounded-full bg-success-500/70 animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-success-500" />
    </span>
  );
}
