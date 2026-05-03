import { MarketsView, parseStatus } from "./markets/MarketsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Home (/) — bettor-first surface. Lists every NAV-resolved prediction
 * market with a status filter, fronted by the platform-stats strip so
 * scale + activity show above the fold.
 *
 * Repositioned May 2026 from the live activity feed — that surface now
 * lives on /feed. The judge + early-user feedback ("people land here and
 * see 'create an agent' and stop") drove the swap: markets are what a
 * Polymarket-style visitor expects, agents are infrastructure.
 */
export default async function Home(props: {
  searchParams?: Promise<{ status?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const status = parseStatus(searchParams?.status);
  return <MarketsView status={status} basePath="/" />;
}
