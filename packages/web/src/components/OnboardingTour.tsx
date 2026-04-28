"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";

/**
 * First-connect onboarding tour.
 *
 * Trigger: opens the first time a wallet connects on this browser. The
 * dismissal flag lives in localStorage keyed by lowercased address so each
 * wallet on the same machine sees the tour exactly once. Dialog uses a
 * minimal in-file modal — Radix dialog isn't on this app's dep tree and
 * onboarding doesn't justify pulling it in.
 */
const TOUR_KEY_PREFIX = "bundie-tour-v1:";

interface TourStep {
  eyebrow: string;
  title: string;
  body: string;
  art: string;
  /** When set, the primary action navigates here on click. */
  href?: string;
  /** Override for the primary button label. */
  actionLabel?: string;
}

const STEPS: TourStep[] = [
  {
    eyebrow: "Welcome",
    title: "Bundie in one line",
    body: "Bundie allows anyone to launch AI agents that trade DeFi strategies for humans to predict on. Agents run live on Solana, NAV is on-chain, and prediction markets self-resolve from the data.",
    art: "🤖",
  },
  {
    eyebrow: "Step 01",
    title: "Bet on agents",
    body: "Open a position on whichever AI agent you think will outperform. Markets price each outcome with an LS-LMSR AMM and settle from on-chain NAV — no oracle in the resolution path.",
    art: "📊",
    href: "/markets",
    actionLabel: "Browse markets",
  },
  {
    eyebrow: "Step 02",
    title: "Or launch your own",
    body: "Pick a .sol name, choose a preset, allow-list the protocols it can touch, and ship it. Your agent trades on a surfpool mainnet fork; NAV commits back to devnet for the markets to read.",
    art: "🚀",
    href: "/create-agent",
    actionLabel: "Launch an agent",
  },
  {
    eyebrow: "Step 03",
    title: "Get test funds",
    body: "Inside the launch wizard, Step 4 drips $50 of bUSD straight to your wallet. One-shot per day, no signup. You sign one transfer and the agent's vault is seeded.",
    art: "💰",
  },
  {
    eyebrow: "Step 04",
    title: "Watch your portfolio",
    body: "Your agents and your positions sit on the portfolio page. NAV ticks update live, and any prediction market open against your agent shows up there too.",
    art: "📈",
    href: "/portfolio",
    actionLabel: "Open portfolio",
  },
];

export function OnboardingTour() {
  const { connected, publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!connected || !address) {
      setOpen(false);
      return;
    }
    try {
      const key = TOUR_KEY_PREFIX + address.toLowerCase();
      if (!localStorage.getItem(key)) {
        setOpen(true);
        setStep(0);
      }
    } catch {
      // localStorage unavailable (SSR, private mode) — silently skip.
    }
  }, [connected, address]);

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

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Primary action: navigate (if href) and either advance or dismiss.
  function handlePrimary() {
    if (current.href) {
      router.push(current.href);
    }
    if (isLast) {
      dismiss();
    } else {
      setStep((s) => s + 1);
    }
  }

  if (!open) return null;

  const primaryLabel =
    current.actionLabel ?? (isLast ? "Get started" : "Next");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bundie onboarding tour"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(22,22,24,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--bg-1)",
          border: "1px solid var(--line-1)",
          borderRadius: "var(--r-5)",
          boxShadow: "0 24px 64px rgba(22,22,24,0.18)",
          padding: "26px 26px 22px",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <span
            className="bd-eyebrow"
            style={{
              fontSize: 11,
              letterSpacing: "0.22em",
              color: "var(--gold)",
              textTransform: "uppercase",
            }}
          >
            {current.eyebrow}
          </span>
          <button
            type="button"
            onClick={dismiss}
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              color: "var(--fg-3)",
              textTransform: "uppercase",
              background: "transparent",
              border: 0,
              cursor: "pointer",
            }}
          >
            Skip
          </button>
        </div>

        {/* Art panel — emoji glyph on a tinted card. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 140,
            marginBottom: 22,
            background: "var(--gold-tint)",
            border: "1px solid var(--line-1)",
            borderRadius: "var(--r-4)",
            fontSize: 64,
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          {current.art}
        </div>

        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 24,
            lineHeight: 1.15,
            color: "var(--fg-0)",
            margin: 0,
          }}
        >
          {current.title}
        </h2>
        <p
          style={{
            marginTop: 8,
            fontSize: 13.5,
            lineHeight: 1.55,
            color: "var(--fg-3)",
          }}
        >
          {current.body}
        </p>

        {/* Progress dots */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            marginTop: 22,
          }}
        >
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              style={{
                width: i === step ? 24 : 6,
                height: 6,
                borderRadius: 999,
                background:
                  i === step
                    ? "var(--gold)"
                    : i < step
                      ? "var(--gold-2)"
                      : "var(--line-2)",
                opacity: i < step ? 0.6 : 1,
                border: 0,
                cursor: "pointer",
                transition: "width 200ms var(--ease)",
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 20,
          }}
        >
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{
              padding: "10px 16px",
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: "var(--r-3)",
              border: "1px solid var(--line-2)",
              background: "transparent",
              color: step === 0 ? "var(--fg-5)" : "var(--fg-1)",
              cursor: step === 0 ? "not-allowed" : "pointer",
            }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={handlePrimary}
            style={{
              flex: 1,
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 700,
              borderRadius: "var(--r-3)",
              border: 0,
              background: "var(--gold)",
              color: "var(--bg-1)",
              cursor: "pointer",
            }}
          >
            {primaryLabel}
            {isLast ? " ✓" : " →"}
          </button>
        </div>
      </div>
    </div>
  );
}
