/**
 * Dark editorial component barrel.
 *
 * Re-exports the building blocks for the redesigned bettor-facing surfaces
 * (Discover / Markets / Agent detail). New components MUST live under
 * `de/` and reference only `--de-*` design tokens.
 */
export { AgentCardCompact, DeAvatar, hashSeed } from "./AgentCardCompact";
export { ConvictionBar } from "./ConvictionBar";
export { DeMarketCard } from "./MarketCard";
export type { DeMarketCardProps, MarketCardSize } from "./MarketCard";
export { OutcomeButton } from "./OutcomeButton";
export type { OutcomeButtonProps, OutcomeVariant } from "./OutcomeButton";
export { DeSparkline } from "./Sparkline";
export type { DeSparklineProps } from "./Sparkline";
export { StatusPill } from "./StatusPill";
export type { StatusPillVariant } from "./StatusPill";
