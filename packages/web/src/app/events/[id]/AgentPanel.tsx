"use client";

import { useState } from "react";

interface AgentPanelProps {
  eventId: string;
  /** Public attestation key (base58) — fetched from /v1/attestation-key. */
  attestationKey?: string;
  /** Indicative query cost in USDC for this endpoint. */
  queryCostUsdc?: string;
  /** Backend base URL (defaults to NEXT_PUBLIC_BACKEND_URL or api.bundie.fi). */
  backendUrl?: string;
}

/**
 * AgentPanel — the dual-buyer story made structural.
 *
 * Retail trades the market on the left side of the detail page.
 * Agents pay $0.001 USDC per query to read the same market price.
 * This panel is the agent-facing affordance: shows the endpoint, the
 * cost, the canonical attestation key, and a copy button that lifts
 * the curl out of the doc tail into a first-class product surface.
 */
export function AgentPanel({
  eventId,
  attestationKey,
  queryCostUsdc = "$0.001",
  backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://api.bundie.fi",
}: AgentPanelProps) {
  const [copied, setCopied] = useState<"curl" | "key" | null>(null);

  const curl = `curl ${backendUrl}/v1/event-price?id=${eventId} \\
  -H "X-PAYMENT: <x402-signed-tx-for-0.001-USDC>"`;

  async function copy(value: string, kind: "curl" | "key") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1400);
    } catch {
      /* clipboard unavailable — silently noop, user can select manually */
    }
  }

  return (
    <aside
      aria-labelledby="agent-panel-heading"
      className="rounded-2xl border border-[var(--de-line-2)] bg-[var(--de-bg-raised)] p-6"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--de-ink-3)]">
            x402 API
          </p>
          <h2
            id="agent-panel-heading"
            className="font-serif text-lg tracking-tight text-[var(--de-ink)]"
          >
            Agents pay{" "}
            <span className="text-[var(--de-lavender)]">{queryCostUsdc}</span>{" "}
            to read this price.
          </h2>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--de-line-2)] bg-[var(--de-bg-2)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
          Live
        </span>
      </div>

      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-[var(--de-line-2)] bg-[var(--de-bg-3)]">
          <div className="flex items-center justify-between border-b border-[var(--de-line)] px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
              cURL · /v1/event-price
            </span>
            <button
              type="button"
              onClick={() => copy(curl, "curl")}
              className="rounded-md border border-transparent px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--de-ink-3)] transition-colors duration-150 ease-out hover:border-[var(--de-line-2)] hover:text-[var(--de-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--de-lavender)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--de-bg-3)]"
              aria-label="Copy curl command"
            >
              {copied === "curl" ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--de-ink-2)]">
            <code>{curl}</code>
          </pre>
        </div>

        {attestationKey ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--de-line-2)] bg-[var(--de-bg-3)] px-4 py-2.5">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--de-ink-3)]">
                Attestation key (ed25519)
              </p>
              <p
                className="mt-0.5 truncate font-mono text-[11px] text-[var(--de-ink-2)]"
                title={attestationKey}
              >
                {attestationKey}
              </p>
            </div>
            <button
              type="button"
              onClick={() => copy(attestationKey, "key")}
              className="shrink-0 rounded-md border border-transparent px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--de-ink-3)] transition-colors duration-150 ease-out hover:border-[var(--de-line-2)] hover:text-[var(--de-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--de-lavender)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--de-bg-3)]"
              aria-label="Copy attestation key"
            >
              {copied === "key" ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}

        <p className="text-[11px] leading-relaxed text-[var(--de-ink-3)]">
          Verify the response server-side against the public key. Devnet
          beta is free; production wraps the endpoint in x402 micropayments.
        </p>
      </div>
    </aside>
  );
}
