"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BUSD_MINT } from "@bundie/common";
import {
  fullSns,
  generateBrainPreview,
  PRESETS,
  type LaunchStage,
  type WizardAction,
  type WizardState,
} from "../lib/wizard-state";
import {
  confirmInit,
  createAgent,
  type CreateAgentRequest,
} from "../lib/api";
import { launchAgent } from "../lib/transactions";
import { Header } from "./IdentityStep";

interface Props {
  state: WizardState;
  dispatch: (action: WizardAction) => void;
}

export function ReviewStep({ state, dispatch }: Props) {
  const { identity, strategy, allowlist, capital, launch } = state;
  const router = useRouter();
  const { publicKey, connected, sendTransaction, signTransaction, wallet } =
    useWallet();
  const { connection } = useConnection();

  const sns = fullSns(identity.snsPrefix);
  const presetMeta = PRESETS.find((p) => p.id === strategy.preset);
  const brainPreview = useMemo(() => generateBrainPreview(state), [state]);

  // Resume mode skips Step 4, so capital.busdBalance is null and the
  // Launch button would stay disabled forever. Read the balance directly
  // here so the gate works the same as it does after the normal flow.
  useEffect(() => {
    if (!state.resume) return;
    if (!publicKey || !connected) return;
    if (capital.busdBalance != null) return;
    let cancelled = false;
    (async () => {
      try {
        const ata = getAssociatedTokenAddressSync(
          new PublicKey(BUSD_MINT),
          publicKey,
          false,
        );
        const info = await connection.getTokenAccountBalance(ata);
        if (!cancelled) {
          dispatch({
            type: "CAPITAL/SET_BALANCE",
            value: info.value.uiAmount ?? 0,
          });
        }
      } catch {
        if (!cancelled) {
          dispatch({ type: "CAPITAL/SET_BALANCE", value: 0 });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    state.resume,
    publicKey,
    connected,
    connection,
    capital.busdBalance,
    dispatch,
  ]);

  const launching = launch.stage !== null && launch.stage !== "done";
  const done = launch.stage === "done";
  // Recovery UI fires whenever the launch errored after we got a deposit
  // signature back. Two distinct cases live underneath:
  //   (a) tx confirmed → confirmInit failed → true orphan; retry confirmInit
  //   (b) tx never landed (dropped, blockhash expired) → re-broadcast deposit
  // We disambiguate via an on-chain treasury balance read below.
  const recoveryNeeded =
    !!launch.error && !!launch.depositTxSig && !done;

  // null = haven't checked / not in recovery; true = treasury holds the
  // seed; false = treasury still empty (deposit didn't actually land).
  const [treasuryFunded, setTreasuryFunded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!recoveryNeeded) {
      setTreasuryFunded(null);
      return;
    }
    const vaultPda = state.resume?.vaultPda;
    if (!vaultPda) {
      // Fresh-mode case, vaultPda lives in the createAgent response,
      // which onLaunch holds in a closure. Without it we can't check
      // on-chain. Surface as null and fall through to the legacy
      // "Retry registration" button (matches prior behaviour).
      setTreasuryFunded(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const treasuryAta = getAssociatedTokenAddressSync(
          new PublicKey(BUSD_MINT),
          new PublicKey(vaultPda),
          true,
        );
        const info = await connection.getTokenAccountBalance(treasuryAta);
        const ui = info.value.uiAmount ?? 0;
        if (!cancelled) {
          setTreasuryFunded(ui >= (state.resume?.seedAmountBase ?? 50_000_000) / 1_000_000);
        }
      } catch {
        if (!cancelled) setTreasuryFunded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    recoveryNeeded,
    state.resume?.vaultPda,
    state.resume?.seedAmountBase,
    connection,
  ]);

  // Legacy alias kept for the recovery JSX further down , `orphanDeposit`
  // now means "true orphan: deposit landed but registration didn't", so
  // narrows to recoveryNeeded && treasuryFunded === true.
  const orphanDeposit = recoveryNeeded && treasuryFunded === true;
  const droppedDeposit = recoveryNeeded && treasuryFunded === false;
  const checkingRecovery = recoveryNeeded && treasuryFunded === null;

  const finalizeConfirm = useCallback(async () => {
    dispatch({ type: "LAUNCH/SET_ERROR", error: null });
    dispatch({ type: "LAUNCH/SET_STAGE", stage: "confirming" });
    try {
      await confirmInit(sns);
      dispatch({ type: "LAUNCH/SET_STAGE", stage: "done" });
      setTimeout(() => {
        router.push(`/agent/${encodeURIComponent(sns)}`);
      }, 800);
    } catch (e) {
      dispatch({
        type: "LAUNCH/SET_ERROR",
        error: e instanceof Error ? e.message : "confirm failed",
      });
      // Keep stage at "confirming" so the deposit info stays visible —
      // do NOT reset stage to null (that would hide the orphan-deposit
      // recovery UI and the user would lose the depositTxSig).
    }
  }, [sns, dispatch, router]);

  const onLaunch = useCallback(async () => {
    if (!publicKey || !connected) {
      dispatch({
        type: "LAUNCH/SET_ERROR",
        error: "Connect a wallet first.",
      });
      return;
    }
    if (!strategy.preset) return;

    dispatch({ type: "LAUNCH/RESET" });
    dispatch({ type: "LAUNCH/SET_STAGE", stage: "creating-agent" });

    let depositBroadcast = false;

    try {
      // Resume mode: the agent row + on-chain vault already exist from
      // a previous attempt. Skip createAgent (would 409) and feed the
      // saved handles straight into launchAgent. The user signs only
      // the deposit, then confirmInit flips status to active.
      let nextSteps;
      if (state.resume) {
        nextSteps = {
          ownerWallet: state.resume.ownerWallet,
          vaultPda: state.resume.vaultPda,
          agentPubkey: state.resume.agentPubkey,
          treasuryMint: state.resume.treasuryMint,
          seedAmountBase: state.resume.seedAmountBase,
          instructions: [],
        };
      } else {
        const req: CreateAgentRequest = {
          sns,
          displayName: identity.displayName.trim(),
          tagline: identity.tagline.trim() || undefined,
          emoji: identity.emoji,
          ownerWallet: publicKey.toBase58(),
          preset: strategy.preset,
          allowedProtocols: allowlist.protocols,
          perProtocolLimits: allowlist.limits,
          // Canonical agent seed — matches the faucet's per-claim amount
          // (faucet.ts FAUCET_AMOUNT_BUSD) so a fresh user can fund one
          // agent with exactly one faucet claim. warmup.ts then mints
          // the same value as USDC on the surfpool fork.
          seedAmountBusd: 100,
          customBrainMd:
            strategy.showCustomBrain && strategy.customBrainMd.trim()
              ? strategy.customBrainMd
              : undefined,
        };
        const created = await createAgent(req);
        nextSteps = created.nextSteps;
      }

      const result = await launchAgent({
        connection,
        wallet: {
          publicKey,
          walletName: wallet?.adapter?.name,
          sendTransaction,
          signTransaction,
        },
        nextSteps,
        onStage: (stage) => dispatch({ type: "LAUNCH/SET_STAGE", stage }),
        onDepositTx: (sig) => {
          depositBroadcast = true;
          dispatch({ type: "LAUNCH/SET_DEPOSIT_TX", sig });
        },
      });

      dispatch({ type: "LAUNCH/SET_STAGE", stage: "confirming" });
      await confirmInit(sns);
      dispatch({ type: "LAUNCH/SET_STAGE", stage: "done" });
      toast.success(`${sns} is live, opening agent page.`);

      // Brief pause so the user can see "Done!" before redirecting.
      setTimeout(() => {
        router.push(`/agent/${encodeURIComponent(sns)}`);
      }, 800);

      // result is unused but typed so future callers can chain on it.
      void result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "launch failed";
      dispatch({
        type: "LAUNCH/SET_ERROR",
        error: msg,
      });
      toast.error(`Launch failed: ${msg}`);
      // If the deposit was broadcast, KEEP the stage so the recovery UI
      // (driven by `orphanDeposit`) stays visible and the depositTxSig
      // is preserved. Otherwise reset so the launch button re-enables.
      if (!depositBroadcast) {
        dispatch({ type: "LAUNCH/SET_STAGE", stage: null });
      }
    }
  }, [
    publicKey,
    connected,
    sendTransaction,
    signTransaction,
    wallet,
    strategy.preset,
    strategy.showCustomBrain,
    strategy.customBrainMd,
    sns,
    identity.displayName,
    identity.tagline,
    identity.emoji,
    allowlist.protocols,
    allowlist.limits,
    connection,
    dispatch,
    router,
    state.resume,
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Header
        eyebrow="Step 5 / 5"
        title={state.resume ? "Finish setup." : "Ship it."}
        sub={
          state.resume
            ? `Vault for ${sns} is already on-chain, sign one transfer to seed it with $50 bUSD and the strategy goes live.`
            : "Final review. We'll register the SNS, init the on-chain vault, then move $50 bUSD into the treasury."
        }
      />

      {/* Summary card */}
      <div className="card raised" style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 28 }}>{identity.emoji}</div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 18,
                color: "var(--de-ink)",
                letterSpacing: "-0.015em",
              }}
            >
              {identity.displayName || sns}
            </div>
            <div className="mono gold" style={{ fontSize: 11.5 }}>
              {sns}
            </div>
          </div>
        </div>
        {identity.tagline && (
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
            {identity.tagline}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          <span className="pill pill-gold">{presetMeta?.label ?? "preset"}</span>
          {allowlist.protocols.map((p) => (
            <span key={p} className="pill pill-muted">
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* Treasury policy */}
      <div className="card hairline" style={{ padding: 14 }}>
        <div
          className="mono"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: "var(--de-ink-3)",
            marginBottom: 8,
          }}
        >
          Policies
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "var(--de-ink)",
          }}
        >
          <li>Seed treasury: $50 bUSD (your wallet)</li>
          <li>Allowed protocols: {allowlist.protocols.join(", ")}</li>
          <li>
            Per-protocol caps:{" "}
            {Object.entries(allowlist.limits)
              .map(([k, v]) => `${k} ≤ $${v.maxNotionalUsd}`)
              .join(" · ") || "-"}
          </li>
          <li>Treasury custody: vault PDA owned by the program</li>
          <li>Close path: only your wallet can drain back to itself</li>
        </ul>
      </div>

      {/* Brain.md preview */}
      <div className="card hairline" style={{ padding: 14 }}>
        <div
          className="mono"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: "var(--de-ink-3)",
            marginBottom: 8,
          }}
        >
          brain.md preview
        </div>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          Preview shown for reference. The backend regenerates the prompt
          from your preset + protocol selection at agent-creation time, so
          minor wording may differ.
        </div>
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: "var(--de-bg-2)",
            border: "1px solid var(--de-line)",
            borderRadius: 8,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--de-ink)",
            whiteSpace: "pre-wrap",
            maxHeight: 240,
            overflow: "auto",
          }}
        >
          {brainPreview}
        </pre>
      </div>

      {/* Tx flow */}
      <div className="card inset" style={{ padding: 14 }}>
        <div
          className="mono"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: "var(--de-ink-3)",
            marginBottom: 8,
          }}
        >
          Transaction sequence
        </div>
        <ol
          style={{
            margin: 0,
            paddingLeft: 18,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "var(--de-ink)",
          }}
        >
          {state.resume ? (
            <>
              <li>
                <span style={{ color: "var(--de-mint)" }}>✓</span> Strategy +
                vault created
              </li>
              <li>You sign one transfer to seed the vault with $50 bUSD</li>
              <li>Strategy goes live</li>
            </>
          ) : (
            <>
              <li>We create your strategy and its vault</li>
              <li>You sign one transfer to seed the vault with $50 bUSD</li>
              <li>Strategy goes live</li>
            </>
          )}
        </ol>
      </div>

      {/* Progress */}
      {(launching || done || launch.error) && (
        <div className="card hairline" style={{ padding: 14 }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color: done ? "var(--de-mint)" : "var(--de-ink-3)",
              marginBottom: 8,
            }}
          >
            {done ? "Live" : "Launching"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Stage
              label="Creating strategy…"
              active={launch.stage === "creating-agent"}
              past={isPast(launch.stage, "creating-agent")}
            />
            <Stage
              label="Preparing transaction…"
              active={launch.stage === "building-tx"}
              past={isPast(launch.stage, "building-tx")}
            />
            <Stage
              label="Setting up vault…"
              active={launch.stage === "signing-init"}
              past={isPast(launch.stage, "signing-init")}
              txSig={launch.initTxSig}
            />
            <Stage
              label="Sign deposit ($50 bUSD)…"
              active={launch.stage === "signing-deposit"}
              past={isPast(launch.stage, "signing-deposit")}
              txSig={launch.depositTxSig}
            />
            <Stage
              label="Landing on-chain…"
              active={launch.stage === "landing"}
              past={isPast(launch.stage, "landing")}
              txSig={
                launch.stage === "landing" || isPast(launch.stage, "landing")
                  ? launch.depositTxSig
                  : null
              }
            />
            <Stage
              label="Finalizing…"
              active={launch.stage === "confirming"}
              past={isPast(launch.stage, "confirming")}
            />
            <Stage label="Done!" active={done} past={false} />
          </div>
          {launch.stage === "landing" && (
            <LandingProgress txSig={launch.depositTxSig} />
          )}
          {launch.error && (
            <div
              className="mono-tiny"
              style={{
                color: "var(--de-rose)",
                fontSize: 10.5,
                marginTop: 8,
              }}
            >
              {launch.error}
            </div>
          )}
        </div>
      )}

      {/* Recovery UI, split based on whether the deposit actually landed. */}
      {(orphanDeposit || droppedDeposit || checkingRecovery) && (
        <div
          className="card hairline"
          style={{
            padding: 14,
            borderColor: "var(--de-lavender)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color: "var(--de-lavender)",
            }}
          >
            {checkingRecovery ? "Checking on-chain status…" : "Action needed"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--de-ink)", lineHeight: 1.5 }}>
            {checkingRecovery &&
              "Reading the vault treasury to figure out where to pick up."}
            {orphanDeposit &&
              "Your deposit landed but the strategy didn't go live. Retry to flip it to active, no second on-chain transaction needed."}
            {droppedDeposit &&
              "Your previous transaction didn't land, your wallet still holds the $50 bUSD. Sign once more to seed the vault."}
          </div>
          {launch.depositTxSig && orphanDeposit && (
            <a
              href={`https://orbmarkets.io/tx/${launch.depositTxSig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="mono-tiny gold"
              style={{ fontSize: 10.5, textDecoration: "underline" }}
            >
              View deposit tx ↗
            </a>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {orphanDeposit && (
              <button
                type="button"
                onClick={finalizeConfirm}
                disabled={launch.stage === "confirming"}
                style={launchBtnStyle({
                  disabled: launch.stage === "confirming",
                })}
              >
                {launch.stage === "confirming"
                  ? "Retrying…"
                  : "Retry registration"}
              </button>
            )}
            {droppedDeposit && (
              <button
                type="button"
                onClick={() => {
                  // Clear the dead sig + error so the user starts from a
                  // clean slate. onLaunch rebuilds with a fresh blockhash.
                  dispatch({ type: "LAUNCH/RESET" });
                  void onLaunch();
                }}
                disabled={launching}
                style={launchBtnStyle({ disabled: launching })}
              >
                {launching ? "Signing…" : "Retry deposit"}
              </button>
            )}
            <a
              href={`mailto:support@bundie.fi?subject=${encodeURIComponent(
                `Agent registration stuck: ${sns}`,
              )}&body=${encodeURIComponent(
                `SNS: ${sns}\nDeposit tx: ${launch.depositTxSig ?? "(unknown)"}\nError: ${launch.error ?? ""}\n`,
              )}`}
              className="mono-tiny"
              style={{
                alignSelf: "center",
                fontSize: 11,
                color: "var(--de-ink-2)",
                textDecoration: "underline",
              }}
            >
              Contact support
            </a>
          </div>
        </div>
      )}

      {/* Launch button (hidden once any recovery panel is showing).
         The bUSD balance gate only applies to the fresh flow — in resume
         mode the read can hit RPC propagation lag and stick at 0, which
         would silently grey out the button forever. The deposit flow's
         own pre-check handles the actual "not enough bUSD" case with a
         clear message + automatic retry, so it's safe to let the click
         through here. */}
      {!recoveryNeeded && (
        <button
          type="button"
          onClick={onLaunch}
          disabled={
            !connected ||
            launching ||
            done ||
            !strategy.preset ||
            (!state.resume && (capital.busdBalance ?? 0) < 50)
          }
          style={launchBtnStyle({
            disabled:
              !connected ||
              launching ||
              done ||
              !strategy.preset ||
              (!state.resume && (capital.busdBalance ?? 0) < 50),
          })}
        >
          {!connected
            ? "Connect wallet"
            : done
              ? "Live ✓"
              : launching
                ? state.resume
                  ? "Finishing…"
                  : "Launching…"
                : state.resume
                  ? "Sign deposit ($50 bUSD)"
                  : "Launch strategy"}
        </button>
      )}
    </div>
  );
}

function isPast(stage: LaunchStage | null, target: LaunchStage): boolean {
  if (!stage) return false;
  const order: LaunchStage[] = [
    "creating-agent",
    "building-tx",
    "signing-init",
    "signing-deposit",
    "landing",
    "confirming",
    "done",
  ];
  return order.indexOf(stage) > order.indexOf(target);
}

/**
 * Animated bar that grows over the recentBlockhash validity window
 * (~60s). The user sees the long pause between "wallet signed" and
 * "tx landed" filled with continuous feedback so the wizard doesn't
 * look frozen. The actual confirm logic in launchAgent races against
 * the same window, bar full ≈ "we're about to give up and retry."
 */
function LandingProgress({ txSig }: { txSig: string | null }) {
  const ESTIMATED_MS = 60_000;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 250);
    return () => clearInterval(id);
  }, []);
  const pct = Math.min(99, Math.round((elapsed / ESTIMATED_MS) * 100));
  const sec = Math.round(elapsed / 1000);
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          width: "100%",
          height: 4,
          background: "var(--bg-3)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--de-lavender)",
            transition: "width 240ms linear",
          }}
        />
      </div>
      <div
        className="mono-tiny"
        style={{
          marginTop: 6,
          fontSize: 10.5,
          color: "var(--de-ink-3)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          Waiting for the network to confirm, usually 5–15s, up to ~60s on
          busy slots.
        </span>
        <span className="mono">{sec}s</span>
      </div>
      {txSig && (
        <a
          href={`https://orbmarkets.io/tx/${txSig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="mono-tiny gold"
          style={{
            display: "inline-block",
            marginTop: 4,
            fontSize: 10,
            textDecoration: "underline",
          }}
        >
          View tx ↗
        </a>
      )}
    </div>
  );
}

function Stage({
  label,
  active,
  past,
  txSig,
}: {
  label: string;
  active: boolean;
  past: boolean;
  txSig?: string | null;
}) {
  const color = past
    ? "var(--de-mint)"
    : active
      ? "var(--de-lavender)"
      : "var(--de-ink-4)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ color, fontFamily: "var(--font-mono)" }}>{label}</span>
      {txSig && (
        <a
          href={`https://orbmarkets.io/tx/${txSig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="mono-tiny gold"
          style={{ fontSize: 10, textDecoration: "underline" }}
        >
          view ↗
        </a>
      )}
    </div>
  );
}

function launchBtnStyle({
  disabled,
}: {
  disabled?: boolean;
}): React.CSSProperties {
  return {
    width: "100%",
    height: 48,
    padding: "0 16px",
    background: disabled ? "var(--bg-3)" : "var(--de-lavender)",
    color: disabled ? "var(--de-ink-4)" : "#fff",
    border: "1px solid",
    borderColor: disabled ? "var(--de-line)" : "var(--de-lavender)",
    borderRadius: 10,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 160ms ease, color 160ms ease",
  };
}
