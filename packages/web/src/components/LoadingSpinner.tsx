"use client";

import type { CSSProperties } from "react";

const SIZES = {
  sm: 16,
  md: 24,
  lg: 36,
} as const;

export type SpinnerSize = keyof typeof SIZES;

/**
 * Sized spinner using a CSS-only ring so we don't depend on lucide-react.
 * The keyframes attach via a `<style>` tag so the spinner is self-contained
 * and works on pages that don't import any other animation.
 */
export function LoadingSpinner({
  size = "md",
  style,
}: {
  size?: SpinnerSize;
  style?: CSSProperties;
}) {
  const px = SIZES[size];
  const stroke = px <= 16 ? 2 : px <= 24 ? 2.5 : 3;
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{
        display: "inline-block",
        width: px,
        height: px,
        borderRadius: 999,
        border: `${stroke}px solid var(--line-2)`,
        borderTopColor: "var(--gold)",
        animation: "bd-spin 720ms linear infinite",
        ...style,
      }}
    >
      <style>{`@keyframes bd-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
