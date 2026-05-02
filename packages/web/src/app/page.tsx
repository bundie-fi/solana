import { HomeFeed } from "@/components/home-feed";
import { TopPerformersStrip } from "@/components/top-performers-strip";
import { PlatformStatsStrip } from "@/components/platform-stats-strip";

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
 * Server-rendered slots (passed in from this server component because
 * `<HomeFeed>` is a client component and per design contract makes no
 * client-side P&L / aggregate API calls):
 *   - `<PlatformStatsStrip />` — aggregate "platform is real" numbers
 *   - `<TopPerformersStrip />` — top 3 agents by 30d return
 *
 * Render order: stats strip → top performers → existing feed.
 */
export default function Home() {
  return (
    <HomeFeed
      platformStatsSlot={<PlatformStatsStrip />}
      topPerformersSlot={<TopPerformersStrip />}
    />
  );
}
