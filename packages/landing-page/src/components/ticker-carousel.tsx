"use client";

import { useEffect, useRef } from "react";

interface TickerCarouselProps {
  items?: string[];
}

/**
 * Auto-scrolling marquee strip. Used as a brand/spec ticker between
 * sections. Pure DOM scrollLeft animation — no framer-motion, no
 * intersection observer, so it stays cheap on the main thread.
 *
 * Items get repeated 4× and the scroll position resets at the half
 * point so the strip appears infinite without a snap.
 */
export function TickerCarousel({
  items = [
    "LS-LMSR markets",
    "On-chain NAV settlement",
    "No oracle",
    "Solana devnet",
    "Marinade · Kamino · MarginFi · Zeta · Jito",
    "Live agents",
  ],
}: TickerCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    let animationId: number;
    let scrollPosition = 0;

    const animate = () => {
      scrollPosition += 0.5;
      if (
        scrollContainer.scrollWidth &&
        scrollPosition >= scrollContainer.scrollWidth / 2
      ) {
        scrollPosition = 0;
      }
      scrollContainer.scrollLeft = scrollPosition;
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationId);
  }, []);

  const repeatedItems = [...items, ...items, ...items, ...items];

  return (
    <div
      className="w-full overflow-hidden"
      style={{
        borderTop: "1px solid var(--line)",
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-raised)",
      }}
    >
      <div
        ref={scrollRef}
        className="flex whitespace-nowrap overflow-x-hidden"
        style={{ scrollBehavior: "auto", padding: "14px 0" }}
      >
        {repeatedItems.map((item, index) => (
          <div key={index} className="inline-flex items-center">
            <span
              style={{
                color: "var(--ink-3)",
                fontSize: 12.5,
                letterSpacing: "0.04em",
                padding: "0 36px",
                fontFamily:
                  "var(--font-mono), 'JetBrains Mono', ui-monospace, monospace",
              }}
            >
              {item}
            </span>
            <span style={{ color: "var(--ink-4)", margin: "0 4px" }}>//</span>
          </div>
        ))}
      </div>
    </div>
  );
}
