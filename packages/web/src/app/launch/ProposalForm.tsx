"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { CATEGORIES } from "@/lib/events";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://backend.solana.bundie.fi";

const RESOLVER_CLASSES = [
  { value: "", label: "Not sure — let Bundie decide" },
  {
    value: "pyth_threshold_duration",
    label: "Pyth price threshold (asset above/below $X for Y min)",
  },
  {
    value: "statuspage_v2_incident_duration",
    label: "Statuspage incident (any company with a public statuspage)",
  },
  {
    value: "aws_health_dashboard_incident",
    label: "AWS Health Dashboard (region-level outages)",
  },
  {
    value: "onchain_tvl_rolling_window",
    label: "On-chain TVL drop (Solana program)",
  },
] as const;

export function ProposalForm() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? "";

  const [category, setCategory] = useState<string>("stablecoin");
  const [description, setDescription] = useState("");
  const [resolverClass, setResolverClass] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const canSubmit =
    !submitting && description.trim().length > 0 && category.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${BACKEND_URL}/v1/market-proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          description: description.trim(),
          proposed_resolver_class: resolverClass || undefined,
          requester_wallet: wallet || undefined,
          requester_contact: contact.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      setDone(true);
      toast.success("Proposal received. We'll be in touch.");
      setDescription("");
      setNotes("");
      setContact("");
    } catch (err) {
      toast.error(`Submit failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-8 text-center">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-mint)]">
          Proposal received
        </p>
        <p className="font-serif text-2xl text-[var(--de-ink)]">
          Thanks. We&rsquo;ll review and reach out if we deploy.
        </p>
        <button
          onClick={() => setDone(false)}
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--de-line-3)] px-5 py-2 text-sm font-medium text-[var(--de-ink)] transition-colors duration-150 ease-out hover:border-[var(--de-ink)]"
          type="button"
        >
          Suggest another
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6 sm:p-8"
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input"
            required
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
            <option value="other">Other / new category</option>
          </select>
        </Field>

        <Field label="How should it resolve? (optional)">
          <select
            value={resolverClass}
            onChange={(e) => setResolverClass(e.target.value)}
            className="input"
          >
            {RESOLVER_CLASSES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="What event should we price?" className="mt-5">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={3}
          required
          placeholder={`e.g. "Will Drift TVL drop more than $50M in any 24h window over the next 90 days?"`}
          className="input"
        />
        <p className="mt-1 text-[11px] text-[var(--de-ink-4)]">
          {description.length}/1000 — plain English. We&rsquo;ll convert it
          to a verifiable on-chain trigger.
        </p>
      </Field>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Your wallet (auto-filled when connected)">
          <input
            value={wallet}
            readOnly
            placeholder="Connect your wallet"
            className="input font-mono"
          />
        </Field>
        <Field label="Contact (email or Discord, optional)">
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="you@example.com / @discordhandle"
            className="input"
          />
        </Field>
      </div>

      <Field label="Anything else? (optional)" className="mt-5">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="A link to the source you'd want us to resolve from, your trigger threshold, anything that helps us scope it."
          className="input"
        />
      </Field>

      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--de-ink)] px-6 py-3 text-sm font-medium text-[var(--de-bg)] transition-transform duration-150 ease-out hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit proposal"}
        <span aria-hidden="true">→</span>
      </button>

      <style jsx>{`
        .input {
          width: 100%;
          padding: 10px 14px;
          border: 1px solid var(--de-line-2);
          border-radius: 8px;
          background: var(--de-bg);
          font-family: var(--font-sans);
          font-size: 14px;
          color: var(--de-ink);
          transition: border-color 150ms ease;
        }
        .input:hover { border-color: var(--de-line-3); }
        .input:focus {
          outline: none;
          border-color: var(--de-lavender);
        }
        textarea.input {
          resize: vertical;
          line-height: 1.5;
        }
        select.input {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23444' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 14px center;
          padding-right: 36px;
        }
      `}</style>
    </form>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
        {label}
      </span>
      {children}
    </label>
  );
}
