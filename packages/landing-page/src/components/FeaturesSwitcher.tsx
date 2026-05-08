"use client";

import { useState, useEffect } from "react";
import type { JSX } from "react";

/* ── INSIDE BUNDIE feature switcher ─────────────────────────────────────
   Mirrors Aqua0's FEATURES tab pattern: a left-rail name list, a
   middle title+body that swaps on click, and a right-side visual.
   Four tabs cover the actual product surface: AI agents, LS-LMSR
   prediction markets, oracle-free NAV settlement, and SNS identity.
   ──────────────────────────────────────────────────────────────────── */

type FeatureSpec = {
  id: string;
  number: string;
  name: string;
  title: [string, string];
  body: string;
  Visual: () => JSX.Element;
};

const FEATURES: FeatureSpec[] = [
  {
    id: "ai-agents",
    number: "01",
    name: "AI agents",
    title: ["Agents trade real DeFi.", "You watch on-chain."],
    body: "Bundie hosts AI trading agents on Solana. Each one has a .bundie.sol identity and a brain that reasons every tick, Claude Sonnet reading live mainnet rates, then executing real Marinade / Kamino / Solend / Jupiter Perps calls. Every action lands as a verifiable on-chain tx.",
    Visual: AiAgentVisual,
  },
  {
    id: "prediction-market",
    number: "02",
    name: "Prediction Market",
    title: ["LS-LMSR markets.", "Settled by NAV."],
    body: "Each market is a Logarithmic Market Scoring Rule pool, deep, continuous liquidity from a single creator. Resolution reads on-chain NAV at the resolution slot. No oracle dispute period, no settlement committee.",
    Visual: PredictionMarketVisual,
  },
  {
    id: "nav-settlement",
    number: "03",
    name: "NAV Settlement",
    title: ["No oracle.", "No committee."],
    body: "Each agent's NAV is computed from its on-chain positions and committed every few ticks. Markets settle by reading that account directly. The truth is the chain, there's nobody to argue with.",
    Visual: NavSettlementVisual,
  },
  {
    id: "identity",
    number: "04",
    name: "Identity",
    title: ["SNS-native agents.", "Always your wallet."],
    body: "Every agent has a .bundie.sol subdomain via Solana Name Service. Your wallet stays your wallet. Bundie never custodies funds, capital flows through programs your transactions sign.",
    Visual: IdentityVisual,
  },
];

function FeaturesSwitcher() {
  const [activeId, setActiveId] = useState(FEATURES[0].id);
  const [paused, setPaused] = useState(false);
  const active = FEATURES.find((f) => f.id === activeId) ?? FEATURES[0];
  const Visual = active.Visual;

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setActiveId((current) => {
        const idx = FEATURES.findIndex((f) => f.id === current);
        return FEATURES[(idx + 1) % FEATURES.length].id;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <div className="features-switcher">
      {/* Left rail, minimalist, only the names. */}
      <div className="features-rail">
        {FEATURES.map((f) => {
          const isActive = f.id === activeId;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setActiveId(f.id);
                setPaused(true);
                setTimeout(() => setPaused(false), 12000);
              }}
              className={`features-tab ${isActive ? "is-active" : ""}`}
            >
              {f.name}
            </button>
          );
        })}
      </div>

      {/* Middle, title + body. Keyed on activeId so the cross-fade
          keyframe restarts on every tab change. */}
      <div className="features-copy features-fade" key={`copy-${activeId}`}>
        <h3 className="features-title">
          {active.title[0]}
          <span className="features-title-2">{active.title[1]}</span>
        </h3>
        <p className="features-body">{active.body}</p>
      </div>

      {/* Right, the active feature's visual. Same keyed cross-fade. */}
      <div className="features-visual features-fade" key={`vis-${activeId}`}>
        <Visual />
      </div>
    </div>
  );
}

function AiAgentVisual() {
  return (
    <div className="vis-card">
      <p className="vis-eyebrow">Agent · alpha-kamino.bundie.sol</p>
      <p className="vis-big-num">
        $684<span className="vis-dim">.92</span>
      </p>
      <p className="vis-sub">Live NAV · committed every few ticks</p>

      <div className="vis-row-2">
        <div>
          <span className="vis-label">Last action</span>
          <span className="vis-val">Marinade stake</span>
        </div>
        <div>
          <span className="vis-label">Tick</span>
          <span className="vis-val">epoch 32</span>
        </div>
      </div>
    </div>
  );
}

function PredictionMarketVisual() {
  return (
    <div className="vis-card">
      <p className="vis-eyebrow">Market · 7-day NAV out-perform</p>
      <p className="vis-question">
        Will alpha-kamino out-NAV beta-stake by 5% in 7 days?
      </p>

      <div className="vis-yes-no">
        <div className="vis-yn vis-yn-yes">
          <span className="vis-yn-side">YES</span>
          <span className="vis-yn-px">0.62</span>
        </div>
        <div className="vis-yn vis-yn-no">
          <span className="vis-yn-side">NO</span>
          <span className="vis-yn-px">0.38</span>
        </div>
      </div>

      <p className="vis-foot">
        LS-LMSR pool · settles from on-chain NAV at slot 312,841,209
      </p>
    </div>
  );
}

function NavSettlementVisual() {
  return (
    <div className="vis-card vis-card-mono">
      <p className="vis-eyebrow">NAV commit · alpha-kamino</p>
      <div className="vis-mono-row">
        <span className="vis-mono-k">slot</span>
        <span className="vis-mono-v">312,841,209</span>
      </div>
      <div className="vis-mono-row">
        <span className="vis-mono-k">nav_lamports</span>
        <span className="vis-mono-v">1,247_926_404</span>
      </div>
      <div className="vis-mono-row">
        <span className="vis-mono-k">protocols</span>
        <span className="vis-mono-v">kamino, marinade</span>
      </div>
      <div className="vis-mono-row">
        <span className="vis-mono-k">signer</span>
        <span className="vis-mono-v">prediction_market</span>
      </div>
      <div className="vis-mono-foot">
        <span className="vis-ok">●</span> verifiable on devnet
      </div>
    </div>
  );
}

function IdentityVisual() {
  return (
    <div className="vis-card">
      <p className="vis-eyebrow">Solana Name Service</p>
      <p className="vis-sns">alpha-kamino<span className="vis-dim">.bundie.sol</span></p>
      <p className="vis-sub">Owner · 7Fz9…3kQp</p>

      <div className="vis-row-2">
        <div>
          <span className="vis-label">Custody</span>
          <span className="vis-val">Your wallet</span>
        </div>
        <div>
          <span className="vis-label">Program</span>
          <span className="vis-val">prediction_market</span>
        </div>
      </div>
    </div>
  );
}

export { FeaturesSwitcher };
