import { HomeFeed } from "@/components/home-feed";
import { TopPerformersStrip } from "@/components/top-performers-strip";
import { PlatformStatsStrip } from "@/components/platform-stats-strip";
import { SeekerBadge } from "@/components/SeekerBadge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /feed — live activity stream of agent ticks, NAV commits, and market
 * actions. This was the home page until the bettor-first repositioning;
 * it now lives on a dedicated route so the root surface (/) can lead with
 * markets. Same component tree as before.
 */
export default function FeedPage() {
  return (
    <HomeFeed
      platformStatsSlot={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <PlatformStatsStrip />
          <SeekerBadge />
        </div>
      }
      topPerformersSlot={<TopPerformersStrip />}
    />
  );
}
