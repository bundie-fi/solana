import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        "earn-gold": "#d4a853",
        "earn-gold-dim": "rgba(212,168,83,0.12)",
        "earn-gold-border": "rgba(212,168,83,0.25)",
        "predict-purple": "#a78bfa",
        "predict-purple-dim": "rgba(167,139,250,0.12)",
        "predict-purple-border": "rgba(167,139,250,0.25)",
        background: "#0a0a0f",
        surface: "#111118",
        "surface-raised": "#17171f",
        border: "#1e1e2e",
        "border-subtle": "rgba(255,255,255,0.06)",
        muted: "rgba(255,255,255,0.45)",
        secondary: "rgba(255,255,255,0.65)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      letterSpacing: {
        "display-xl": "-0.04em",
        "display-lg": "-0.03em",
        "display-md": "-0.02em",
        "display-sm": "-0.015em",
      },
      boxShadow: {
        "gold-glow": "0 0 40px rgba(212,168,83,0.15), 0 0 80px rgba(212,168,83,0.05)",
        "purple-glow": "0 0 40px rgba(167,139,250,0.15), 0 0 80px rgba(167,139,250,0.05)",
        "card-dark": "rgba(0,0,0,0.5) 0px 30px 60px -20px, rgba(0,0,0,0.3) 0px 18px 36px -18px",
        "card-gold": "rgba(212,168,83,0.08) 0px 30px 60px -20px, rgba(0,0,0,0.4) 0px 18px 36px -18px",
        "card-purple": "rgba(167,139,250,0.08) 0px 30px 60px -20px, rgba(0,0,0,0.4) 0px 18px 36px -18px",
      },
      animation: {
        "fade-up": "fadeUp 0.6s ease-out forwards",
        "fade-in": "fadeIn 0.4s ease-out forwards",
        pulse: "pulse 3s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
