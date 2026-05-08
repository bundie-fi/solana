"use client";

import {
  PRESETS,
  type Preset,
  type WizardAction,
  type WizardState,
} from "../lib/wizard-state";
import { Field, Header } from "./IdentityStep";

// Starter template for raw brain.md , operators kept asking "what do I put here?"
// Mirrors the structure of alice/bob/charlie's prod brain.md and shows where
// each personality knob lives (identity, allocation target, decision rules,
// kill-switch). The wizard wraps this with the allowlist + observed-state
// schema at submit time, so the operator only writes prose.
const BRAIN_MD_TEMPLATE = `You are <handle>.bundie, an autonomous DeFi agent on Solana. Your personality:

- <one-sentence identity — what you optimize for>
- <one-sentence cadence — how often you rebalance>
- <one-sentence risk posture — what you avoid>
- <strategic with markets: when to open prediction markets on your own performance>

Allocation target: <e.g. 60% stablecoin lending / 40% LST>.
  - Increase the lending leg when <signal>.
  - Increase the LST leg when <signal>.
  - Rebalance only when allocation drifts >X% from target.

Decision rules:
  - One action per tick. Prefer the action that moves allocation closest to
    target without overshooting.
  - Default to noop when drift is under threshold.
  - Hard cap: never deploy more than $<X> notional in a single tx.

Kill switch: if NAV drops more than X% in a single tick, exit all positions
into bUSD and noop until manual review.
`;

interface Props {
  state: WizardState;
  dispatch: (action: WizardAction) => void;
}

export function StrategyStep({ state, dispatch }: Props) {
  const { strategy } = state;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Header
        eyebrow="Step 2 / 5"
        title="Pick a brain."
        sub="Presets seed your strategy's brain.md. Power users can edit raw markdown below."
      />

      <Field label="Personality preset">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PRESETS.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              active={strategy.preset === p.id}
              onSelect={() =>
                dispatch({ type: "STRATEGY/SET_PRESET", preset: p.id })
              }
            />
          ))}
        </div>
      </Field>

      <details
        open={strategy.showCustomBrain}
        onToggle={(e) =>
          dispatch({
            type: "STRATEGY/TOGGLE_CUSTOM",
            show: (e.target as HTMLDetailsElement).open,
          })
        }
        style={{
          border: "1px solid var(--de-line-2)",
          background: "var(--de-bg-raised)",
          borderRadius: 2,
          padding: "12px 16px",
        }}
      >
        <summary
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: "var(--de-ink-3)",
            cursor: "pointer",
            userSelect: "none",
            fontFamily: "var(--font-sans)",
          }}
        >
          Edit raw brain.md (advanced)
        </summary>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: 12,
            marginBottom: 8,
          }}
        >
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "STRATEGY/SET_BRAIN",
                value: BRAIN_MD_TEMPLATE,
              })
            }
            style={{
              fontSize: 10.5,
              padding: "6px 12px",
              border: "1px solid var(--de-line-2)",
              background: "transparent",
              borderRadius: 0,
              color: "var(--de-ink-2)",
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            Load template
          </button>
        </div>

        <textarea
          className="de-textarea"
          value={strategy.customBrainMd}
          onChange={(e) =>
            dispatch({ type: "STRATEGY/SET_BRAIN", value: e.target.value })
          }
          placeholder={BRAIN_MD_TEMPLATE}
          rows={18}
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
            fontSize: 12.5,
          }}
        />
        <div
          style={{
            marginTop: 8,
            fontSize: 11.5,
            color: "var(--de-ink-4)",
            lineHeight: 1.5,
          }}
        >
          Overrides the preset blurb. The wizard wraps your text with the
          allowlist + observed-state schema the daemon injects every tick;
          you only write the personality + decision rules.
        </div>
      </details>
    </div>
  );
}

function PresetCard({
  preset,
  active,
  onSelect,
}: {
  preset: { id: Preset; label: string; blurb: string };
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`de-card${active ? " is-active" : ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 19,
            color: "var(--de-ink)",
            letterSpacing: "-0.005em",
          }}
        >
          {preset.label}
        </div>
        <div
          aria-hidden
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "1px solid",
            borderColor: active ? "var(--de-lavender)" : "var(--de-line-3)",
            background: active ? "var(--de-lavender)" : "transparent",
            transition: "all 160ms ease",
          }}
        />
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--de-ink-3)",
        }}
      >
        {preset.blurb}
      </div>
    </button>
  );
}
