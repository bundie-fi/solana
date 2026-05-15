const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `output: "standalone"` removed — recent Next.js exits immediately after
  // "Ready" when standalone is set but `next start` is the entry, leaving
  // Railway to mark the deploy FAILED. Re-enable only if the Dockerfile
  // also switches to `node .next/standalone/server.js` (and copies
  // .next/static + public/ into the standalone tree).
  images: {
    // Allow next/image to optimise our internal assets (protocol icons,
    // agent avatars). Remote backend-served avatars are explicitly
    // allowlisted; everything else is local /public.
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.bundie.fi",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  transpilePackages: ["@bundie/common"],
  // 2026-05-15: oracle-positioning overhaul. The strategy-token product
  // (agents, strategists, NAV markets, activity feed) was retired in
  // favour of the event-oracle surface (live event markets + x402 reads
  // for AI agents). Permanent redirects keep external links, social
  // posts, and bookmarks pointing somewhere useful instead of 404ing.
  async redirects() {
    return [
      // /events was the old route for the event-market surface; renamed
      // to /markets so the nav slot and IA match the new product story.
      { source: "/events", destination: "/markets", permanent: true },
      { source: "/events/:id", destination: "/markets/:id", permanent: true },
      // /api was briefly a dev-docs page inside the trader app. Moved
      // back to the marketing surface (solana.bundie.fi has a "For
      // agents" section) so the app is unambiguously the trader surface.
      // External 302 (not permanent) because we may reshape this later.
      { source: "/api", destination: "https://solana.bundie.fi/#for-agents", permanent: false },
      // Retired strategy-token routes. Everything lands on /markets so
      // the user sees the live product instead of a 404.
      { source: "/agents", destination: "/markets", permanent: true },
      { source: "/agent/:path*", destination: "/markets", permanent: true },
      { source: "/strategists", destination: "/markets", permanent: true },
      { source: "/strategists/:path*", destination: "/markets", permanent: true },
      { source: "/feed", destination: "/markets", permanent: true },
      { source: "/market/:id", destination: "/markets", permanent: true },
      // Earlier rename, pre-overhaul. Kept so /create-agent → /strategists
      // → /markets follows the redirect chain to the right destination.
      { source: "/create-agent", destination: "/markets", permanent: true },
      { source: "/create-agent/:path*", destination: "/markets", permanent: true },
    ];
  },
  // Public devnet config — baked in at build time (not secrets)
  env: {
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
    NEXT_PUBLIC_STRATEGY_PROGRAM_ID: process.env.NEXT_PUBLIC_STRATEGY_PROGRAM_ID || "Bun4tBew11dWjx1mRuMmJZFmxsGsxYSYhdfe1w7JaHVm",
    NEXT_PUBLIC_PREDICTION_PROGRAM_ID: process.env.NEXT_PUBLIC_PREDICTION_PROGRAM_ID || "Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4",
    NEXT_PUBLIC_SEED_STRATEGY: process.env.NEXT_PUBLIC_SEED_STRATEGY || "93amC41qp6YfTQwsugjgRG21eUtmbqiCx4VJjzE2xZYF",
    NEXT_PUBLIC_SEED_MARKET: process.env.NEXT_PUBLIC_SEED_MARKET || "2XfBNnZ5YEH23tB4QdCNzXu2bJmeY5WwmMuikGgZP8wu",
  },
};

module.exports = withBundleAnalyzer(nextConfig);
