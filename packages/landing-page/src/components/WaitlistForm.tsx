"use client";

import { useState } from "react";

type Variant = "hero" | "final";

export default function WaitlistForm({ variant = "hero" }: { variant?: Variant }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || state === "loading" || state === "done") return;

    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!ok) {
      setState("error");
      return;
    }

    setState("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error();
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <form className="hero-form" aria-live="polite">
        <div className="joined">
          <span aria-hidden>✓</span>
          <span>You're on the list. We'll reach out when devnet opens to early backers.</span>
        </div>
      </form>
    );
  }

  const microId = variant === "hero" ? "hero-micro" : "final-micro";
  const microText =
    state === "error"
      ? "Enter a valid email address."
      : "No spam. We'll email you at launch.";
  const microColor = state === "error" ? "var(--amber-3)" : "var(--ink-4)";

  return (
    <form className="hero-form" onSubmit={submit} noValidate>
      <div className="row">
        <label htmlFor={`${variant}-email`} className="sr-only" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
          Email address
        </label>
        <input
          id={`${variant}-email`}
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@somewhere.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          disabled={state === "loading"}
          required
        />
        <button type="submit" className="btn-amber" disabled={state === "loading"}>
          {state === "loading" ? "Joining…" : "Join waitlist"}
        </button>
      </div>
      <div id={microId} className="hero-microcopy" style={{ color: microColor }}>
        {microText}
      </div>
    </form>
  );
}
