/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@bundie/common"],
  // Public devnet config — baked in at build time (not secrets)
  env: {
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
    NEXT_PUBLIC_STRATEGY_PROGRAM_ID: process.env.NEXT_PUBLIC_STRATEGY_PROGRAM_ID || "Y13kaQZ6NJgyfLiL5VjZ9k5QaFJnw4REM4A5Gsfg9VV",
    NEXT_PUBLIC_PREDICTION_PROGRAM_ID: process.env.NEXT_PUBLIC_PREDICTION_PROGRAM_ID || "Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i",
    NEXT_PUBLIC_SEED_STRATEGY: process.env.NEXT_PUBLIC_SEED_STRATEGY || "93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF",
    NEXT_PUBLIC_SEED_MARKET: process.env.NEXT_PUBLIC_SEED_MARKET || "2XfBNnZ5YEH23tB4QdCNzXu2bJmeY5WwmMuikGgZP8wu",
  },
};

module.exports = nextConfig;
