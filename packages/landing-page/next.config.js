/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  async redirects() {
    // Apex (solana.bundie.fi) serves the landing page; the trader app
    // lives at app.solana.bundie.fi. Bounce hand-typed or shared app
    // paths over to the subdomain so they don't 404.
    return [
      { source: '/markets', destination: 'https://app.solana.bundie.fi/markets', permanent: false },
      { source: '/markets/:id', destination: 'https://app.solana.bundie.fi/markets/:id', permanent: false },
      { source: '/launch', destination: 'https://app.solana.bundie.fi/launch', permanent: false },
      { source: '/portfolio', destination: 'https://app.solana.bundie.fi/portfolio', permanent: false },
      { source: '/wallet', destination: 'https://app.solana.bundie.fi/wallet', permanent: false },
    ];
  },
};

module.exports = nextConfig;
