import { fetchStrategies } from "@/lib/chain";
import type { StrategyDisplay } from "@bundie/common";
import { DiscoverClient } from "@/components/DiscoverClient";

export const revalidate = 30; // revalidate every 30s (ISR)

export default async function DiscoverPage() {
  let liveStrategies: StrategyDisplay[] = [];
  try {
    liveStrategies = await fetchStrategies();
  } catch {
    // RPC failure — render an empty Discover; never substitute mock data.
  }

  return (
    <main className="mx-auto w-full max-w-content px-4 py-6 md:px-8 md:py-12">
      <DiscoverClient live={liveStrategies} upcoming={[]} />
    </main>
  );
}
