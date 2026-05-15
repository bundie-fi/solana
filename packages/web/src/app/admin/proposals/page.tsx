// Admin-only review surface for /v1/market-proposals. Token-gated:
// admin pastes BUNDIE_ADMIN_TOKEN into a local-storage backed input
// once per device, then sees the queue. Not linked from any user nav.
//
// Hidden from search engines + sitemaps so robots don't index it.
export const metadata = {
  title: "Admin · Proposals · Bundie",
  robots: { index: false, follow: false },
};

export { default } from "./AdminProposals";
