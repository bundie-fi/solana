/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  async rewrites() {
    // Proxy /docs/* to the bundie-docs service on Railway's internal network.
    // This serves solana.bundie.fi/docs without a separate domain.
    const docsOrigin =
      process.env.DOCS_INTERNAL_URL || "http://bundie-docs.railway.internal:3002";
    return [
      {
        source: "/docs",
        destination: `${docsOrigin}/docs`,
      },
      {
        source: "/docs/:path*",
        destination: `${docsOrigin}/docs/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
