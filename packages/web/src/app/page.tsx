import { HomeFeed } from "@/components/home-feed";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Home = live activity feed.
 *
 * This used to be a redirect to /markets; we now render the gamified
 * feed as the root. The `HomeFeed` client component handles polling
 * on a 15s tick and merging on-chain market activity with vault
 * balance deltas into a single reverse-chronological stream.
 */
export default function Home() {
  return <HomeFeed />;
}
