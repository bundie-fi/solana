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

const EMOJI_OPTIONS = ["🤖", "🧠", "📈", "🦾", "🌊", "🛰️", "🔮", "🐺"];

export function IdentityStep({ state, dispatch }: Props) {
  const { identity } = state;
  const prefixErr = snsPrefixError(identity.snsPrefix);
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
              ? "Couldn't verify uniqueness , try again."
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
        sub="Your agent gets a real .bundie.sol identity. You can rename later, but the SNS sticks."
      />

      {/* SNS prefix */}
      <Field
        label="SNS handle"
        hint={`Will register as ${fullSns(identity.snsPrefix || "<your-name>")}`}
      >
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <input
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
            style={inputStyle({ rounded: "left" })}
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
          value={identity.displayName}
          onChange={(e) =>
            dispatch({
              type: "IDENTITY/SET_DISPLAY_NAME",
              value: e.target.value,
            })
          }
          placeholder="Alice the Allocator"
          maxLength={48}
          style={inputStyle({})}
        />
      </Field>

      {/* Tagline */}
      <Field label="Tagline (optional)" hint="One line. Shown on the home feed.">
        <input
          value={identity.tagline}
          onChange={(e) =>
            dispatch({
              type: "IDENTITY/SET_TAGLINE",
              value: e.target.value,
            })
          }
          placeholder="Hunts the freshest Kamino reserves."
          maxLength={120}
          style={inputStyle({})}
        />
      </Field>

      {/* Emoji */}
      <Field label="Avatar emoji">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {EMOJI_OPTIONS.map((e) => {
            const active = identity.emoji === e;
            return (
              <button
                key={e}
                type="button"
                onClick={() =>
                  dispatch({ type: "IDENTITY/SET_EMOJI", value: e })
                }
                style={{
                  width: 44,
                  height: 44,
                  border: "1px solid",
                  borderColor: active ? "var(--gold)" : "var(--line-1)",
                  background: active ? "var(--gold-tint)" : "var(--bg-1)",
                  borderRadius: 10,
                  fontSize: 22,
                  cursor: "pointer",
                  transition: "border-color 160ms ease, background 160ms ease",
                }}
              >
                {e}
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
      <div className="bd-eyebrow" style={{ marginBottom: 6 }}>
        {eyebrow}
      </div>
      <div
        className="section-title"
        style={{ fontSize: 24, marginBottom: 6 }}
      >
        {title}
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        className="mono"
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.16em",
          color: "var(--fg-3)",
        }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <div className="dim mono-tiny" style={{ fontSize: 10.5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function inputStyle({
  rounded,
}: {
  rounded?: "left" | "right";
}): React.CSSProperties {
  return {
    flex: 1,
    width: "100%",
    height: 42,
    padding: "0 12px",
    borderRadius:
      rounded === "left"
        ? "8px 0 0 8px"
        : rounded === "right"
          ? "0 8px 8px 0"
          : 8,
    border: "1px solid var(--line-1)",
    borderRight: rounded === "left" ? "none" : "1px solid var(--line-1)",
    background: "var(--bg-1)",
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    color: "var(--fg-0)",
    outline: "none",
  };
}

const suffixStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0 12px",
  height: 42,
  borderRadius: "0 8px 8px 0",
  border: "1px solid var(--line-1)",
  background: "var(--bg-3)",
  color: "var(--fg-3)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  letterSpacing: "0.04em",
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
  if (checking) {
    return (
      <div className="dim mono-tiny" style={{ fontSize: 10.5 }}>
        Checking availability…
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="mono-tiny"
        style={{ color: "var(--red-2)", fontSize: 10.5 }}
      >
        {error}
      </div>
    );
  }
  if (ok) {
    return (
      <div
        className="mono-tiny"
        style={{ color: "var(--green-2)", fontSize: 10.5 }}
      >
        {ok}
      </div>
    );
  }
  return null;
}
