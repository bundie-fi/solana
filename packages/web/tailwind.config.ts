import type { Config } from "tailwindcss";

/**
 * Palette aligned with packages/landing-page/brand.md:
 *   bg   #0a0908   ink  #f6f3ee   amber #c2570c   purple #6d28d9
 *
 * The `earn-gold` / `predict-purple` aliases are preserved so existing
 * component code compiles, but the underlying hex values shifted from the
 * old gold #d4a853 → amber #c2570c (warmer, higher saturation) to match
 * the Solana landing surface. Predict keeps a violet tone but deepened.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // ── Brand aliases (kept; semantic for current call-sites) ───────
        "earn-gold": "#c2570c",
        "predict-purple": "#8b47ee",
        background: "#0a0908",
        surface: "#121110",
        border: "rgba(246,243,238,0.15)",

        // ── Amber scale (replaces former gold scale) ────────────────────
        amber: {
          50:  "#fdf3e8",
          100: "#fbdfc3",
          200: "#f5b583",
          300: "#ee9553",
          400: "#e28646",
          500: "#d96a1c",
          600: "#c2570c",
          700: "#994307",
          800: "#6b2f05",
          900: "#401d04",
          950: "#261002",
        },
        // Gold alias points at amber so any `gold-400` / `gold-500` classes
        // already in components keep rendering a sensible colour.
        gold: {
          50:  "#fdf3e8",
          100: "#fbdfc3",
          200: "#f5b583",
          300: "#ee9553",
          400: "#e28646",
          500: "#d96a1c",
          600: "#c2570c",
          700: "#994307",
          800: "#6b2f05",
          900: "#401d04",
          950: "#261002",
        },

        // ── Purple / violet scale ───────────────────────────────────────
        purple: {
          50:  "#f4ecff",
          100: "#e4d3ff",
          200: "#cab0ff",
          300: "#b691f1",
          400: "#8b47ee",
          500: "#7a34e6",
          600: "#6d28d9",
          700: "#561fae",
          800: "#3f1881",
          900: "#281054",
          950: "#170831",
        },
        violet: {
          400: "#9945ff",
          500: "#7f2dff",
          600: "#651fe0",
        },

        // ── Neutral (warm ink ramp) ─────────────────────────────────────
        neutral: {
          0:   "#0a0908",
          50:  "#0f0e0c",
          100: "#121110",
          200: "#161413",
          300: "#1d1a17",
          400: "#2a2622",
          500: "#5c544c",
          600: "#8b8278",
          700: "#b0a89e",
          800: "#e6e0d4",
          900: "#f6f3ee",
        },

        // ── Semantic ────────────────────────────────────────────────────
        success: { 400: "#7de0a4", 500: "#38d17a" },
        danger:  { 400: "#f87171", 500: "#ef4444" },
        warning: { 400: "#ffc27d" },
        info:    { 400: "#60a5fa" },
      },
      fontFamily: {
        sans:  ["var(--font-sans)",  "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Instrument Serif", "Georgia", "serif"],
        mono:  ["var(--font-mono)",  "ui-monospace", "monospace"],
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
        amber: "0 10px 28px -10px rgba(194,87,12,0.55)",
        purple:"0 10px 28px -10px rgba(109,40,217,0.55)",
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
          "0%":   { opacity: "0.35" },
          "50%":  { opacity: "0.55" },
          "100%": { opacity: "0.35" },
        },
      },
      animation: {
        "sheet-up":    "sheet-up 260ms cubic-bezier(.34,1.56,.64,1)",
        "sheet-right": "sheet-right 260ms cubic-bezier(.34,1.56,.64,1)",
        "fade-in":     "fade-in 180ms cubic-bezier(.2,.8,.2,1)",
        shimmer:       "shimmer 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
