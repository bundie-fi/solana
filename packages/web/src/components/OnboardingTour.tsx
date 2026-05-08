"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";

/**
 * First-connect onboarding tour, redesigned 2026-05.
 *
 * Pattern: spotlight + coachmark, not modal. The previous version was a
 * centred dialog with marketing copy and an emoji illustration; this one
 * dims the page, cuts a soft-cornered hole around the actual UI element
 * being explained, and floats a small Figtree-only tooltip beside it. The
 * goal is "show me the thing" rather than "read this slide deck".
 *
 * Anchors are CSS selectors against `data-tour` attributes on the discover
 * page; if an anchor cannot be resolved (user is on a different route) we
 * silently skip the tour rather than fall back to a centred modal.
 *
 * Trigger: first time a wallet connects on this browser. The dismissal
 * flag is keyed by lowercased address; bumping `TOUR_KEY_PREFIX` re-shows
 * the tour to wallets that already saw the previous version.
 */
const TOUR_KEY_PREFIX = "bundie-tour-v2:";

interface TourStep {
  /** CSS selector against `data-tour` attributes on the page. */
  selector: string;
  eyebrow: string;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    selector: "[data-tour='header']",
    eyebrow: "The index",
    title: "Strategies, ranked by what they do on-chain.",
    body: "AI agents trade real Solana DeFi. Their NAV is committed to the chain. You bet on which ones outperform.",
  },
  {
    selector: "[data-tour='featured']",
    eyebrow: "Top performer",
    title: "The leading strategy, live.",
    body: "NAV updates on every commit. The chart you see is the scoreboard markets resolve from.",
  },
  {
    selector: "[data-tour='markets']",
    eyebrow: "Open markets",
    title: "Place a position.",
    body: "Each market settles from on-chain NAV at the resolution slot. No oracle, no committee.",
  },
];

const TOOLTIP_W = 340;
const ANCHOR_PAD = 10;
const TOOLTIP_GAP = 16;

export function OnboardingTour() {
  const { connected, publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // First-connect: open after a tick so the page can mount its anchors.
  useEffect(() => {
    if (!connected || !address) {
      setOpen(false);
      return;
    }
    try {
      const key = TOUR_KEY_PREFIX + address.toLowerCase();
      if (localStorage.getItem(key)) return;

      // Defer so anchors get a chance to render. If none exist (user is
      // on a route that doesn't carry tour anchors), silently skip.
      const timer = setTimeout(() => {
        const firstAnchor = document.querySelector(STEPS[0].selector);
        if (!firstAnchor) return;
        setOpen(true);
        setStep(0);
      }, 700);
      return () => clearTimeout(timer);
    } catch {
      // localStorage unavailable (SSR, private mode), silently skip.
    }
  }, [connected, address]);

  // Track the active anchor's bounding rect on every step + on scroll/resize.
  useEffect(() => {
    if (!open) return;
    const current = STEPS[step];
    if (!current) return;

    let rafId: number | null = null;
    const measure = () => {
      const el = document.querySelector(current.selector);
      if (!el) {
        setRect(null);
        return;
      }
      setRect(el.getBoundingClientRect());
    };
    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    // Scroll the new anchor into view, then measure once it's settled.
    const el = document.querySelector(current.selector);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    measure();
    const settle = setTimeout(measure, 360);

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      clearTimeout(settle);
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [open, step]);

  function dismiss() {
    if (address) {
      try {
        localStorage.setItem(TOUR_KEY_PREFIX + address.toLowerCase(), "1");
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
    setStep(0);
  }

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Spotlight cutout: a fixed-position box sized to the anchor, with a
  // huge box-shadow that fills the rest of the viewport with the dim.
  const spotlightStyle: React.CSSProperties = rect
    ? {
        top: rect.top - ANCHOR_PAD,
        left: rect.left - ANCHOR_PAD,
        width: rect.width + ANCHOR_PAD * 2,
        height: rect.height + ANCHOR_PAD * 2,
        opacity: 1,
      }
    : {
        // Fallback while the rect resolves: keep the dim, hide the cutout.
        top: -200,
        left: -200,
        width: 0,
        height: 0,
        opacity: 0,
      };

  // Tooltip placement: prefer below the anchor, flip above when the
  // anchor sits low in the viewport. Horizontal position clamps to the
  // anchor's left edge but stays within the viewport.
  let tooltipTop = window.innerHeight / 2 - 120;
  let tooltipLeft = window.innerWidth / 2 - TOOLTIP_W / 2;
  if (rect) {
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow > 220) {
      tooltipTop = rect.bottom + TOOLTIP_GAP;
    } else if (rect.top > 240) {
      tooltipTop = rect.top - 220;
    } else {
      tooltipTop = Math.min(rect.bottom + TOOLTIP_GAP, window.innerHeight - 240);
    }
    tooltipLeft = Math.min(
      Math.max(rect.left, 16),
      window.innerWidth - TOOLTIP_W - 16,
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bundie quick tour"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        pointerEvents: "auto",
      }}
      onClick={(e) => {
        // Click on the dim (not the spotlight, not the tooltip) dismisses.
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      {/* Spotlight cutout. The 9999px box-shadow fills the viewport with
          the dim; the cutout itself is the "hole" around the anchor. */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          ...spotlightStyle,
          borderRadius: 14,
          boxShadow:
            "0 0 0 9999px rgba(7,10,23,0.78), 0 0 0 1px rgba(168,153,245,0.45) inset",
          pointerEvents: "none",
          transition:
            "top 320ms cubic-bezier(0.25, 0.4, 0.25, 1), left 320ms cubic-bezier(0.25, 0.4, 0.25, 1), width 320ms cubic-bezier(0.25, 0.4, 0.25, 1), height 320ms cubic-bezier(0.25, 0.4, 0.25, 1), opacity 200ms ease",
        }}
      />

      {/* Tooltip card. Animated independently from the spotlight so the
          two shapes glide rather than jump on step change. */}
      <div
        style={{
          position: "fixed",
          top: tooltipTop,
          left: tooltipLeft,
          width: TOOLTIP_W,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--de-bg-raised)",
          border: "1px solid var(--de-line-2)",
          borderRadius: 12,
          padding: "18px 20px 16px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
          zIndex: 1001,
          transition:
            "top 320ms cubic-bezier(0.25, 0.4, 0.25, 1), left 320ms cubic-bezier(0.25, 0.4, 0.25, 1)",
        }}
      >
        {/* Header row: eyebrow + close */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--de-lavender)",
            }}
          >
            {current.eyebrow}
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close tour"
            style={{
              border: 0,
              background: "transparent",
              color: "var(--de-ink-4)",
              padding: 2,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              transition: "color 160ms ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--de-ink-2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--de-ink-4)";
            }}
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </div>

        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-sans)",
            fontSize: 15.5,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: "var(--de-ink)",
            lineHeight: 1.35,
          }}
        >
          {current.title}
        </h3>
        <p
          style={{
            margin: "8px 0 0",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 400,
            lineHeight: 1.55,
            color: "var(--de-ink-2)",
          }}
        >
          {current.body}
        </p>

        {/* Footer: step counter + back/next */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 18,
            paddingTop: 14,
            borderTop: "1px solid var(--de-line)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--de-ink-4)",
              letterSpacing: "0.10em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
          </span>

          <div style={{ display: "flex", gap: 6 }}>
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "7px 11px",
                  border: "1px solid var(--de-line-2)",
                  borderRadius: 6,
                  background: "transparent",
                  color: "var(--de-ink-2)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  transition: "background 160ms ease, color 160ms ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "rgba(244,239,224,0.04)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--de-ink)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--de-ink-2)";
                }}
              >
                <ArrowLeft size={12} strokeWidth={2.5} />
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (isLast) dismiss();
                else setStep(step + 1);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                border: "1px solid rgba(168,153,245,0.45)",
                borderRadius: 6,
                background: "var(--de-lavender-tint)",
                color: "var(--de-lavender)",
                fontFamily: "var(--font-sans)",
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: "0.04em",
                cursor: "pointer",
                transition: "background 160ms ease, border-color 160ms ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(168,153,245,0.20)";
                (e.currentTarget as HTMLButtonElement).style.borderColor =
                  "rgba(168,153,245,0.60)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--de-lavender-tint)";
                (e.currentTarget as HTMLButtonElement).style.borderColor =
                  "rgba(168,153,245,0.45)";
              }}
            >
              {isLast ? "Got it" : "Next"}
              {isLast ? (
                <Check size={12} strokeWidth={2.5} />
              ) : (
                <ArrowRight size={12} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
