interface ChainBadgeProps {
  chain: string;
}

/**
 * Small pill badge showing the chain (devnet = blue, surfpool = amber).
 */
export function ChainBadge({ chain }: ChainBadgeProps) {
  const cls = chain === "devnet" ? "pill-blue" : "pill-amber";
  return (
    <span className={`pill ${cls}`} style={{ padding: "2px 7px", fontSize: 9 }}>
      {chain}
    </span>
  );
}
