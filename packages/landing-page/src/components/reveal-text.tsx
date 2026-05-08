"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Wraps inline text and fires once when the element enters the viewport.
 * Adds `is-revealed` to the rendered span so the CSS in globals can run
 * its left-to-right reveal animation (background-clip + background-
 * position transition). Intentionally minimal — no framer-motion
 * dependency for a single one-shot move.
 */
export function RevealText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "-80px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cls = [className, revealed ? "is-revealed" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span ref={ref} className={cls}>
      {children}
    </span>
  );
}
