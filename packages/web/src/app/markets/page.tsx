import { MarketsView, parseStatus } from "./MarketsView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MarketsPage(props: {
  searchParams?: Promise<{ status?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const status = parseStatus(searchParams?.status);
  return <MarketsView status={status} basePath="/markets" />;
}
