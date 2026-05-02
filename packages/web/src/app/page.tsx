import { HomeFeed } from "@/components/home-feed";
import { TopPerformersStrip } from "@/components/top-performers-strip";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Home = live activity feed.
 *
 * This used to be a redirect to /markets; we now render the gamified
 * feed as the root. The `HomeFeed` client component handles polling
 * on a 15s tick and merging on-chain market activity with vault
 * balance deltas into a single reverse-chronological stream.
 *
 * `<TopPerformersStrip />` is a server component fetching `/api/agents/...`
 * P&L data; we pass it in as a slot so the client `HomeFeed` doesn't have
 * to make API calls itself (spec: P&L data is server-fetched only).
 */
export default function Home() {
  return <HomeFeed topPerformersSlot={<TopPerformersStrip />} />;
}
