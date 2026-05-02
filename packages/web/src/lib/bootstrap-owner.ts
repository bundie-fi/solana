/** Wallet that owns the platform's seed-strategy agents — see
 *  packages/programs/scripts/seed-bootstrap-agents.ts. Surfaces
 *  the "Bundie Bootstrap" badge across the UI. */
export const BOOTSTRAP_OWNER_WALLET = "4rebicw8ngU5HKxRmdNLrij9VqKDzi5gSFU7FJcJ3yxG";

export function isBootstrapAgent(ownerWallet: string | null | undefined): boolean {
  return ownerWallet === BOOTSTRAP_OWNER_WALLET;
}

/** One-line tooltip used wherever the badge appears. */
export const BOOTSTRAP_BADGE_TOOLTIP =
  "Seeded by the Bundie team — track records start at $0 of public capital.";
