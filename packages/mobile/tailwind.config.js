/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        'earn-gold': '#d4a853',
        'predict-purple': '#a78bfa',
        'background': '#0a0a0f',
        'surface': '#141420',
        'border': '#1e1e2e',
      },
    },
  },
  plugins: [],
}
