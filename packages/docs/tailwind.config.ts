import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0c",
        fg: "#e8e6e3",
        muted: "#8a8680",
        line: "#2a2a2e",
        card: "#151519",
        amber: { 400: "#d4a853" },
        purple: { 300: "#a78bfa" },
        danger: "#f87171",
        ok: "#4ade80",
      },
      fontFamily: {
        serif: ['Georgia', 'serif'],
        mono: ['"SF Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
