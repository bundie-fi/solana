import { fetchStrategies } from "@/lib/chain";
import { mockStrategies } from "@bundie/common";
import type { StrategyDisplay } from "@bundie/common";
import { DiscoverClient } from "@/components/DiscoverClient";

export const revalidate = 30; // revalidate every 30s (ISR)

export default async function DiscoverPage() {
  let liveStrategies: StrategyDisplay[] = [];
  try {
    liveStrategies = await fetchStrategies();
  } catch {
    // Fall through to mock data
  }

  return (
    <main className="mx-auto w-full max-w-content px-4 py-6 md:px-8 md:py-12">
      <DiscoverClient live={liveStrategies} upcoming={mockStrategies} />
    </main>
  );
}
