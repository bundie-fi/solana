"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { categoryLabel } from "@/lib/events";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://backend.solana.bundie.fi";

const TOKEN_KEY = "bundie:admin_token";

type Status = "pending" | "approved" | "rejected" | "deployed";

interface Proposal {
  id: string | number;
  submitted_at: string;
  requester_wallet: string | null;
  requester_contact: string | null;
  category: string;
  description: string;
  proposed_resolver_class: string | null;
  proposed_params: unknown;
  notes: string | null;
  status: Status;
  reviewed_at: string | null;
  reviewer_note: string | null;
}

interface Counts {
  pending: number;
  approved: number;
  rejected: number;
  deployed: number;
}

const TABS: { key: Status; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "deployed", label: "Deployed" },
  { key: "rejected", label: "Rejected" },
];

export default function AdminProposals() {
  const [token, setToken] = useState<string>("");
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [tab, setTab] = useState<Status>("pending");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [counts, setCounts] = useState<Counts>({
    pending: 0,
    approved: 0,
    rejected: 0,
    deployed: 0,
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Hydrate token from localStorage on mount.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TOKEN_KEY) ?? "";
      setToken(stored);
    } catch {
      // privacy mode etc.
    }
    setTokenLoaded(true);
  }, []);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-admin-token": token,
    }),
    [token],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const [pRes, cRes] = await Promise.all([
        fetch(
          `${BACKEND_URL}/v1/admin/proposals?status=${encodeURIComponent(tab)}&limit=100`,
          { headers: headers() },
        ),
        fetch(`${BACKEND_URL}/v1/admin/proposals/_counts`, {
          headers: headers(),
        }),
      ]);
      if (pRes.status === 401) throw new Error("Unauthorized (check token)");
      if (!pRes.ok) throw new Error(`HTTP ${pRes.status}`);
      const pBody = (await pRes.json()) as { proposals: Proposal[] };
      setProposals(pBody.proposals);
      if (cRes.ok) {
        const cBody = (await cRes.json()) as { counts: Counts };
        setCounts(cBody.counts);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [headers, tab, token]);

  useEffect(() => {
    if (tokenLoaded && token) refresh();
  }, [tokenLoaded, token, tab, refresh]);

  const saveToken = useCallback(() => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // ignore
    }
    refresh();
  }, [token, refresh]);

  const clearToken = useCallback(() => {
    setToken("");
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  }, []);

  const update = useCallback(
    async (id: string | number, body: { status?: Status; reviewer_note?: string }) => {
      try {
        const r = await fetch(`${BACKEND_URL}/v1/admin/proposals/${id}`, {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast.success(`Proposal ${id}: ${body.status ?? "updated"}`);
        await refresh();
      } catch (e) {
        toast.error(`Update failed: ${(e as Error).message}`);
      }
    },
    [headers, refresh],
  );

  if (!tokenLoaded) return null;

  if (!token) {
    return (
      <main className="min-h-screen bg-[var(--de-bg)] px-6 py-20 text-[var(--de-ink)]">
        <div className="mx-auto max-w-md">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
            Admin · Proposals
          </p>
          <h1 className="mb-6 font-serif text-3xl tracking-tight">
            Paste your admin token
          </h1>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="BUNDIE_ADMIN_TOKEN"
            className="w-full rounded-lg border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] px-4 py-3 font-mono text-sm"
          />
          <button
            onClick={saveToken}
            disabled={!token}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--de-ink)] px-5 py-2.5 text-sm font-medium text-[var(--de-bg)] disabled:opacity-50"
          >
            Sign in →
          </button>
          <p className="mt-6 text-xs text-[var(--de-ink-3)]">
            Token is stored in localStorage on this device only.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--de-bg)] px-6 py-12 text-[var(--de-ink)] sm:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-baseline justify-between">
          <div>
            <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--de-ink-3)]">
              Admin · Proposals
            </p>
            <h1 className="font-serif text-3xl tracking-tight">
              Market-creation queue
            </h1>
          </div>
          <button
            onClick={clearToken}
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)] hover:text-[var(--de-ink)]"
          >
            Sign out
          </button>
        </header>

        {/* Tab bar with counts */}
        <div className="mb-6 flex flex-wrap gap-2 border-b border-[var(--de-line)] pb-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors duration-150 ease-out ${
                tab === t.key
                  ? "bg-[var(--de-ink)] text-[var(--de-bg)]"
                  : "border border-[var(--de-line-2)] text-[var(--de-ink-2)] hover:border-[var(--de-ink-3)]"
              }`}
            >
              {t.label}
              <span className="tabular-nums opacity-70">{counts[t.key]}</span>
            </button>
          ))}
          <button
            onClick={refresh}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-2 rounded-full border border-[var(--de-line-2)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-2)] hover:border-[var(--de-ink-3)]"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {err ? (
          <div className="rounded-lg border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-4 font-mono text-sm text-[var(--de-rose)]">
            {err}
          </div>
        ) : proposals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-12 text-center">
            <p className="font-serif text-xl">No {tab} proposals.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {proposals.map((p) => (
              <ProposalRow key={p.id} p={p} onUpdate={update} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function ProposalRow({
  p,
  onUpdate,
}: {
  p: Proposal;
  onUpdate: (id: string | number, body: { status?: Status; reviewer_note?: string }) => void;
}) {
  const [note, setNote] = useState(p.reviewer_note ?? "");
  const submitted = new Date(p.submitted_at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <li className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
          #{String(p.id)} · {submitted} · {categoryLabel(p.category)}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-4)]">
          {p.status}
        </div>
      </div>

      <p className="mt-2 text-[15px] leading-snug text-[var(--de-ink)]">
        {p.description}
      </p>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
        {p.proposed_resolver_class ? (
          <Pair k="Resolver class" v={<code>{p.proposed_resolver_class}</code>} />
        ) : null}
        {p.requester_wallet ? (
          <Pair k="Wallet" v={<code>{shortKey(p.requester_wallet)}</code>} />
        ) : null}
        {p.requester_contact ? <Pair k="Contact" v={p.requester_contact} /> : null}
        {p.notes ? <Pair k="Notes" v={p.notes} /> : null}
        {p.reviewed_at ? (
          <Pair
            k="Reviewed"
            v={new Date(p.reviewed_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
        ) : null}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reviewer note (optional)"
          className="min-w-0 flex-1 rounded-md border border-[var(--de-line-2)] bg-[var(--de-bg)] px-3 py-1.5 font-mono text-xs"
        />
        <ActionButton
          label="Approve"
          tone="mint"
          onClick={() => onUpdate(p.id, { status: "approved", reviewer_note: note })}
        />
        <ActionButton
          label="Mark deployed"
          tone="ink"
          onClick={() => onUpdate(p.id, { status: "deployed", reviewer_note: note })}
        />
        <ActionButton
          label="Reject"
          tone="rose"
          onClick={() => onUpdate(p.id, { status: "rejected", reviewer_note: note })}
        />
      </div>
    </li>
  );
}

function Pair({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--de-ink-4)]">
        {k}
      </dt>
      <dd className="text-[var(--de-ink-2)]">{v}</dd>
    </div>
  );
}

function ActionButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: "mint" | "rose" | "ink";
  onClick: () => void;
}) {
  const color =
    tone === "mint"
      ? "var(--de-mint)"
      : tone === "rose"
        ? "var(--de-rose)"
        : "var(--de-ink)";
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--de-bg)] transition-transform duration-150 ease-out hover:-translate-y-px"
      style={{ background: color }}
    >
      {label}
    </button>
  );
}

function shortKey(s: string): string {
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
