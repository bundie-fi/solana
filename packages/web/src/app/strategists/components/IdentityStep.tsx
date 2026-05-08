"use client";

import { useEffect, useRef } from "react";
import {
  fullSns,
  snsPrefixError,
  type WizardAction,
  type WizardState,
} from "../lib/wizard-state";
import { snsAvailable } from "../lib/api";

interface Props {
  state: WizardState;
  dispatch: (action: WizardAction) => void;
}

// Editorial press-marks. Every glyph below is part of Instrument Serif's
// real character set, so they render with consistent weight and metrics —
// unlike unicode ornaments (❖ ❦ ⁂ etc.) which silently fall back to the
// system font and arrive as off-size icon shapes.
const MARK_OPTIONS = ["&", "§", "¶", "†", "‡", "*", "·", "—"];

export function IdentityStep({ state, dispatch }: Props) {
  const { identity } = state;
  // Don't surface the "pick a name" error until the user touches the field.
  // Empty-state red copy is hostile and clashes with the editorial tone.
  const prefixErr = identity.snsPrefix ? snsPrefixError(identity.snsPrefix) : null;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced uniqueness check whenever the prefix is valid.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (prefixErr) return;
    dispatch({ type: "IDENTITY/CHECK_START" });
    debounceRef.current = setTimeout(async () => {
      try {
        const ok = await snsAvailable(fullSns(identity.snsPrefix));
        // In production snsAvailable fails-closed: a `false` here can
        // mean either "taken" or "backend down". We can't distinguish
        // from this layer, so surface a softer copy in prod and let the
        // backend reject on POST as the ground truth.
        const isProd = process.env.NODE_ENV === "production";
        dispatch({
          type: "IDENTITY/CHECK_DONE",
          available: ok,
          error: ok
            ? null
            : isProd
              ? "Couldn't verify uniqueness, try again."
              : "That SNS is already taken.",
        });
      } catch (e) {
        dispatch({
          type: "IDENTITY/CHECK_DONE",
          available: null,
          error: e instanceof Error ? e.message : "uniqueness check failed",
        });
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.snsPrefix, prefixErr]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Header
        eyebrow="Step 1 / 5"
        title="Pick a name."
        sub="Your strategy gets a real .bundie.sol identity. You can rename later, but the SNS sticks."
      />

      {/* SNS prefix */}
      <Field
        label="SNS handle"
        hint={`Will register as ${fullSns(identity.snsPrefix || "<your-name>")}`}
      >
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <input
            className="de-input"
            value={identity.snsPrefix}
            onChange={(e) =>
              dispatch({
                type: "IDENTITY/SET_PREFIX",
                value: e.target.value.toLowerCase(),
              })
            }
            placeholder="alice"
            spellCheck={false}
            autoComplete="off"
          />
          <span style={suffixStyle}>.bundie.sol</span>
        </div>
        <ValidationLine
          error={prefixErr || identity.snsError}
          ok={
            !prefixErr &&
            !identity.snsChecking &&
            identity.snsAvailable === true
              ? "Available."
              : null
          }
          checking={identity.snsChecking}
        />
      </Field>

      {/* Display name */}
      <Field label="Display name">
        <input
          className="de-input"
          value={identity.displayName}
          onChange={(e) =>
            dispatch({
              type: "IDENTITY/SET_DISPLAY_NAME",
              value: e.target.value,
            })
          }
          placeholder="Alice the Allocator"
          maxLength={48}
        />
      </Field>

      {/* Tagline */}
      <Field label="Tagline (optional)" hint="One line. Shown on the home feed.">
        <input
          className="de-input"
          value={identity.tagline}
          onChange={(e) =>
            dispatch({
              type: "IDENTITY/SET_TAGLINE",
              value: e.target.value,
            })
          }
          placeholder="Hunts the freshest Kamino reserves."
          maxLength={120}
        />
      </Field>

      {/* Press-mark */}
      <Field label="Mark" hint="A press-mark stands in for an avatar — set in italic serif.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {MARK_OPTIONS.map((mark) => {
            const active = identity.emoji === mark;
            return (
              <button
                key={mark}
                type="button"
                aria-label={`Mark ${mark}`}
                aria-pressed={active}
                onClick={() =>
                  dispatch({ type: "IDENTITY/SET_EMOJI", value: mark })
                }
                style={{
                  width: 52,
                  height: 52,
                  border: "1px solid",
                  borderColor: active ? "var(--de-lavender)" : "var(--de-line-2)",
                  background: active ? "var(--de-lavender-tint)" : "transparent",
                  borderRadius: 0,
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: 28,
                  lineHeight: 1,
                  color: active ? "var(--de-ink)" : "var(--de-ink-2)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingBottom: 4,
                  transition:
                    "border-color 160ms ease, background 160ms ease, color 160ms ease",
                }}
              >
                {mark}
              </button>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

// ── Local UI bits (kept inline so step files stay self-contained) ──────────

export function Header({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <div>
      <div
        style={{
          marginBottom: 8,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          color: "var(--de-ink-3)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 36,
          lineHeight: 1.05,
          color: "var(--de-ink)",
          marginBottom: 10,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--de-ink-3)",
          maxWidth: 560,
        }}
      >
        {sub}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          color: "var(--de-ink-3)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--de-ink-4)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

const suffixStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  // Match `.de-input` exactly so the two underlines read as one continuous
  // hairline. Same height, same border, same padding scale.
  height: 48,
  paddingLeft: 6,
  borderRadius: 0,
  border: "none",
  borderBottom: "1px solid var(--de-line-3)",
  background: "transparent",
  color: "var(--de-ink-2)",
  fontFamily: "var(--font-display)",
  fontSize: 19,
  fontStyle: "italic",
  letterSpacing: "0.01em",
  whiteSpace: "nowrap",
};

function ValidationLine({
  error,
  ok,
  checking,
}: {
  error: string | null;
  ok: string | null;
  checking: boolean;
}) {
  const base: React.CSSProperties = {
    fontSize: 11.5,
    fontFamily: "var(--font-sans)",
    letterSpacing: "0.02em",
  };
  if (checking) {
    return <div style={{ ...base, color: "var(--de-ink-4)" }}>Checking availability…</div>;
  }
  if (error) {
    return <div style={{ ...base, color: "var(--de-rose)" }}>{error}</div>;
  }
  if (ok) {
    return <div style={{ ...base, color: "var(--de-mint)" }}>{ok}</div>;
  }
  return null;
}
