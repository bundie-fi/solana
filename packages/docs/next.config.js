/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deployed at solana.bundie.fi/docs — every asset and route is rooted
  // under /docs so the same build works whether mounted at the apex or
  // reverse-proxied from the main app.
  basePath: "/docs",
  assetPrefix: "/docs",
  output: "standalone",
  reactStrictMode: true,
};

module.exports = nextConfig;
