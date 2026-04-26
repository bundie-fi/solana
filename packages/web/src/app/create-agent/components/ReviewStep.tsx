"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
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
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();

  const sns = fullSns(identity.snsPrefix);
  const presetMeta = PRESETS.find((p) => p.id === strategy.preset);
  const brainPreview = useMemo(() => generateBrainPreview(state), [state]);

  const launching = launch.stage !== null && launch.stage !== "done";
  const done = launch.stage === "done";

  const onLaunch = useCallback(async () => {
    if (!publicKey || !connected || !signTransaction) {
      dispatch({
        type: "LAUNCH/SET_ERROR",
        error: "Connect a wallet first.",
      });
      return;
    }
    if (!strategy.preset) return;

    dispatch({ type: "LAUNCH/RESET" });
    dispatch({ type: "LAUNCH/SET_STAGE", stage: "creating-agent" });

    try {
      const req: CreateAgentRequest = {
        sns,
        displayName: identity.displayName.trim(),
        tagline: identity.tagline.trim() || undefined,
        emoji: identity.emoji,
        ownerWallet: publicKey.toBase58(),
        preset: strategy.preset,
        allowedProtocols: allowlist.protocols,
        perProtocolLimits: allowlist.limits,
        seedAmountBusd: 50,
        customBrainMd:
          strategy.showCustomBrain && strategy.customBrainMd.trim()
            ? strategy.customBrainMd
            : undefined,
      };
      const created = await createAgent(req);

      const result = await launchAgent({
        connection,
        wallet: { publicKey, signTransaction },
        nextSteps: created.nextSteps,
        onStage: (stage) => dispatch({ type: "LAUNCH/SET_STAGE", stage }),
        onInitTx: (sig) => dispatch({ type: "LAUNCH/SET_INIT_TX", sig }),
        onDepositTx: (sig) =>
          dispatch({ type: "LAUNCH/SET_DEPOSIT_TX", sig }),
      });

      dispatch({ type: "LAUNCH/SET_STAGE", stage: "confirming" });
      await confirmInit(sns);
      dispatch({ type: "LAUNCH/SET_STAGE", stage: "done" });

      // Brief pause so the user can see "Done!" before redirecting.
      setTimeout(() => {
        router.push(`/agent/${encodeURIComponent(sns)}`);
      }, 800);

      // result is unused but typed so future callers can chain on it.
      void result;
    } catch (e) {
      dispatch({
        type: "LAUNCH/SET_ERROR",
        error: e instanceof Error ? e.message : "launch failed",
      });
      dispatch({ type: "LAUNCH/SET_STAGE", stage: null });
    }
  }, [
    publicKey,
    connected,
    signTransaction,
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
  ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Header
        eyebrow="Step 5 / 5"
        title="Ship it."
        sub="Final review. We'll register the SNS, init the on-chain vault, then move $50 bUSD into the treasury."
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
                color: "var(--fg-0)",
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
            color: "var(--fg-3)",
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
            color: "var(--fg-1)",
          }}
        >
          <li>Seed treasury: $50 bUSD (your wallet)</li>
          <li>Allowed protocols: {allowlist.protocols.join(", ")}</li>
          <li>
            Per-protocol caps:{" "}
            {Object.entries(allowlist.limits)
              .map(([k, v]) => `${k} ≤ $${v.maxNotionalUsd}`)
              .join(" · ") || "—"}
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
            color: "var(--fg-3)",
            marginBottom: 8,
          }}
        >
          brain.md preview
        </div>
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: "var(--bg-2)",
            border: "1px solid var(--line-1)",
            borderRadius: 8,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-1)",
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
            color: "var(--fg-3)",
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
            color: "var(--fg-1)",
          }}
        >
          <li>Backend mints agent keypair + signs init_vault</li>
          <li>You sign deposit_to_vault ($50 bUSD → treasury_ata)</li>
          <li>Backend confirms + flips status to active</li>
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
              color: done ? "var(--green-2)" : "var(--fg-3)",
              marginBottom: 8,
            }}
          >
            {done ? "Live" : "Launching"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Stage
              label="Creating agent…"
              active={launch.stage === "creating-agent"}
              past={isPast(launch.stage, "creating-agent")}
            />
            <Stage
              label="Building txs…"
              active={launch.stage === "building-tx"}
              past={isPast(launch.stage, "building-tx")}
            />
            <Stage
              label="Sign init_vault…"
              active={launch.stage === "signing-init"}
              past={isPast(launch.stage, "signing-init")}
              txSig={launch.initTxSig}
            />
            <Stage
              label="Sign deposit_to_vault…"
              active={launch.stage === "signing-deposit"}
              past={isPast(launch.stage, "signing-deposit")}
              txSig={launch.depositTxSig}
            />
            <Stage
              label="Confirming…"
              active={launch.stage === "confirming"}
              past={isPast(launch.stage, "confirming")}
            />
            <Stage label="Done!" active={done} past={false} />
          </div>
          {launch.error && (
            <div
              className="mono-tiny"
              style={{
                color: "var(--red-2)",
                fontSize: 10.5,
                marginTop: 8,
              }}
            >
              {launch.error}
            </div>
          )}
        </div>
      )}

      {/* Launch button */}
      <button
        type="button"
        onClick={onLaunch}
        disabled={
          !connected ||
          launching ||
          done ||
          !strategy.preset ||
          (capital.busdBalance ?? 0) < 50
        }
        style={launchBtnStyle({
          disabled:
            !connected ||
            launching ||
            done ||
            !strategy.preset ||
            (capital.busdBalance ?? 0) < 50,
        })}
      >
        {!connected
          ? "Connect wallet"
          : done
            ? "Live ✓"
            : launching
              ? "Launching…"
              : "Launch agent"}
      </button>
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
    "confirming",
    "done",
  ];
  return order.indexOf(stage) > order.indexOf(target);
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
    ? "var(--green-2)"
    : active
      ? "var(--gold)"
      : "var(--fg-4)";
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
    background: disabled ? "var(--bg-3)" : "var(--gold)",
    color: disabled ? "var(--fg-4)" : "#fff",
    border: "1px solid",
    borderColor: disabled ? "var(--line-1)" : "var(--gold)",
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
