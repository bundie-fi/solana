import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // ── Brand (legacy aliases preserved; /markets, /portfolio, /strategy use these) ──
        "earn-gold": "#d4a853",
        "predict-purple": "#a78bfa",
        background: "#0a0a0f",
        surface: "#141420",
        border: "#1e1e2e",

        // ── Extended brand scales ──
        gold: {
          50:  "#fdf9ed",
          100: "#faf0cc",
          200: "#f4dd98",
          300: "#ecc66a",
          400: "#e0b25c",
          500: "#d4a853",
          600: "#b8893e",
          700: "#926a2f",
          800: "#6c4d23",
          900: "#4a341a",
          950: "#2a1d10",
        },
        purple: {
          50:  "#f3efff",
          100: "#e7ddff",
          200: "#d0beff",
          300: "#b69aff",
          400: "#a78bfa",
          500: "#8a6dee",
          600: "#7554d1",
          700: "#5e40a8",
          800: "#452f7c",
          900: "#2e2054",
          950: "#1a1233",
        },

        // ── Neutral ramp (dark-mode canonical) ──
        neutral: {
          0:   "#0a0a0f",
          50:  "#101018",
          100: "#141420",
          200: "#1a1a28",
          300: "#1e1e2e",
          400: "#2a2a3d",
          500: "#51516b",
          600: "#8888a3",
          700: "#b0b0c4",
          800: "#e6e6f0",
          900: "#ffffff",
        },

        // ── Semantic ──
        success: { 400: "#34d399", 500: "#10b981" },
        danger:  { 400: "#f87171", 500: "#ef4444" },
        warning: { 400: "#fbbf24" },
        info:    { 400: "#60a5fa" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // display & stat use clamp() via arbitrary class; standard steps below
        stat:    ["clamp(1.5rem, 4.5vw, 2rem)",  { lineHeight: "1", fontWeight: "700" }],
        display: ["clamp(2rem, 6vw, 3.25rem)",   { lineHeight: "1.05", fontWeight: "600" }],
        h1:      ["clamp(1.75rem, 5vw, 2.25rem)", { lineHeight: "1.15", fontWeight: "600" }],
      },
      boxShadow: {
        soft:  "0 1px 2px rgba(0,0,0,.35)",
        pop:   "0 8px 24px -8px rgba(0,0,0,.55)",
        sheet: "0 -16px 48px -8px rgba(0,0,0,.6)",
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
