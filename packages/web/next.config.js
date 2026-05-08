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
  // /create-agent was renamed to /strategists when we repositioned the
  // app as bettor-first. Permanent redirect keeps any external deep links
  // (docs, social posts, the portfolio "Resume wizard" link cached in
  // bookmarks) pointing at the new route.
  async redirects() {
    return [
      {
        source: "/create-agent",
        destination: "/strategists",
        permanent: true,
      },
      {
        source: "/create-agent/:path*",
        destination: "/strategists/:path*",
        permanent: true,
      },
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
