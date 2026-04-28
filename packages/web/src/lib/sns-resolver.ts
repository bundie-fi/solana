/**
 * Static SNS resolver , maps vault pubkeys to their display names.
 *
 * Primary source: packages/programs/scripts/chaos-sim/keys/alice-bob-sns.json
 * Fallback source: packages/programs/scripts/chaos-sim/keys/agent-names.json
 *
 * Why static? The on-chain mapping is authoritative but a reverse-lookup
 * against SPL Name Service for every market render is both slow and
 * redundant , the agents we care about for the demo are a fixed small set
 * registered by the Bundie chaos-sim. When a future PR adds live on-chain
 * reverse-lookup (walk the NameRegistry accounts owned by the vault), it
 * should layer on top of this map: try static first for known agents,
 * fall back to RPC for anyone else.
 *
 * For unknown vaults `resolveSns` returns null and callers fall back to
 * `truncatePubkey` for display.
 */

// ---------------------------------------------------------------------------
// Alice / Bob / Charlie , the three "hero" vaults with real on-chain SNS
// registrations. Keep in sync with packages/programs/scripts/chaos-sim/keys/
// alice-bob-sns.json and the three-agent roster the rate-prediction-markets-v2
// work introduced. Charlie's SNS NameRegistry PDA isn't yet surfaced in the
// chaos-sim keys file, so we point the explorer link at the vault itself —
// the same fallback we use for CHAOS_AGENTS below.
// ---------------------------------------------------------------------------

const ALICE_VAULT = "5ZnHtnSBvy4L9fGzGYaecVZ3WonWK3rLCqb4uaEgGXcm";
const ALICE_SNS_PDA = "FH6FhVQ1hw7sHQdbg1p5cdKkHGr3yu5Re9Yx8VTDr4Nb";

const BOB_VAULT = "EBYDXh5RjbRX7eBobenPC59tvS4TCQzCUKYgx6auU8jb";
const BOB_SNS_PDA = "D8BRLTc6j4cpkMvpP7QfQR6cbw9QJ3LgXAEYzx9JQEzV";

const CHARLIE_VAULT = "8zNazDgyrTX1CTaPk4G6hZ8r47SbVajh1vcFrqNAzBFg";
const CHARLIE_SNS_PDA = CHARLIE_VAULT;

/**
 * The three-agent roster exposed as a stable array so pages that need to
 * render every agent (home feed, /agents leaderboard) have a single source
 * of truth for the emoji + display name + vault pubkey triple.
 *
 * Keep ordering stable: alice, bob, charlie , consumers rely on this for
 * consistent visual layout (3-across on desktop, stacked on mobile).
 */
export interface HeroAgent {
  sns: string;
  vault: string;
  emoji: string;
  /** One-line strategy handle surfaced on the leaderboard card. */
  strategyHandle: string;
}

export const HERO_AGENTS: HeroAgent[] = [
  {
    sns: "alice.bundie",
    vault: ALICE_VAULT,
    emoji: "🌱",
    strategyHandle: "conservative-lst",
  },
  {
    sns: "bob.bundie",
    vault: BOB_VAULT,
    emoji: "💰",
    strategyHandle: "stable-lending",
  },
  {
    sns: "charlie.bundie",
    vault: CHARLIE_VAULT,
    emoji: "⚖️",
    strategyHandle: "balanced-mix",
  },
];

// ---------------------------------------------------------------------------
// Chaos-sim agents , 10 stable identities (5 creators + 5 traders).
// Keep in sync with packages/programs/scripts/chaos-sim/keys/agent-names.json
// ---------------------------------------------------------------------------

const CHAOS_AGENTS: Record<string, string> = {
  // creators
  "9sDZ2Q7r57Zzb8QonDKMrMxgGKXtLcEckKjuUpVv8EgJ": "alpha-hunter.bundie",
  "9pkxLmvZNJKv22rJ4o39JJWdJbcRMbkwrZ1y8mjHcC92": "delta-trader.bundie",
  "FYF71jeyXotjLvgasWwzK3k8GS5pjrafsimoXoSTEZd5": "gamma-scout.bundie",
  "6UaXsfg6JeakhTEtuT3aDQAY9sKMHSfDT22HtLzWPYH2": "theta-quant.bundie",
  "3cxwxubZq1hmKnr6EuTbAypgUK29rsEzF7V65ysDKdse": "vega-oracle.bundie",
  // traders
  "31qdnmthhoWkhb1DBrdU3T9NkMoNGXqEY6W3J6AnVHbL": "sigma-wolf.bundie",
  "58VmQjKkD1vqovann8kmeDNdFWyMwLs3Jv9miw5pa2pS": "kappa-falcon.bundie",
  "6WbNANWYGJrzABNmkaiehE6hMFws8Ahv8AMLzEpZHu6R": "lambda-signal.bundie",
  "8rszHge5qTvfAu2xBT2mPuSjmGcznQHLW3p2xDnKGsaj": "omega-sage.bundie",
  "4PJUR8AUcurd7WWh9n4esEQDm2MF7wPTpEJX78zSn5Du": "alpha-quant.bundie",
};

export interface SnsIdentity {
  /** Devnet display name, e.g. "alice.bundie". */
  devnetName: string;
  /**
   * Optional mainnet display name, e.g. "alice.bundie.sol". Set for the
   * "hero" identities (alice/bob) even though registration of the mainnet
   * subdomain under `bundie.sol` is still in-flight , the intent is
   * documented and the UI flags that provenance clearly.
   */
  mainnetName: string | null;
  /** The SNS NameRegistry PDA on devnet, for an explorer link. */
  devnetSnsPda: string;
}

/**
 * Resolve a vault pubkey to an SNS identity. Returns null for unknown
 * vaults , callers should fall back to `truncatePubkey`.
 */
export function resolveSns(vaultPubkey: string): SnsIdentity | null {
  if (!vaultPubkey) return null;

  if (vaultPubkey === ALICE_VAULT) {
    return {
      devnetName: "alice.bundie",
      mainnetName: "alice.bundie.sol",
      devnetSnsPda: ALICE_SNS_PDA,
    };
  }

  if (vaultPubkey === BOB_VAULT) {
    return {
      devnetName: "bob.bundie",
      mainnetName: "bob.bundie.sol",
      devnetSnsPda: BOB_SNS_PDA,
    };
  }

  if (vaultPubkey === CHARLIE_VAULT) {
    return {
      devnetName: "charlie.bundie",
      mainnetName: "charlie.bundie.sol",
      devnetSnsPda: CHARLIE_SNS_PDA,
    };
  }

  const chaosName = CHAOS_AGENTS[vaultPubkey];
  if (chaosName) {
    // Chaos agents share the .bundie root on devnet but don't yet have
    // dedicated SNS record PDAs surfaced in the web UI; point the explorer
    // link at the agent's vault itself so the visitor can still inspect
    // on-chain activity.
    return {
      devnetName: chaosName,
      mainnetName: null,
      devnetSnsPda: vaultPubkey,
    };
  }

  return null;
}

/**
 * Reverse lookup , given an SNS name like "alice.bundie", return the vault
 * pubkey. Used by /agent/[sns] page to find markets created by that agent.
 * Returns null if the name isn't in our static map.
 */
export function resolveVaultFromSns(name: string): string | null {
  if (!name) return null;
  const normalized = name.toLowerCase().trim();

  if (normalized === "alice.bundie" || normalized === "alice.bundie.sol") {
    return ALICE_VAULT;
  }
  if (normalized === "bob.bundie" || normalized === "bob.bundie.sol") {
    return BOB_VAULT;
  }
  if (
    normalized === "charlie.bundie" ||
    normalized === "charlie.bundie.sol"
  ) {
    return CHARLIE_VAULT;
  }

  for (const [vault, chaosName] of Object.entries(CHAOS_AGENTS)) {
    if (chaosName === normalized) return vault;
  }
  return null;
}

/** List every known SNS identity , used by directory / fallback pages. */
export function listKnownIdentities(): Array<{
  vault: string;
  identity: SnsIdentity;
}> {
  const out: Array<{ vault: string; identity: SnsIdentity }> = [
    {
      vault: ALICE_VAULT,
      identity: {
        devnetName: "alice.bundie",
        mainnetName: "alice.bundie.sol",
        devnetSnsPda: ALICE_SNS_PDA,
      },
    },
    {
      vault: BOB_VAULT,
      identity: {
        devnetName: "bob.bundie",
        mainnetName: "bob.bundie.sol",
        devnetSnsPda: BOB_SNS_PDA,
      },
    },
    {
      vault: CHARLIE_VAULT,
      identity: {
        devnetName: "charlie.bundie",
        mainnetName: "charlie.bundie.sol",
        devnetSnsPda: CHARLIE_SNS_PDA,
      },
    },
  ];
  for (const [vault, chaosName] of Object.entries(CHAOS_AGENTS)) {
    out.push({
      vault,
      identity: {
        devnetName: chaosName,
        mainnetName: null,
        devnetSnsPda: vault,
      },
    });
  }
  return out;
}

/** Truncate a base58 pubkey for display when no SNS name is known. */
export function truncatePubkey(
  pk: string,
  head: number = 4,
  tail: number = 4,
): string {
  if (!pk) return "";
  if (pk.length <= head + tail + 1) return pk;
  return `${pk.slice(0, head)}…${pk.slice(-tail)}`;
}
