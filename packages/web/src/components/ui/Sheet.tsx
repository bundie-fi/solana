"use client";

import { ReactNode, useEffect } from "react";

/**
 * Hand-rolled responsive drawer.
 *  - On mobile (< md): slides up from the bottom edge.
 *  - On tablet+ (>= md): slides in from the right edge, 440px wide.
 * Backdrop tap / Escape key closes. No external deps.
 */
export function Sheet({
  open,
  onClose,
  children,
  title,
  accent = "gold",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  accent?: "gold" | "purple";
}) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    // Lock body scroll while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const accentLine =
    accent === "gold" ? "bg-earn-gold" : "bg-predict-purple";

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Detail"}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in cursor-default"
      />

      {/* Panel — bottom sheet on mobile, right sheet on md+ */}
      <div
        className={[
          "absolute bg-neutral-200 shadow-sheet",
          // Mobile: bottom sheet
          "left-0 right-0 bottom-0 rounded-t-2xl max-h-[92dvh] animate-sheet-up",
          // Desktop: right sheet
          "md:left-auto md:top-0 md:right-0 md:bottom-0 md:w-[440px] md:max-w-[92vw] md:max-h-none md:rounded-l-2xl md:rounded-tr-none md:animate-sheet-right",
          "flex flex-col overflow-hidden",
        ].join(" ")}
      >
        {/* Grab handle (mobile only) */}
        <div className="flex justify-center pt-3 md:hidden">
          <span className="h-1 w-10 rounded-full bg-neutral-400" />
        </div>

        {/* Accent line */}
        <div className={`h-[2px] w-full ${accentLine} opacity-80`} />

        {title && (
          <header className="flex items-center justify-between px-5 py-4 border-b border-neutral-300">
            <h2 className="text-h3 font-semibold text-neutral-800">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="h-9 w-9 rounded-md text-neutral-600 hover:text-neutral-800 hover:bg-neutral-300 transition-colors duration-180"
            >
              <span aria-hidden className="text-lg leading-none">×</span>
            </button>
          </header>
        )}

        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
