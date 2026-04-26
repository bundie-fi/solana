"use client";

import { useReducer } from "react";
import Link from "next/link";
import {
  canAdvance,
  INITIAL_STATE,
  STEP_LABELS,
  STEP_ORDER,
  wizardReducer,
  type WizardStepId,
} from "./lib/wizard-state";
import { IdentityStep } from "./components/IdentityStep";
import { StrategyStep } from "./components/StrategyStep";
import { AllowlistStep } from "./components/AllowlistStep";
import { CapitalStep } from "./components/CapitalStep";
import { ReviewStep } from "./components/ReviewStep";

/**
 * /create-agent — five-step wizard.
 *
 * Sequence: Identity → Strategy → Allowlist → Capital → Review.
 * State lives in `wizardReducer`. Each step is a presentational
 * component that reads + dispatches to the same store.
 *
 * Hard contracts:
 *   - Client component: relies on wallet adapter + tx signing.
 *   - Step indicator at the top, Back / Next at the bottom.
 *   - Final step ("Review") replaces "Next" with a "Launch agent"
 *     button (handled inside ReviewStep itself).
 */
export default function CreateAgentPage() {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_STATE);
  const stepIdx = STEP_ORDER.indexOf(state.current);
  const advanceOk = canAdvance(state);
  const isFinal = state.current === "review";

  return (
    <main
      style={{
        background: "var(--bg-0)",
        minHeight: "100vh",
        padding: "0 16px 32px",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      {/* Top crumb */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 0 12px",
        }}
      >
        <Link
          href="/"
          className="mono-tiny"
          style={{ color: "var(--fg-3)", textDecoration: "none" }}
        >
          ← Home
        </Link>
        <span className="bd-eyebrow">Create agent</span>
      </div>

      {/* Step indicator */}
      <StepIndicator current={state.current} />

      {/* Active step body */}
      <section style={{ padding: "20px 0 24px" }}>
        {state.current === "identity" && (
          <IdentityStep state={state} dispatch={dispatch} />
        )}
        {state.current === "strategy" && (
          <StrategyStep state={state} dispatch={dispatch} />
        )}
        {state.current === "allowlist" && (
          <AllowlistStep state={state} dispatch={dispatch} />
        )}
        {state.current === "capital" && (
          <CapitalStep state={state} dispatch={dispatch} />
        )}
        {state.current === "review" && (
          <ReviewStep state={state} dispatch={dispatch} />
        )}
      </section>

      {/* Footer nav (hide Next on final — Review owns its own Launch button) */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingTop: 16,
          borderTop: "1px solid var(--line-1)",
        }}
      >
        <button
          type="button"
          onClick={() => dispatch({ type: "BACK" })}
          disabled={stepIdx === 0}
          style={ghostBtnStyle({ disabled: stepIdx === 0 })}
        >
          ← Back
        </button>
        <span className="dim mono-tiny" style={{ fontSize: 10.5 }}>
          {stepIdx + 1} / {STEP_ORDER.length}
        </span>
        {!isFinal && (
          <button
            type="button"
            onClick={() => dispatch({ type: "NEXT" })}
            disabled={!advanceOk}
            style={primaryBtnStyle({ disabled: !advanceOk })}
          >
            Next →
          </button>
        )}
        {isFinal && (
          // Spacer so Back stays left-aligned on the final step.
          <span style={{ width: 96 }} />
        )}
      </footer>
    </main>
  );
}

function StepIndicator({ current }: { current: WizardStepId }) {
  const idx = STEP_ORDER.indexOf(current);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {STEP_ORDER.map((id, i) => {
        const past = i < idx;
        const active = i === idx;
        return (
          <div key={id} style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: past
                  ? "var(--gold)"
                  : active
                    ? "var(--gold-tint)"
                    : "var(--bg-3)",
                border: "1px solid",
                borderColor: active ? "var(--gold)" : "transparent",
                transition: "background 240ms ease, border-color 240ms ease",
              }}
              aria-label={STEP_LABELS[id]}
            />
          </div>
        );
      })}
    </div>
  );
}

function ghostBtnStyle({
  disabled,
}: {
  disabled?: boolean;
}): React.CSSProperties {
  return {
    height: 36,
    padding: "0 14px",
    background: "transparent",
    color: disabled ? "var(--fg-4)" : "var(--fg-2)",
    border: "1px solid var(--line-1)",
    borderRadius: 8,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    cursor: disabled ? "not-allowed" : "pointer",
    minWidth: 96,
  };
}

function primaryBtnStyle({
  disabled,
}: {
  disabled?: boolean;
}): React.CSSProperties {
  return {
    height: 36,
    padding: "0 16px",
    background: disabled ? "var(--bg-3)" : "var(--gold)",
    color: disabled ? "var(--fg-4)" : "#fff",
    border: "1px solid",
    borderColor: disabled ? "var(--line-1)" : "var(--gold)",
    borderRadius: 8,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 160ms ease, color 160ms ease",
    minWidth: 96,
  };
}
