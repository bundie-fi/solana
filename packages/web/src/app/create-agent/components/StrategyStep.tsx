"use client";

import {
  PRESETS,
  type Preset,
  type WizardAction,
  type WizardState,
} from "../lib/wizard-state";
import { Field, Header } from "./IdentityStep";

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
        sub="Presets seed your agent's brain.md. Power users can edit raw markdown below."
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
          border: "1px solid var(--line-1)",
          background: "var(--bg-1)",
          borderRadius: 10,
          padding: "10px 14px",
        }}
      >
        <summary
          className="mono"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: "var(--fg-3)",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          Edit raw brain.md (advanced)
        </summary>
        <textarea
          value={strategy.customBrainMd}
          onChange={(e) =>
            dispatch({ type: "STRATEGY/SET_BRAIN", value: e.target.value })
          }
          placeholder={`# My agent\n\nFreeform notes the agent reads on every tick…`}
          rows={10}
          style={{
            marginTop: 10,
            width: "100%",
            padding: 10,
            border: "1px solid var(--line-1)",
            background: "var(--bg-2)",
            borderRadius: 8,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--fg-0)",
            resize: "vertical",
            outline: "none",
          }}
        />
        <div className="dim mono-tiny" style={{ marginTop: 6, fontSize: 10.5 }}>
          Overrides the preset blurb in the generated brain.md.
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
      style={{
        textAlign: "left",
        padding: 14,
        background: active ? "var(--gold-tint)" : "var(--bg-1)",
        border: "1px solid",
        borderColor: active ? "var(--gold)" : "var(--line-1)",
        borderRadius: 10,
        cursor: "pointer",
        transition: "border-color 160ms ease, background 160ms ease",
        display: "flex",
        flexDirection: "column",
        gap: 4,
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
          className="mono"
          style={{
            fontSize: 13,
            color: active ? "var(--gold)" : "var(--fg-0)",
            fontWeight: 600,
          }}
        >
          {preset.label}
        </div>
        <div
          aria-hidden
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: "2px solid",
            borderColor: active ? "var(--gold)" : "var(--line-2)",
            background: active ? "var(--gold)" : "transparent",
            transition: "all 160ms ease",
          }}
        />
      </div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
        {preset.blurb}
      </div>
    </button>
  );
}
