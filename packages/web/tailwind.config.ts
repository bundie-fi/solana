import type { Config } from "tailwindcss";

/**
 * Bundie Seeker design system tokens.
 * Dark terminal UI — gold (agents/earn) + purple (markets/predict).
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // ── Brand aliases ────────────────────────────────────────────────
        "earn-gold": "#d4a853",
        "predict-purple": "#a78bfa",
        background: "#0a0a0a",
        surface: "#111111",

        // ── Design system gold ───────────────────────────────────────────
        gold: {
          DEFAULT: "#d4a853",
          2: "#e6c07a",
          tint: "rgba(212,168,83,0.08)",
          glow: "rgba(212,168,83,0.18)",
          50: "#fdf8ec",
          100: "#f9edcc",
          200: "#f2d98a",
          300: "#e6c07a",
          400: "#d4a853",
          500: "#c09040",
          600: "#9a7030",
          700: "#735222",
          800: "#4d3516",
          900: "#26190b",
        },

        // ── Design system purple ─────────────────────────────────────────
        purple: {
          DEFAULT: "#a78bfa",
          2: "#c4b5fd",
          tint: "rgba(167,139,250,0.10)",
          glow: "rgba(167,139,250,0.20)",
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
        },

        // ── Amber / status ───────────────────────────────────────────────
        amber: {
          DEFAULT: "#f59e0b",
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },

        // ── Green / yes ──────────────────────────────────────────────────
        green: {
          DEFAULT: "#22c55e",
          2: "#4ade80",
          tint: "rgba(34,197,94,0.12)",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
        },

        // ── Red / no ─────────────────────────────────────────────────────
        red: {
          DEFAULT: "#ef4444",
          2: "#f87171",
          tint: "rgba(239,68,68,0.12)",
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
        },

        // ── Blue / human bet ─────────────────────────────────────────────
        blue: {
          DEFAULT: "#60a5fa",
          tint: "rgba(96,165,250,0.12)",
          400: "#60a5fa",
          500: "#3b82f6",
        },

        // ── Neutral (dark terminal ramp) ─────────────────────────────────
        neutral: {
          0:   "#0a0a0a",
          50:  "#111111",
          100: "#161616",
          200: "#1c1c1c",
          300: "#232323",
          400: "#2a2a2a",
          500: "#383838",
          600: "#525252",
          700: "#737373",
          800: "#a3a3a3",
          900: "#e5e5e5",
          950: "#f5f5f5",
        },

        // ── Semantic ─────────────────────────────────────────────────────
        success: { DEFAULT: "#22c55e", 400: "#4ade80", 500: "#22c55e" },
        danger:  { DEFAULT: "#ef4444", 400: "#f87171", 500: "#ef4444" },
        warning: { DEFAULT: "#f59e0b", 400: "#fbbf24" },
        info:    { DEFAULT: "#60a5fa", 400: "#60a5fa" },
        violet:  { 400: "#9945ff", 500: "#7f2dff" },
      },
      fontFamily: {
        sans:  ["var(--font-sans)",  "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-display)", "Playfair Display", "Instrument Serif", "Georgia", "serif"],
        mono:  ["var(--font-mono)",  "JetBrains Mono", "ui-monospace", "monospace"],
        display: ["var(--font-display)", "Playfair Display", "Georgia", "serif"],
      },
      fontSize: {
        stat:    ["clamp(1.5rem, 4.5vw, 2rem)",  { lineHeight: "1", fontWeight: "700" }],
        display: ["clamp(2rem, 6vw, 3.25rem)",   { lineHeight: "1.05", fontWeight: "400", letterSpacing: "-0.02em" }],
        h1:      ["clamp(1.75rem, 5vw, 2.25rem)", { lineHeight: "1.15", fontWeight: "400", letterSpacing: "-0.015em" }],
      },
      boxShadow: {
        soft:  "0 1px 2px rgba(0,0,0,.45)",
        pop:   "0 8px 24px -8px rgba(0,0,0,.65)",
        sheet: "0 -16px 48px -8px rgba(0,0,0,.7)",
        gold:  "0 10px 28px -10px rgba(212,168,83,0.35)",
        purple:"0 10px 28px -10px rgba(167,139,250,0.35)",
        amber: "0 10px 28px -10px rgba(245,158,11,0.35)",
      },
      transitionTimingFunction: {
        "out-quick": "cubic-bezier(.2,.8,.2,1)",
        spring:      "cubic-bezier(.34,1.56,.64,1)",
      },
      transitionDuration: {
        "90":  "90ms",
        "180": "180ms",
        "260": "260ms",
        "420": "420ms",
      },
      maxWidth: {
        content: "1200px",
        phone: "390px",
      },
      keyframes: {
        "sheet-up": {
          "0%":   { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
        "sheet-right": {
          "0%":   { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        "fade-in": {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "feed-enter": {
          "0%":   { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%":   { transform: "scale(0.8)", opacity: "1" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        "agent-heartbeat": {
          "0%, 100%": { transform: "scale(1)", opacity: "0" },
          "10%":      { transform: "scale(1)", opacity: "0.5" },
          "60%":      { transform: "scale(1.5)", opacity: "0" },
        },
        "nav-pulse": {
          "0%, 100%": { filter: "drop-shadow(0 0 0 transparent)" },
          "50%":      { filter: "drop-shadow(0 0 6px rgba(212,168,83,0.18))" },
        },
        spin: {
          "to": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "sheet-up":       "sheet-up 260ms cubic-bezier(.34,1.56,.64,1)",
        "sheet-right":    "sheet-right 260ms cubic-bezier(.34,1.56,.64,1)",
        "fade-in":        "fade-in 180ms cubic-bezier(.2,.8,.2,1)",
        shimmer:          "shimmer 1.6s linear infinite",
        "feed-enter":     "feed-enter 280ms cubic-bezier(.25,.4,.25,1) both",
        "pulse-ring":     "pulse-ring 2s cubic-bezier(.25,.4,.25,1) infinite",
        "agent-heartbeat":"agent-heartbeat 2.6s ease-out infinite",
        "nav-pulse":      "nav-pulse 3s ease-in-out infinite",
        spin:             "spin 0.9s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
