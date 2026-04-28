"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

// Tiny class-name joiner. Keeps the landing-page free of an extra
// `clsx`/`cn` dependency for a one-line need.
function cn(...parts: Array<string | undefined | false | null>): string {
  return parts.filter(Boolean).join(" ");
}

interface MotionSectionProps {
  children: ReactNode;
  className?: string;
  id?: string;
  delay?: number;
}

/**
 * Scroll-into-view fade wrapper. Mirrors Aqua0's MotionSection: 40px
 * upward translate + opacity fade, fires once per element on first
 * intersection, runs the same easing curve we use elsewhere on the
 * site (--ease in globals.css).
 */
export function MotionSection({
  children,
  className,
  id,
  delay = 0,
}: MotionSectionProps) {
  return (
    <motion.section
      id={id}
      className={cn(className)}
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.7, delay, ease: [0.25, 0.4, 0.25, 1] }}
    >
      {children}
    </motion.section>
  );
}
