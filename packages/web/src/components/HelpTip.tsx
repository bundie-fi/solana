"use client";

import type { ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

/**
 * `?`-icon hover tooltip. Drop next to any technical label whose meaning a
 * first-time user might not know. Radix is imported directly so tooltip
 * styling sits independently of any shadcn wrapper.
 */
export function HelpTip({
  children,
  side = "top",
}: {
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={80} skipDelayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label="More info"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 14,
              height: 14,
              borderRadius: 999,
              border: "1px solid var(--line-2)",
              background: "transparent",
              color: "var(--fg-4)",
              fontSize: 9,
              fontWeight: 700,
              lineHeight: 1,
              cursor: "help",
            }}
          >
            ?
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            style={{
              zIndex: 1100,
              maxWidth: 280,
              padding: "8px 12px",
              borderRadius: "var(--r-3)",
              border: "1px solid var(--line-1)",
              background: "var(--bg-1)",
              color: "var(--fg-1)",
              fontSize: 12,
              lineHeight: 1.55,
              boxShadow: "0 12px 32px rgba(22,22,24,0.18)",
            }}
          >
            {children}
            <TooltipPrimitive.Arrow
              style={{ fill: "var(--bg-1)" }}
              width={10}
              height={5}
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
