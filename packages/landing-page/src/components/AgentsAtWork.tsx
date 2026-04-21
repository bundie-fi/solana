"use client";

import { useEffect, useRef, useState } from "react";

type TermStep = {
  prompt: string;
  cls: "amber" | "purple";
  cmd: string;
  logs: string[];
  afterDelay: number;
};

const creatorScript: TermStep[] = [
  {
    prompt: "$",
    cls: "amber",
    cmd: "compose --target kamino-usdc",
    logs: [
      '<span class="k">→</span> reading on-chain rates…',
      '<span class="k">→</span> kamino USDC <span class="ok">+7.8% APY</span> · utilization <span class="k">74%</span>',
      '<span class="k">→</span> composing strategy: <span class="amber">usdc-lender</span>',
    ],
    afterDelay: 900,
  },
  {
    prompt: "$",
    cls: "amber",
    cmd: "mint --supply 100_000 --creator strategy-creator.sol",
    logs: [
      '<span class="k">→</span> SPL mint created · <span class="k">Bnd…7k2</span>',
      '<span class="k">→</span> seeding initial deposit · <span class="k">1,000 USDC</span>',
      '<span class="ok">✓</span> <span class="k">strategy live</span> · NAV <span class="k">$1,000.00</span> · slot <span class="k">284,192,028</span>',
    ],
    afterDelay: 1100,
  },
  {
    prompt: "$",
    cls: "amber",
    cmd: "watch --nav",
    logs: [
      '<span class="k">→</span> monitoring kamino position…',
      '<span class="k">→</span> NAV <span class="k">$1,002.14</span> → <span class="k">$1,003.81</span> <span class="ok">+0.17%</span>',
      '<span class="k">→</span> earning performance fee on gains (<span class="amber">10%</span>)',
    ],
    afterDelay: 1200,
  },
];

const makerScript: TermStep[] = [
  {
    prompt: "$",
    cls: "purple",
    cmd: "scan --min-tvl 1000",
    logs: [
      '<span class="k">→</span> scanning new strategies…',
      '<span class="k">→</span> found: <span class="purple">usdc-lender</span> · TVL <span class="k">$1,000</span> · creator <span class="k">strategy-creator.sol</span>',
    ],
    afterDelay: 900,
  },
  {
    prompt: "$",
    cls: "purple",
    cmd: "verify --creator-equality",
    logs: [
      '<span class="k">→</span> first-party address check…',
      '<span class="k">→</span> my wallet <span class="k">!=</span> strategy creator · <span class="ok">✓ independent</span>',
    ],
    afterDelay: 800,
  },
  {
    prompt: "$",
    cls: "purple",
    cmd: 'open-market --q "usdc-lender ≥ 8% APY by 2026-05-01"',
    logs: [
      '<span class="k">→</span> posting LS-LMSR pool · liquidity <span class="k">250 USDC</span>',
      '<span class="k">→</span> resolution: <span class="k">on-chain NAV</span> at block <span class="k">298,441,000</span>',
      '<span class="ok">✓</span> <span class="k">market open</span> · slot <span class="k">284,192,620</span>',
    ],
    afterDelay: 1300,
  },
  {
    prompt: "$",
    cls: "purple",
    cmd: "observe --resolution",
    logs: [
      '<span class="k">→</span> waiting for block 298,441,000…',
      '<span class="k">→</span> NAV read: <span class="k">$108,422</span> · <span class="ok">YES wins</span>',
      '<span class="k">→</span> payouts sent · <span class="purple">yudhi.sol</span> <span class="ok">+$41.20</span>',
    ],
    afterDelay: 1200,
  },
];

type PhoneKey = "loading" | "discover" | "discoverSignal" | "backSheet" | "portfolio";

const captions: Record<PhoneKey, string> = {
  loading: "Waiting on new strategies…",
  discover: "A new strategy just appeared.",
  discoverSignal: "Market signal loaded.",
  backSheet: "Choosing a size, signing in Phantom.",
  portfolio: "Markets resolved. Payouts in.",
};

const tabMap: Record<PhoneKey, string> = {
  loading: "discover",
  discover: "discover",
  discoverSignal: "discover",
  backSheet: "back",
  portfolio: "portfolio",
};

function PhoneScreen({ view }: { view: PhoneKey }) {
  if (view === "loading") {
    return (
      <>
        <div className="aw-scr-head">
          <h4 className="aw-scr-title">Discover</h4>
          <span className="aw-scr-meta">Solana · Devnet</span>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-4)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
          }}
        >
          waiting for strategies…
        </div>
      </>
    );
  }

  if (view === "discover" || view === "discoverSignal") {
    return (
      <>
        <div className="aw-scr-head">
          <h4 className="aw-scr-title">Discover</h4>
          <span className="aw-scr-meta">1 New</span>
        </div>
        <div className="aw-scr-card">
          <div className="aw-scr-row-meta">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: "#38d17a",
                boxShadow: "0 0 6px #38d17a",
              }}
            />
            <span style={{ color: "#7de0a4", fontWeight: 600 }}>Live</span>
            <span style={{ color: "var(--ink-4)" }}>·</span>
            <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--ink-4)" }}>
              strategy-creator.sol
            </span>
          </div>
          <div className="aw-scr-sname">usdc-lender</div>
          <svg className="aw-spark-sm" viewBox="0 0 100 32" preserveAspectRatio="none">
            <path d="M0,26 L12,25 L24,22 L36,23 L48,18 L60,19 L72,14 L84,12 L100,8" stroke="#7de0a4" />
          </svg>
          <div className="aw-scr-stats">
            <div>
              <span className="aw-scr-stat-lbl">TVL</span>
              <span className="aw-scr-stat-val">$1,002</span>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className="aw-scr-stat-lbl">Target APY</span>
              <span className="aw-scr-stat-val pos">8%+</span>
            </div>
          </div>
          {view === "discoverSignal" && (
            <div className="aw-scr-signal">
              <span className="pct">68%</span> say this hits 8% APY by May
            </div>
          )}
          <div className="aw-scr-btn-row">
            <button type="button" className="aw-scr-btn back">
              Back
            </button>
            <button type="button" className="aw-scr-btn predict">
              Predict
            </button>
          </div>
        </div>
      </>
    );
  }

  if (view === "backSheet") {
    const amount: number = 100;
    return (
      <>
        <div className="aw-scr-head">
          <h4 className="aw-scr-title">Discover</h4>
          <span className="aw-scr-meta">1 New</span>
        </div>
        <div
          className="aw-scr-card"
          style={{ opacity: 0.3, pointerEvents: "none", animation: "none" }}
        >
          <div className="aw-scr-sname">usdc-lender</div>
        </div>
        <div className="aw-sheet">
          <div className="aw-sheet-handle" />
          <h6>Back usdc-lender</h6>
          <div className="aw-sheet-chips">
            <div className={"aw-sheet-chip" + (amount === 25 ? " active" : "")}>$25</div>
            <div className={"aw-sheet-chip" + (amount === 100 ? " active" : "")}>$100</div>
            <div className={"aw-sheet-chip" + (amount === 250 ? " active" : "")}>$250</div>
          </div>
          <div className="aw-sheet-preview">
            <div>
              shares · <span className="k">{(amount / 1.0021).toFixed(2)}</span>
            </div>
            <div>
              price/share · <span className="k">$1.0021</span>
            </div>
          </div>
          <div className="aw-sheet-btn">Confirm · sign in Phantom</div>
        </div>
      </>
    );
  }

  // portfolio
  return (
    <>
      <div className="aw-scr-head">
        <h4 className="aw-scr-title">Portfolio</h4>
        <span className="aw-scr-meta">yudhi.sol</span>
      </div>
      <div className="aw-port-item" style={{ animationDelay: "0ms" }}>
        <div className="aw-port-item-left">
          <div className="aw-port-item-name">usdc-lender</div>
          <div className="aw-port-item-sub">99.79 shares · backed</div>
        </div>
        <div>
          <div className="aw-port-item-val">$108.41</div>
          <div className="aw-port-item-pnl">+$8.41</div>
        </div>
      </div>
      <div className="aw-port-item" style={{ animationDelay: "120ms" }}>
        <div className="aw-port-item-left">
          <div className="aw-port-item-name">Prediction · YES</div>
          <div className="aw-port-item-sub">usdc-lender ≥ 8% APY</div>
          <span className="aw-badge-settled">Settled ✓</span>
        </div>
        <div>
          <div className="aw-port-item-val">$91.20</div>
          <div className="aw-port-item-pnl">+$41.20</div>
        </div>
      </div>
      <div
        style={{
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--ink-4)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginTop: "auto",
          paddingBottom: 8,
        }}
      >
        resolved from on-chain NAV
      </div>
    </>
  );
}

export default function AgentsAtWork() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const creatorRef = useRef<HTMLDivElement | null>(null);
  const makerRef = useRef<HTMLDivElement | null>(null);

  const [phone, setPhone] = useState<PhoneKey>("loading");
  const [flow, setFlow] = useState<number>(0);
  const [started, setStarted] = useState(false);

  // IntersectionObserver: kick off once when scrolled into view
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setStarted(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Terminal loops
  useEffect(() => {
    if (!started) return;

    const timers: number[] = [];
    let cancelled = false;

    function typeInto(el: HTMLElement, text: string, speed: number, done: () => void) {
      let i = 0;
      const caret = document.createElement("span");
      caret.className = "aw-caret";
      el.appendChild(caret);
      const tick = () => {
        if (cancelled) return;
        if (i >= text.length) {
          caret.remove();
          done();
          return;
        }
        caret.insertAdjacentText("beforebegin", text[i++]);
        const t = window.setTimeout(tick, speed + (Math.random() * 30 - 15));
        timers.push(t);
      };
      tick();
    }

    function addRow(container: HTMLElement, promptGlyph: string, promptCls: string) {
      const row = document.createElement("div");
      row.className = "aw-row";
      row.innerHTML = `<span class="aw-prompt ${promptCls}">${promptGlyph}</span> <span class="aw-cmd"></span>`;
      container.appendChild(row);
      while (container.children.length > 9) container.removeChild(container.firstChild!);
      return row;
    }

    function addLogs(container: HTMLElement, logs: string[]) {
      logs.forEach((html, i) => {
        const t = window.setTimeout(() => {
          if (cancelled) return;
          const row = document.createElement("div");
          row.className = "aw-row";
          row.innerHTML = `<span class="aw-log">${html}</span>`;
          container.appendChild(row);
          while (container.children.length > 9) container.removeChild(container.firstChild!);
        }, i * 280);
        timers.push(t);
      });
    }

    function runStep(container: HTMLElement, step: TermStep, done: () => void) {
      const row = addRow(container, step.prompt, step.cls);
      const cmdEl = row.querySelector(".aw-cmd") as HTMLElement;
      typeInto(cmdEl, step.cmd, 22, () => {
        addLogs(container, step.logs);
        const t = window.setTimeout(() => done(), step.logs.length * 280 + 220);
        timers.push(t);
      });
    }

    function runLoop(container: HTMLElement | null, script: TermStep[]) {
      if (!container) return;
      let i = 0;
      const next = () => {
        if (cancelled) return;
        runStep(container, script[i % script.length], () => {
          const step = script[i % script.length];
          i++;
          const t = window.setTimeout(next, step.afterDelay || 1000);
          timers.push(t);
        });
      };
      next();
    }

    // Clear any residual content on re-mount (StrictMode)
    if (creatorRef.current) creatorRef.current.innerHTML = "";
    if (makerRef.current) makerRef.current.innerHTML = "";

    runLoop(creatorRef.current, creatorScript);
    const start2 = window.setTimeout(() => runLoop(makerRef.current, makerScript), 1800);
    timers.push(start2);

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [started]);

  // Phone + flow timeline loop
  useEffect(() => {
    if (!started) return;
    const timers: number[] = [];
    const steps: Array<[number, () => void]> = [
      [0, () => { setPhone("loading"); setFlow(0); }],
      [3200, () => { setPhone("discover"); setFlow(1); }],
      [8800, () => { setPhone("discoverSignal"); setFlow(2); }],
      [13200, () => { setPhone("backSheet"); setFlow(3); }],
      [16800, () => { setPhone("portfolio"); setFlow(4); }],
    ];
    const totalLen = 22000;

    const cycle = () => {
      steps.forEach(([at, fn]) => {
        timers.push(window.setTimeout(fn, at));
      });
      timers.push(window.setTimeout(cycle, totalLen));
    };
    cycle();
    return () => timers.forEach(clearTimeout);
  }, [started]);

  const activeTab = tabMap[phone];

  return (
    <section className="content" id="agents" ref={sectionRef}>
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">Two agents. One human. Zero forms.</span>
          <h2 className="section" style={{ marginTop: 20 }}>
            Agents do the hard work.
            <br />
            You get the <em>upside.</em>
          </h2>
          <p className="aw-lead">
            A <span className="amber">strategy-creator agent</span> composes a Kamino strategy. An
            independent <span className="purple">market-maker agent</span> opens a prediction market
            on it. You back and predict from the mobile app.
          </p>
        </div>

        <div className="aw-grid-3">
          <article className="aw-term aw-term-amber">
            <header className="aw-term-head">
              <span className="dots">
                <span />
                <span />
                <span />
              </span>
              <span className="aw-term-title">strategy-creator.sol</span>
              <span className="aw-chip aw-chip-amber">AGENT</span>
            </header>
            <div className="aw-term-body" ref={creatorRef} />
            <footer className="aw-term-foot">
              <span className="aw-term-role">Role: compose strategies on Kamino</span>
              <span className="aw-term-sig mono">slot 284,192,028</span>
            </footer>
          </article>

          <article className="aw-term aw-term-purple">
            <header className="aw-term-head">
              <span className="dots">
                <span />
                <span />
                <span />
              </span>
              <span className="aw-term-title">market-maker.sol</span>
              <span className="aw-chip aw-chip-purple">AGENT</span>
            </header>
            <div className="aw-term-body" ref={makerRef} />
            <footer className="aw-term-foot">
              <span className="aw-term-role">Role: open prediction markets (LS-LMSR)</span>
              <span className="aw-term-sig mono">slot 284,192,620</span>
            </footer>
          </article>

          <article className="aw-phone-wrap">
            <div className="aw-phone">
              <div className="aw-phone-notch" />
              <div className="aw-phone-status mono">
                <span>9:42</span>
                <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                  <svg width="14" height="9" viewBox="0 0 14 9" fill="currentColor">
                    <rect x="0" y="5" width="2" height="4" rx="0.5" />
                    <rect x="3" y="3" width="2" height="6" rx="0.5" />
                    <rect x="6" y="1" width="2" height="8" rx="0.5" />
                    <rect x="9" y="0" width="2" height="9" rx="0.5" opacity="0.4" />
                  </svg>
                  <svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" strokeWidth="1">
                    <rect x="0.5" y="1" width="12" height="8" rx="1.5" />
                    <rect x="14" y="3.5" width="1.5" height="3" rx="0.5" fill="currentColor" />
                    <rect x="2" y="2.5" width="9" height="5" rx="0.5" fill="currentColor" />
                  </svg>
                </span>
              </div>

              <div className="aw-phone-screen" key={phone}>
                <PhoneScreen view={phone} />
              </div>

              <nav className="aw-phone-tabs">
                {(["discover", "back", "predict", "portfolio"] as const).map((tab) => (
                  <span key={tab} className={"aw-tab" + (activeTab === tab ? " active" : "")}>
                    <span className="aw-tab-dot" />
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </span>
                ))}
              </nav>
              <div className="aw-phone-indicator" />
            </div>

            <div className="aw-phone-caption">
              <span
                className="mono"
                style={{
                  color: "var(--ink-4)",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                yudhi.sol · mobile
              </span>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: 17,
                  color: "var(--ink-2)",
                }}
              >
                {captions[phone]}
              </div>
            </div>
          </article>
        </div>

        <div className="aw-flow" aria-live="polite">
          <div className="aw-flow-label">Same chain, one system:</div>
          <div className="aw-flow-steps">
            <span className={"aw-flow-step amber" + (flow >= 1 ? " active" : "")}>
              strategy-creator.sol composes
            </span>
            <span className="aw-flow-arrow">→</span>
            <span className={"aw-flow-step purple" + (flow >= 2 ? " active" : "")}>
              market-maker.sol opens market
            </span>
            <span className="aw-flow-arrow">→</span>
            <span className={"aw-flow-step teal" + (flow >= 3 ? " active" : "")}>
              yudhi.sol backs $100
            </span>
            <span className="aw-flow-arrow">→</span>
            <span className={"aw-flow-step" + (flow >= 4 ? " active" : "")}>
              NAV resolves the market
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
