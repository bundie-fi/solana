"use client";

import { Suspense, useEffect, useReducer, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { BUSD_MINT } from "@bundie/common";
import {
  canAdvance,
  INITIAL_STATE,
  STEP_LABELS,
  STEP_ORDER,
  wizardReducer,
  type Preset,
  type Protocol,
  type WizardStepId,
} from "./lib/wizard-state";
import { fetchAgent } from "./lib/api";
import { IdentityStep } from "./components/IdentityStep";
import { StrategyStep } from "./components/StrategyStep";
import { AllowlistStep } from "./components/AllowlistStep";
import { CapitalStep } from "./components/CapitalStep";
import { ReviewStep } from "./components/ReviewStep";

/**
 * /create-agent , five-step wizard.
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
  // useSearchParams suspends in Next 14 , wrap the body in Suspense so
  // the whole page doesn't deopt to fully client-rendered.
  return (
    <Suspense fallback={null}>
      <CreateAgentBody />
    </Suspense>
  );
}

function CreateAgentBody() {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_STATE);
  const searchParams = useSearchParams();
  const { publicKey } = useWallet();
  const resumeSns = searchParams.get("resume");
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeLoading, setResumeLoading] = useState(Boolean(resumeSns));

  // Resume flow: when the URL has `?resume=<sns>`, fetch the row and
  // hydrate the wizard. We bail (and let the user create fresh) if the
  // row doesn't exist, isn't owned by the connected wallet, or is no
  // longer pending. Skipping the wallet check would let anyone with a
  // SNS string land on Step 5 of someone else's pending agent.
  useEffect(() => {
    if (!resumeSns) return;
    if (!publicKey) return; // wait for wallet connect
    let cancelled = false;
    (async () => {
      setResumeLoading(true);
      const row = await fetchAgent(resumeSns);
      if (cancelled) return;
      if (!row) {
        setResumeError(`No agent found for ${resumeSns}.`);
        setResumeLoading(false);
        return;
      }
      if (row.owner_wallet !== publicKey.toBase58()) {
        setResumeError(
          `${resumeSns} is owned by a different wallet , connect that wallet to resume.`,
        );
        setResumeLoading(false);
        return;
      }
      if (row.status !== "pending_init") {
        setResumeError(
          `${resumeSns} is already ${row.status} , nothing to resume.`,
        );
        setResumeLoading(false);
        return;
      }
      const prefix = row.sns.replace(/\.bundie\.sol$/, "");
      dispatch({
        type: "RESUME/HYDRATE",
        identity: {
          snsPrefix: prefix,
          displayName: row.display_name ?? "",
          emoji: row.emoji ?? "🤖",
          tagline: row.tagline ?? "",
          // SNS is already taken by us , skip the uniqueness UI entirely.
          snsAvailable: true,
          snsChecking: false,
          snsError: null,
        },
        strategy: {
          preset: row.preset as Preset,
          customBrainMd: row.brain_md ?? "",
          // Don't auto-show the textarea , saved brain_md is shown on
          // Review's preview pane already.
          showCustomBrain: false,
        },
        // We don't have the per-protocol limits broken out in the row
        // (policies_yaml carries them) , for resume mode the wizard
        // doesn't re-send them; ReviewStep skips createAgent. So a
        // best-effort allowlist (parsed below) is enough for the summary.
        allowlist: {
          protocols: parseAllowedProtocolsFromYaml(row.policies_yaml),
          limits: {},
        },
        resume: {
          sns: row.sns,
          ownerWallet: row.owner_wallet,
          vaultPda: row.vault_pda,
          agentPubkey: row.agent_pubkey,
          treasuryMint: BUSD_MINT,
          seedAmountBase: Number(row.seed_amount_busd),
        },
      });
      setResumeLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeSns, publicKey]);

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

      {resumeSns && (
        <ResumeBanner
          sns={resumeSns}
          loading={resumeLoading}
          error={resumeError}
          active={state.resume?.sns === resumeSns}
        />
      )}

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

      {/* Footer nav (hide Next on final , Review owns its own Launch button) */}
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

/**
 * Parse the allowed_mints / per-protocol caps out of a saved policies.yaml
 * is more work than this UI needs. Instead, scan the `program_allowlist`
 * block , every protocol we support carries a fixed program_id, so the
 * presence of that pubkey in the YAML tells us which protocols are on.
 *
 * Used only for the Review summary pills in resume mode; the actual
 * on-chain enforcement still lives in policies.yaml on the backend.
 */
function parseAllowedProtocolsFromYaml(yaml: string): Protocol[] {
  if (!yaml) return [];
  const known: Record<string, Protocol> = {
    KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD: "kamino",
    MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA: "marginfi",
    So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo: "solend",
    MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD: "marinade",
    SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy: "jito",
    ZETAxsqBRek56DhiGXrn75yj2NHU3aYUnxvHXpkf3aD: "zeta",
  };
  const out = new Set<Protocol>();
  for (const [pid, proto] of Object.entries(known)) {
    if (yaml.includes(pid)) out.add(proto);
  }
  return Array.from(out);
}

function ResumeBanner({
  sns,
  loading,
  error,
  active,
}: {
  sns: string;
  loading: boolean;
  error: string | null;
  active: boolean;
}) {
  const tone = error
    ? { bg: "var(--red-tint)", border: "rgba(239,68,68,0.24)", fg: "var(--red-2)" }
    : active
      ? { bg: "var(--gold-tint)", border: "var(--gold)", fg: "var(--gold)" }
      : { bg: "var(--bg-2)", border: "var(--line-1)", fg: "var(--fg-2)" };
  return (
    <div
      role="status"
      style={{
        marginBottom: 12,
        padding: "10px 12px",
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
        fontSize: 11.5,
        color: tone.fg,
        fontFamily: "var(--font-mono)",
      }}
    >
      {error ? (
        <>⚠ {error}</>
      ) : loading ? (
        <>Loading {sns}…</>
      ) : active ? (
        <>↪ Resuming {sns} , sign the deposit on Step 5 to finish.</>
      ) : (
        <>Connect the owner wallet to resume {sns}.</>
      )}
    </div>
  );
}

function StepIndicator({ current }: { current: WizardStepId }) {
  const idx = STEP_ORDER.indexOf(current);
  return (
    <div
      role="progressbar"
      aria-valuenow={idx + 1}
      aria-valuemin={1}
      aria-valuemax={STEP_ORDER.length}
      aria-label="Wizard progress"
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
              {...(active ? { "aria-current": "step" as const } : {})}
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
