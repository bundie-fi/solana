import Link from "next/link";
import { resolveSns, truncatePubkey } from "@/lib/sns-resolver";

/**
 * The SNS story: on the market detail page, surface the agent's identity
 * as the primary proof that a named entity stands behind this market.
 *
 * - devnetName: live `.bundie` registration (SPL Name Service).
 * - mainnetName: future `.bundie.sol` (documented intent; optional).
 * - devnetSnsPda: explorer link for the NameRegistry account.
 */
export function MarketCreatorStrip({
  creator,
  createdAt,
}: {
  creator: string;
  createdAt: number;
}) {
  const sns = resolveSns(creator);
  const displayName = sns?.devnetName ?? truncatePubkey(creator);
  const agentHref = `/agent/${sns?.devnetName ?? creator}`;
  const createdLabel =
    createdAt > 0 ? new Date(createdAt * 1000).toLocaleString() : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-neutral-300 bg-surface/60 px-4 py-3">
      <div className="h-10 w-10 shrink-0 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-xl">
        🤖
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-neutral-800">
          Created by{" "}
          <Link
            href={agentHref}
            className="text-amber-400 font-semibold hover:underline"
          >
            {displayName}
          </Link>
          {sns?.mainnetName && (
            <span className="ml-2 font-mono text-[11px] text-neutral-600">
              (mainnet: {sns.mainnetName})
            </span>
          )}
        </div>
        {createdLabel && (
          <div className="text-xs text-neutral-600 mt-0.5">{createdLabel}</div>
        )}
        {sns && (
          <div className="text-xs text-neutral-500 mt-1">
            SNS record:{" "}
            <a
              href={`https://orbmarkets.io/address/${sns.devnetSnsPda}?cluster=devnet`}
              className="underline text-neutral-600 hover:text-amber-400"
              target="_blank"
              rel="noreferrer"
            >
              {sns.devnetSnsPda.slice(0, 8)}…{sns.devnetSnsPda.slice(-4)}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
