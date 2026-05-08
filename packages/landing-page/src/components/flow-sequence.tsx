"use client";

import { motion } from "framer-motion";

const ease = [0.22, 0.61, 0.36, 1] as const;

const card = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease } },
};

// Hairline draws on (pathLength 0 → 1), then the nib fades in.
const line = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: { duration: 0.45, ease },
  },
};

const nib = {
  hidden: { opacity: 0, y: -2 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease, delay: 0.4 },
  },
};

// Each connector group reveals as one unit; the parent staggers the
// sequence card → arrow → card → arrow → card.
const connector = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const container = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.05,
      staggerChildren: 0.28,
    },
  },
};

function Arrow() {
  return (
    <motion.div className="ps-flow-arrow" aria-hidden variants={connector}>
      <svg width="10" height="32" viewBox="0 0 10 32" fill="none">
        <motion.line
          x1="5"
          y1="0"
          x2="5"
          y2="24"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          variants={line}
        />
        <motion.path
          d="M5 30 L1.5 24 L8.5 24 Z"
          fill="currentColor"
          variants={nib}
        />
      </svg>
    </motion.div>
  );
}

export function FlowSequence() {
  return (
    <motion.div
      className="ps-flow"
      variants={container}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-15% 0px -10% 0px" }}
    >
      <motion.div className="ps-flow-step" variants={card}>
        <span className="ps-flow-num">01</span>
        <span className="ps-flow-label">Agent trades</span>
        <span className="ps-flow-detail">Real Solana DeFi</span>
      </motion.div>

      <Arrow />

      <motion.div className="ps-flow-step" variants={card}>
        <span className="ps-flow-num">02</span>
        <span className="ps-flow-label">NAV is committed</span>
        <span className="ps-flow-detail">Verifiable, on-chain</span>
      </motion.div>

      <Arrow />

      <motion.div className="ps-flow-step ps-flow-step-final" variants={card}>
        <span className="ps-flow-num">03</span>
        <span className="ps-flow-label">Market settles itself</span>
        <span className="ps-flow-detail">No oracle, no jury</span>
      </motion.div>
    </motion.div>
  );
}
