"use client";

/**
 * /identity — claim your `<name>.sol` identity on Bundie.
 *
 * Three render states (single component, gated on wallet + SNS lookup):
 *   A) Wallet not connected → hero + connect CTA.
 *   B) Connected, no SNS    → search + claim flow.
 *   C) Connected, has SNS   → identity card + on-chain stats summary.
 *
 * All registration goes through lib/sns-register.ts. We never auto-trigger
 * — every signing action requires an explicit user click. Confirmation
 * modal surfaces the exact PDA + cost before the wallet is asked to sign.
 *
 * Devnet only. The banner and copy say so loudly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";

import { Button } from "@/components/ui/button";
import { SnsName } from "@/components/SnsName";
import { invalidateSnsLookup, lookupSnsForAddress, setSnsCacheEntry, truncatePubkey } from "@/lib/sns";
import {
  AvailabilityResult,
  DEVNET_REGISTRATION_COST_SOL,
  checkAvailability,
  executeRegistration,
  validateName,
} from "@/lib/sns-register";

// 400ms debounce — long enough to skip every keystroke, short enough that
// the user feels the green check land before they finish thinking.
const AVAIL_DEBOUNCE_MS = 400;

export default function IdentityPage() {
  const { publicKey, connected, signTransaction, sendTransaction, wallet } =
    useWallet();
  const { connection } = useConnection();

  const [snsName, setSnsName] = useState<string | null>(null);
  const [snsLoading, setSnsLoading] = useState(false);

  // Re-fetch the SNS name whenever the connected wallet changes. We use
  // lookupSnsForAddress which already caches 5min and tries devnet first.
  useEffect(() => {
    if (!publicKey) {
      setSnsName(null);
      return;
    }
    let cancelled = false;
    setSnsLoading(true);
    lookupSnsForAddress(publicKey.toBase58())
      .then((n) => {
        if (!cancelled) setSnsName(n);
      })
      .finally(() => {
        if (!cancelled) setSnsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  // ─── State A — wallet not connected ───────────────────────────────────
  if (!connected) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 md:py-16">
        <Header />
        <div className="mt-10 rounded-2xl border border-neutral-300 bg-surface p-8 md:p-12">
          <h2 className="font-serif text-h1 text-neutral-900">
            Claim your <em className="text-amber-400">.sol</em> identity
          </h2>
          <p className="mt-3 max-w-prose text-body text-neutral-700">
            Your name appears on every strategy you back, every market you
            trade, every prediction you make. Connect your wallet to claim a
            human-readable identity that follows you across Bundie.
          </p>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
            <WalletMultiButton
              style={{
                background: "var(--amber-tint)",
                border: "1px solid var(--amber-ring)",
                borderRadius: "10px",
                color: "#e28646",
                fontSize: "14px",
                height: "44px",
                padding: "0 20px",
                fontWeight: 600,
              }}
            />
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600">
              Devnet · SPL Name Service
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!publicKey) return null; // shouldn't happen; appease TS

  // ─── State C — wallet connected, has SNS ──────────────────────────────
  if (snsName) {
    return (
      <IdentityHasNameView
        name={snsName}
        owner={publicKey.toBase58()}
      />
    );
  }

  // ─── State B — wallet connected, no SNS yet ───────────────────────────
  return (
    <ClaimFlow
      owner={publicKey}
      sendTransaction={sendTransaction}
      signTransaction={signTransaction}
      connection={connection}
      walletLabel={wallet?.adapter.name ?? "Wallet"}
      onClaimed={(name) => {
        // Optimistically prime the cache so other surfaces (banner, cards)
        // pick up the new identity on next render without a full refetch.
        const fullName = name.endsWith(".sol") ? name : `${name}.sol`;
        invalidateSnsLookup(publicKey.toBase58());
        setSnsCacheEntry(publicKey.toBase58(), fullName);
        setSnsName(fullName);
      }}
      loading={snsLoading}
    />
  );
}

// ─── Sub-views ───────────────────────────────────────────────────────────

function Header() {
  return (
    <div>
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400">
        Identity
      </span>
      <h1 className="mt-1 font-serif text-display text-neutral-900">
        Your <em className="text-amber-400">.sol</em>, on Bundie.
      </h1>
      <p className="mt-2 max-w-prose text-body text-neutral-700">
        Devnet identities powered by Bonfida SNS. Claim once, and every strategy
        creator/trader pubkey across the app upgrades to your name.
      </p>
    </div>
  );
}

function IdentityHasNameView({ name, owner }: { name: string; owner: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400">
        Identity
      </span>
      <h1 className="mt-1 font-serif text-display text-neutral-900">{name}</h1>
      <p className="mt-2 text-sm text-neutral-700">
        Reverse-resolved from{" "}
        <a
          href={`https://orbmarkets.io/address/${owner}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-amber-400 hover:underline"
        >
          {truncatePubkey(owner, 6, 6)}
        </a>
        . This is how you appear across the app.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Strategies created" value="—" hint="On-chain count" />
        <StatCard label="Markets opened" value="—" hint="Authority pubkey" />
        <StatCard label="Predictions made" value="—" hint="Coming soon" />
      </div>

      <div className="mt-8 flex flex-col gap-3 rounded-xl border border-neutral-300 bg-surface p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600">
            Manage your name
          </p>
          <p className="mt-1 text-sm text-neutral-700">
            Transfer, set a primary, or list for sale on Bonfida (devnet).
          </p>
        </div>
        <a
          href="https://www.sns.id"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 focus-amber"
        >
          Open Bonfida ↗
        </a>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/portfolio"
          className="inline-flex h-11 min-h-[44px] items-center rounded-lg bg-amber-600 px-4 text-sm font-semibold text-neutral-900 hover:bg-amber-500 focus-amber"
        >
          View your portfolio →
        </Link>
        <Link
          href="/discover"
          className="inline-flex h-11 min-h-[44px] items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 focus-amber"
        >
          Discover strategies
        </Link>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-300 bg-surface p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-600">
        {label}
      </p>
      <p className="mt-1 font-mono nums text-2xl font-semibold text-neutral-900">
        {value}
      </p>
      {hint && (
        <p className="mt-1 font-mono text-[10px] text-neutral-600">{hint}</p>
      )}
    </div>
  );
}

// ─── Claim flow (State B) ───────────────────────────────────────────────

interface ClaimFlowProps {
  owner: PublicKey;
  // We accept the wallet adapter pieces as props so the page composes
  // cleanly and we can stub them in tests.
  sendTransaction: ReturnType<typeof useWallet>["sendTransaction"];
  signTransaction: ReturnType<typeof useWallet>["signTransaction"];
  connection: ReturnType<typeof useConnection>["connection"];
  walletLabel: string;
  loading: boolean;
  onClaimed: (name: string) => void;
}

function ClaimFlow({
  owner,
  sendTransaction,
  connection,
  walletLabel,
  loading,
  onClaimed,
}: ClaimFlowProps) {
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<AvailabilityResult | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    name: string;
    namePda: string;
    signature: string;
  } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Run validation synchronously — the regex is the gatekeeper.
  const localValidation = useMemo(() => validateName(query), [query]);

  // Debounced availability check. Skips the RPC call when local validation
  // already failed.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setAvailability(null);
      setChecking(false);
      return;
    }
    if (!localValidation.ok) {
      setAvailability({
        state: "invalid",
        name: query.trim().toLowerCase(),
        reason: localValidation.reason ?? "Invalid",
      });
      setChecking(false);
      return;
    }
    setChecking(true);
    debounceRef.current = setTimeout(async () => {
      const result = await checkAvailability(query);
      setAvailability(result);
      setChecking(false);
    }, AVAIL_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, localValidation]);

  const handleClaim = useCallback(async () => {
    if (!availability || availability.state !== "available") return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await executeRegistration(
        {
          publicKey: owner,
          sendTransaction: sendTransaction
            ? (tx, conn) => sendTransaction(tx, conn)
            : undefined,
        },
        availability.name,
        connection,
      );
      setSuccess({
        name: availability.name,
        namePda: result.namePda,
        signature: result.signature,
      });
      setConfirmOpen(false);
      onClaimed(availability.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [availability, owner, sendTransaction, connection, onClaimed]);

  // ── Success state ────────────────────────────────────────────────────
  if (success) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <Header />
        <div className="mt-10 rounded-2xl border border-success-400/30 bg-success-400/5 p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-success-400">
            Registered on devnet
          </p>
          <h2 className="mt-1 font-serif text-h1 text-neutral-900">
            <em className="text-amber-400">{success.name}.sol</em> is yours.
          </h2>
          <p className="mt-3 text-sm text-neutral-700">
            The reverse lookup will start resolving across the app within a few
            seconds. We&apos;ve already updated this session optimistically.
          </p>
          <dl className="mt-5 space-y-2 font-mono text-xs">
            <div className="flex flex-wrap gap-2">
              <dt className="text-neutral-600">Name PDA:</dt>
              <dd>
                <a
                  href={`https://orbmarkets.io/address/${success.namePda}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 hover:underline"
                >
                  {success.namePda}
                </a>
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-neutral-600">Tx:</dt>
              <dd>
                <a
                  href={`https://orbmarkets.io/tx/${success.signature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 hover:underline"
                >
                  {success.signature.slice(0, 16)}…
                </a>
              </dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/portfolio"
              className="inline-flex h-11 min-h-[44px] items-center rounded-lg bg-amber-600 px-4 text-sm font-semibold text-neutral-900 hover:bg-amber-500 focus-amber"
            >
              Go to portfolio →
            </Link>
            <Link
              href="/discover"
              className="inline-flex h-11 min-h-[44px] items-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 focus-amber"
            >
              Back a strategy
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ── Search + claim ───────────────────────────────────────────────────
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Header />

      {/* Owner identity strip */}
      <div className="mt-8 rounded-xl border border-neutral-300 bg-surface p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600">
          Connected wallet
        </p>
        <p className="mt-1 font-mono text-sm text-neutral-900">
          {truncatePubkey(owner.toBase58(), 8, 8)}
        </p>
        <p className="mt-2 text-xs text-neutral-700">
          {loading
            ? "Checking for an existing .sol identity…"
            : `No .sol identity found yet — ${walletLabel} can claim one below.`}
        </p>
      </div>

      {/* Name search */}
      <section className="mt-8">
        <label
          htmlFor="sns-search"
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-600"
        >
          Pick a name
        </label>
        <div className="relative mt-2">
          <input
            id="sns-search"
            value={query}
            onChange={(e) => setQuery(e.target.value.toLowerCase())}
            placeholder="alpha-hunter"
            autoComplete="off"
            spellCheck={false}
            className="block w-full min-h-[44px] rounded-lg border border-neutral-300 bg-surface px-4 pr-16 text-base font-mono text-neutral-900 placeholder:text-neutral-600 focus-amber focus:border-amber-600/40 transition-colors"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-sm text-neutral-600">
            .sol
          </span>
        </div>
        <p className="mt-2 font-mono text-[11px] text-neutral-600">
          3–32 chars · lowercase letters, numbers, and single dashes · no
          leading/trailing dash.
        </p>

        {/* Result row */}
        <div className="mt-4 min-h-[44px]">
          {checking && query.trim() && localValidation.ok && (
            <p className="text-sm text-neutral-700">Checking devnet…</p>
          )}
          {!checking && availability && (
            <AvailabilityRow
              result={availability}
              onClaim={() => {
                setError(null);
                setConfirmOpen(true);
              }}
            />
          )}
        </div>
      </section>

      {/* Cost note */}
      <aside className="mt-8 rounded-xl border border-amber-600/30 bg-amber-600/5 p-4 text-xs text-neutral-700">
        <p>
          <span className="font-mono text-amber-400">Cost</span>: ≈{" "}
          {DEVNET_REGISTRATION_COST_SOL} SOL devnet rent (no USDC required).
          Make sure your wallet has a small SOL balance before claiming — use
          the Solana devnet faucet if needed.
        </p>
        <p className="mt-2 text-[11px] text-neutral-600">
          (uses SPL Name Service directly — Bonfida pricing layer skipped on
          devnet)
        </p>
      </aside>

      {/* Confirmation modal */}
      {confirmOpen && availability?.state === "available" && (
        <ConfirmModal
          name={availability.name}
          owner={owner.toBase58()}
          submitting={submitting}
          error={error}
          onCancel={() => {
            if (submitting) return;
            setConfirmOpen(false);
            setError(null);
          }}
          onConfirm={handleClaim}
        />
      )}
    </main>
  );
}

function AvailabilityRow({
  result,
  onClaim,
}: {
  result: AvailabilityResult;
  onClaim: () => void;
}) {
  if (result.state === "available") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-success-400/30 bg-success-400/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm">
          <span aria-hidden="true" className="text-success-400">
            ✓
          </span>
          <span className="font-mono text-neutral-900">
            {result.name}.sol is available.
          </span>
        </div>
        <Button onClick={onClaim} variant="primary" size="md">
          Claim it
        </Button>
      </div>
    );
  }
  if (result.state === "taken") {
    return (
      <div className="rounded-xl border border-danger-400/30 bg-danger-400/5 p-4 text-sm">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-danger-400">
            ✗
          </span>
          <span className="font-mono text-neutral-900">
            {result.name}.sol is taken.
          </span>
        </div>
        <p className="mt-2 text-xs text-neutral-700">
          Owner:{" "}
          <Link
            href={`/portfolio?owner=${result.owner}`}
            className="font-mono text-amber-400 hover:underline"
          >
            <SnsName addr={result.owner} head={6} tail={6} />
          </Link>
        </p>
      </div>
    );
  }
  if (result.state === "invalid") {
    return (
      <div className="rounded-xl border border-warning-400/30 bg-warning-400/5 p-4 text-sm text-neutral-800">
        <span aria-hidden="true" className="mr-2 text-warning-400">
          !
        </span>
        {result.reason}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-neutral-300 bg-surface p-4 text-sm text-neutral-700">
      Couldn&apos;t reach the registrar — try again. ({result.reason})
    </div>
  );
}

function ConfirmModal({
  name,
  owner,
  submitting,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  owner: string;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6 pt-12 sm:items-center sm:p-6"
    >
      <div className="w-full max-w-md rounded-2xl border border-neutral-300 bg-surface p-6 shadow-xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-400">
          Confirm registration
        </p>
        <h2 id="confirm-title" className="mt-1 font-serif text-h1 text-neutral-900">
          Claim <em className="text-amber-400">{name}.sol</em>
        </h2>
        <dl className="mt-4 space-y-2 text-sm">
          <Row label="Owner" value={truncatePubkey(owner, 8, 8)} mono />
          <Row label="Network" value="Devnet" />
          <Row label="Registrar" value="SPL Name Service (direct)" />
          <Row
            label="Approx. cost"
            value={`≈ ${DEVNET_REGISTRATION_COST_SOL} SOL devnet rent + tx fee`}
          />
        </dl>
        <p className="mt-3 text-[11px] text-neutral-600">
          (uses SPL Name Service directly — Bonfida pricing layer skipped on
          devnet)
        </p>
        <p className="mt-4 text-xs text-neutral-700">
          Your wallet will pop up to sign one transaction. We don&apos;t store
          the keypair — every signature stays on-device.
        </p>
        {error && (
          <p className="mt-4 rounded-lg border border-danger-400/30 bg-danger-400/5 p-3 font-mono text-xs text-danger-400">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? "Signing…" : "Sign & register"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-neutral-600">{label}</dt>
      <dd className={`text-neutral-900 ${mono ? "font-mono nums" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
