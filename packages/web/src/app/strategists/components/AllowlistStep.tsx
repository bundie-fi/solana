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
        className="muted"
        style={{ fontSize: 11.5, lineHeight: 1.5 }}
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
        padding: 12,
        background: enabled ? "var(--bg-1)" : "var(--bg-3)",
        border: "1px solid",
        borderColor: enabled ? "var(--gold)" : "var(--line-1)",
        borderRadius: 10,
        transition: "border-color 160ms ease, background 160ms ease",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: "var(--gold)" }}
        />
        <div style={{ flex: 1 }}>
          <div
            className="mono"
            style={{
              fontSize: 13,
              color: enabled ? "var(--fg-0)" : "var(--fg-3)",
              fontWeight: 600,
            }}
          >
            {label}
          </div>
          <div className="dim mono-tiny" style={{ fontSize: 10.5 }}>
            {tag}
          </div>
        </div>
        <span
          className={`pill ${enabled ? "pill-gold" : "pill-muted"}`}
          style={{ minWidth: 64, justifyContent: "center" }}
        >
          ${cap}
        </span>
      </label>

      {enabled && (
        <div style={{ marginTop: 10 }}>
          <input
            type="range"
            min={MIN_CAP}
            max={MAX_CAP}
            step={5}
            value={cap}
            onChange={(e) => onCapChange(Number(e.target.value))}
            aria-label={`${label} max position`}
            style={{
              width: "100%",
              accentColor: "var(--gold)",
            }}
          />
          <div
            className="dim mono-tiny"
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              marginTop: 2,
            }}
          >
            <span>${MIN_CAP}</span>
            <span>${MAX_CAP}</span>
          </div>
        </div>
      )}
      {/* keep id in dom for testability */}
      <span hidden data-protocol={id} />
    </div>
  );
}
