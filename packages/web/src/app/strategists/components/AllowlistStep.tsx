"use client";

import {
  ALL_PROTOCOLS,
  type Protocol,
  type WizardAction,
  type WizardState,
} from "../lib/wizard-state";
import { Header } from "./IdentityStep";

interface Props {
  state: WizardState;
  dispatch: (action: WizardAction) => void;
}

const MIN_CAP = 10;
const MAX_CAP = 50;

export function AllowlistStep({ state, dispatch }: Props) {
  const { allowlist } = state;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Header
        eyebrow="Step 3 / 5"
        title="Choose protocols."
        sub="The strategy can only ever route through programs you check here. Caps are per-position notional in USD."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ALL_PROTOCOLS.map((p) => {
          const enabled = allowlist.protocols.includes(p.id);
          const cap = allowlist.limits[p.id]?.maxNotionalUsd ?? 25;
          return (
            <ProtocolRow
              key={p.id}
              id={p.id}
              label={p.label}
              tag={p.tag}
              enabled={enabled}
              cap={cap}
              onToggle={(on) =>
                dispatch({
                  type: "ALLOWLIST/TOGGLE",
                  protocol: p.id,
                  enabled: on,
                })
              }
              onCapChange={(value) =>
                dispatch({
                  type: "ALLOWLIST/SET_LIMIT",
                  protocol: p.id,
                  maxNotionalUsd: value,
                })
              }
            />
          );
        })}
      </div>

      <div
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--de-ink-4)",
        }}
      >
        At least one protocol must be enabled. Per-position caps default to $25
        and can be tuned $10–$50.
      </div>
    </div>
  );
}

function ProtocolRow({
  id,
  label,
  tag,
  enabled,
  cap,
  onToggle,
  onCapChange,
}: {
  id: Protocol;
  label: string;
  tag: string;
  enabled: boolean;
  cap: number;
  onToggle: (enabled: boolean) => void;
  onCapChange: (cap: number) => void;
}) {
  return (
    <div
      style={{
        padding: "14px 18px",
        background: enabled ? "var(--de-lavender-tint)" : "var(--de-bg-raised)",
        border: "1px solid",
        borderColor: enabled ? "var(--de-lavender)" : "var(--de-line-2)",
        borderRadius: 2,
        transition: "border-color 160ms ease, background 160ms ease",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          style={{
            width: 16,
            height: 16,
            accentColor: "var(--de-lavender)",
          }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 19,
              color: enabled ? "var(--de-ink)" : "var(--de-ink-2)",
              letterSpacing: "-0.005em",
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--de-ink-4)",
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              marginTop: 2,
            }}
          >
            {tag}
          </div>
        </div>
        <span
          style={{
            minWidth: 64,
            display: "inline-flex",
            justifyContent: "center",
            padding: "4px 10px",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            color: enabled ? "var(--de-lavender)" : "var(--de-ink-3)",
            background: enabled ? "transparent" : "transparent",
            border: "1px solid",
            borderColor: enabled ? "var(--de-lavender)" : "var(--de-line-2)",
            borderRadius: 999,
          }}
        >
          ${cap}
        </span>
      </label>

      {enabled && (
        <CapSlider
          value={cap}
          min={MIN_CAP}
          max={MAX_CAP}
          step={5}
          onChange={onCapChange}
          ariaLabel={`${label} max position`}
        />
      )}
      {/* keep id in dom for testability */}
      <span hidden data-protocol={id} />
    </div>
  );
}

/**
 * Editorial cap slider. Native range under the hood — the visual is just
 * a hairline that fills lavender from the min to the thumb, plus a serif
 * `$N` numeral that floats above and travels with the thumb. Position is
 * driven by a `--pct` CSS custom property kept in sync with `value`, so
 * the fill and the numeral stay glued through every drag tick.
 */
function CapSlider({
  value,
  min,
  max,
  step,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginTop: 18 }}>
      <div
        className="de-range-wrap"
        style={{ ["--pct" as string]: `${pct}%` }}
      >
        <span className="de-range-readout" aria-hidden>
          ${value}
        </span>
        <input
          type="range"
          className="de-range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={ariaLabel}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "var(--de-ink-5)",
          marginTop: 10,
          fontFamily: "var(--font-sans)",
          textTransform: "uppercase",
          letterSpacing: "0.18em",
        }}
      >
        <span>min ${min}</span>
        <span>max ${max}</span>
      </div>
    </div>
  );
}
