/**
 * wizard-state.ts — useReducer state machine for the /create-agent wizard.
 *
 * 5 steps: Identity -> Strategy -> Allowlist -> Capital -> Review.
 * Each step has its own validation that gates "Next". The reducer is
 * the single source of truth; step components dispatch actions.
 */

export type WizardStepId =
  | "identity"
  | "strategy"
  | "allowlist"
  | "capital"
  | "review";

export const STEP_ORDER: WizardStepId[] = [
  "identity",
  "strategy",
  "allowlist",
  "capital",
  "review",
];

export const STEP_LABELS: Record<WizardStepId, string> = {
  identity: "Identity",
  strategy: "Strategy",
  allowlist: "Allowlist",
  capital: "Capital",
  review: "Review",
};

export type Preset =
  | "balanced"
  | "aggressive"
  | "conservative"
  | "yield-hunter"
  | "perp-trader";

export const PRESETS: { id: Preset; label: string; blurb: string }[] = [
  {
    id: "balanced",
    label: "Balanced",
    blurb: "Equal weight between lending yield and momentum trades.",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    blurb: "High concentration, frequent rotations, higher drawdown tolerance.",
  },
  {
    id: "conservative",
    label: "Conservative",
    blurb: "Stable lending, slow rotations, hard caps on per-protocol exposure.",
  },
  {
    id: "yield-hunter",
    label: "Yield hunter",
    blurb: "Always chasing the highest live APY across Kamino + MarginFi.",
  },
  {
    id: "perp-trader",
    label: "Perp trader",
    blurb: "Drift-led directional bets sized against the bUSD treasury.",
  },
];

export type Protocol =
  | "kamino"
  | "marginfi"
  | "marinade"
  | "jito"
  | "drift"
  | "orca";

export const ALL_PROTOCOLS: { id: Protocol; label: string; tag: string }[] = [
  { id: "kamino", label: "Kamino", tag: "Lending" },
  { id: "marginfi", label: "MarginFi", tag: "Lending" },
  { id: "marinade", label: "Marinade", tag: "LST" },
  { id: "jito", label: "Jito", tag: "LST" },
  { id: "drift", label: "Drift", tag: "Perps" },
  { id: "orca", label: "Orca", tag: "DEX" },
];

export interface ProtocolLimits {
  /** $ cap per protocol position (10..50). */
  maxNotionalUsd: number;
}

export interface IdentityState {
  /** SNS prefix only — full name is `${prefix}.bundie.sol`. */
  snsPrefix: string;
  displayName: string;
  emoji: string;
  tagline: string;
  /** Async check result. null = not yet checked, true = available. */
  snsAvailable: boolean | null;
  snsChecking: boolean;
  snsError: string | null;
}

export interface StrategyState {
  preset: Preset | null;
  customBrainMd: string;
  showCustomBrain: boolean;
}

export interface AllowlistState {
  protocols: Protocol[];
  limits: Record<string, ProtocolLimits>;
}

export interface CapitalState {
  /** Wallet bUSD balance in dollars. null = unknown. */
  busdBalance: number | null;
  /** Last faucet tx signature, if claimed. */
  faucetTxSig: string | null;
  faucetClaiming: boolean;
  faucetError: string | null;
}

export interface LaunchProgress {
  /** Current launch sub-step label. null when not launching. */
  stage: LaunchStage | null;
  initTxSig: string | null;
  depositTxSig: string | null;
  error: string | null;
}

export type LaunchStage =
  | "creating-agent"
  | "building-tx"
  | "signing-init"
  | "signing-deposit"
  | "confirming"
  | "done";

export interface WizardState {
  current: WizardStepId;
  identity: IdentityState;
  strategy: StrategyState;
  allowlist: AllowlistState;
  capital: CapitalState;
  launch: LaunchProgress;
}

export const INITIAL_STATE: WizardState = {
  current: "identity",
  identity: {
    snsPrefix: "",
    displayName: "",
    emoji: "🤖",
    tagline: "",
    snsAvailable: null,
    snsChecking: false,
    snsError: null,
  },
  strategy: {
    preset: null,
    customBrainMd: "",
    showCustomBrain: false,
  },
  allowlist: {
    protocols: ["kamino"],
    limits: { kamino: { maxNotionalUsd: 25 } },
  },
  capital: {
    busdBalance: null,
    faucetTxSig: null,
    faucetClaiming: false,
    faucetError: null,
  },
  launch: {
    stage: null,
    initTxSig: null,
    depositTxSig: null,
    error: null,
  },
};

export type WizardAction =
  | { type: "GOTO"; step: WizardStepId }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "IDENTITY/SET_PREFIX"; value: string }
  | { type: "IDENTITY/SET_DISPLAY_NAME"; value: string }
  | { type: "IDENTITY/SET_EMOJI"; value: string }
  | { type: "IDENTITY/SET_TAGLINE"; value: string }
  | { type: "IDENTITY/CHECK_START" }
  | {
      type: "IDENTITY/CHECK_DONE";
      available: boolean | null;
      error: string | null;
    }
  | { type: "STRATEGY/SET_PRESET"; preset: Preset }
  | { type: "STRATEGY/SET_BRAIN"; value: string }
  | { type: "STRATEGY/TOGGLE_CUSTOM"; show: boolean }
  | { type: "ALLOWLIST/TOGGLE"; protocol: Protocol; enabled: boolean }
  | {
      type: "ALLOWLIST/SET_LIMIT";
      protocol: Protocol;
      maxNotionalUsd: number;
    }
  | { type: "CAPITAL/SET_BALANCE"; value: number | null }
  | { type: "CAPITAL/FAUCET_START" }
  | {
      type: "CAPITAL/FAUCET_DONE";
      txSig: string | null;
      error: string | null;
    }
  | { type: "LAUNCH/SET_STAGE"; stage: LaunchStage | null }
  | { type: "LAUNCH/SET_INIT_TX"; sig: string }
  | { type: "LAUNCH/SET_DEPOSIT_TX"; sig: string }
  | { type: "LAUNCH/SET_ERROR"; error: string | null }
  | { type: "LAUNCH/RESET" };

// ── Pure validation helpers ─────────────────────────────────────────────────

const SNS_RE = /^[a-z0-9-]{3,20}$/;

export function snsPrefixError(prefix: string): string | null {
  if (!prefix) return "Pick a name to register on .bundie.sol.";
  if (prefix !== prefix.toLowerCase()) return "Lowercase only.";
  if (!SNS_RE.test(prefix))
    return "3–20 chars; letters, digits, dashes only.";
  if (prefix.startsWith("-") || prefix.endsWith("-"))
    return "Cannot start or end with a dash.";
  return null;
}

export function fullSns(prefix: string): string {
  return `${prefix}.bundie.sol`;
}

export function canAdvance(state: WizardState): boolean {
  switch (state.current) {
    case "identity": {
      if (snsPrefixError(state.identity.snsPrefix)) return false;
      if (!state.identity.displayName.trim()) return false;
      // If we've checked and it's taken, block. If unchecked or available, allow.
      if (state.identity.snsAvailable === false) return false;
      if (state.identity.snsChecking) return false;
      return true;
    }
    case "strategy":
      return state.strategy.preset !== null;
    case "allowlist":
      return state.allowlist.protocols.length > 0;
    case "capital":
      // Need ≥ $50 bUSD before approving the seed deposit.
      return (state.capital.busdBalance ?? 0) >= 50;
    case "review":
      // Final step — "Launch" is its own button, Next is hidden.
      return true;
    default:
      return false;
  }
}

// ── Reducer ─────────────────────────────────────────────────────────────────

export function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case "GOTO":
      return { ...state, current: action.step };
    case "NEXT": {
      const idx = STEP_ORDER.indexOf(state.current);
      if (idx === -1 || idx === STEP_ORDER.length - 1) return state;
      return { ...state, current: STEP_ORDER[idx + 1] };
    }
    case "BACK": {
      const idx = STEP_ORDER.indexOf(state.current);
      if (idx <= 0) return state;
      return { ...state, current: STEP_ORDER[idx - 1] };
    }

    // Identity
    case "IDENTITY/SET_PREFIX":
      return {
        ...state,
        identity: {
          ...state.identity,
          snsPrefix: action.value,
          // Reset uniqueness state — caller re-runs the check.
          snsAvailable: null,
          snsError: null,
        },
      };
    case "IDENTITY/SET_DISPLAY_NAME":
      return {
        ...state,
        identity: { ...state.identity, displayName: action.value },
      };
    case "IDENTITY/SET_EMOJI":
      return {
        ...state,
        identity: { ...state.identity, emoji: action.value },
      };
    case "IDENTITY/SET_TAGLINE":
      return {
        ...state,
        identity: { ...state.identity, tagline: action.value },
      };
    case "IDENTITY/CHECK_START":
      return {
        ...state,
        identity: {
          ...state.identity,
          snsChecking: true,
          snsAvailable: null,
          snsError: null,
        },
      };
    case "IDENTITY/CHECK_DONE":
      return {
        ...state,
        identity: {
          ...state.identity,
          snsChecking: false,
          snsAvailable: action.available,
          snsError: action.error,
        },
      };

    // Strategy
    case "STRATEGY/SET_PRESET":
      return { ...state, strategy: { ...state.strategy, preset: action.preset } };
    case "STRATEGY/SET_BRAIN":
      return {
        ...state,
        strategy: { ...state.strategy, customBrainMd: action.value },
      };
    case "STRATEGY/TOGGLE_CUSTOM":
      return {
        ...state,
        strategy: { ...state.strategy, showCustomBrain: action.show },
      };

    // Allowlist
    case "ALLOWLIST/TOGGLE": {
      const present = state.allowlist.protocols.includes(action.protocol);
      const protocols = action.enabled
        ? present
          ? state.allowlist.protocols
          : [...state.allowlist.protocols, action.protocol]
        : state.allowlist.protocols.filter((p) => p !== action.protocol);

      const limits = { ...state.allowlist.limits };
      if (action.enabled && !limits[action.protocol]) {
        limits[action.protocol] = { maxNotionalUsd: 25 };
      } else if (!action.enabled) {
        delete limits[action.protocol];
      }
      return { ...state, allowlist: { protocols, limits } };
    }
    case "ALLOWLIST/SET_LIMIT": {
      return {
        ...state,
        allowlist: {
          ...state.allowlist,
          limits: {
            ...state.allowlist.limits,
            [action.protocol]: { maxNotionalUsd: action.maxNotionalUsd },
          },
        },
      };
    }

    // Capital
    case "CAPITAL/SET_BALANCE":
      return {
        ...state,
        capital: { ...state.capital, busdBalance: action.value },
      };
    case "CAPITAL/FAUCET_START":
      return {
        ...state,
        capital: {
          ...state.capital,
          faucetClaiming: true,
          faucetError: null,
        },
      };
    case "CAPITAL/FAUCET_DONE":
      return {
        ...state,
        capital: {
          ...state.capital,
          faucetClaiming: false,
          faucetTxSig: action.txSig,
          faucetError: action.error,
        },
      };

    // Launch
    case "LAUNCH/SET_STAGE":
      return { ...state, launch: { ...state.launch, stage: action.stage } };
    case "LAUNCH/SET_INIT_TX":
      return { ...state, launch: { ...state.launch, initTxSig: action.sig } };
    case "LAUNCH/SET_DEPOSIT_TX":
      return {
        ...state,
        launch: { ...state.launch, depositTxSig: action.sig },
      };
    case "LAUNCH/SET_ERROR":
      return { ...state, launch: { ...state.launch, error: action.error } };
    case "LAUNCH/RESET":
      return {
        ...state,
        launch: {
          stage: null,
          initTxSig: null,
          depositTxSig: null,
          error: null,
        },
      };

    default:
      return state;
  }
}

// ── Brain.md generator ──────────────────────────────────────────────────────

/**
 * Produce a deterministic preview of the brain.md the backend will store.
 * The backend may rewrite this; we just want the user to see what they're
 * signing up for.
 */
export function generateBrainPreview(state: WizardState): string {
  if (state.strategy.showCustomBrain && state.strategy.customBrainMd.trim()) {
    return state.strategy.customBrainMd.trim();
  }
  const { identity, strategy, allowlist } = state;
  const sns = fullSns(identity.snsPrefix || "<your-name>");
  const presetMeta = PRESETS.find((p) => p.id === strategy.preset);
  const protocolList = allowlist.protocols
    .map((p) => {
      const cap = allowlist.limits[p]?.maxNotionalUsd ?? 25;
      return `- ${p} (cap: $${cap})`;
    })
    .join("\n");
  return `# ${identity.displayName || sns}

**SNS:** ${sns}
**Preset:** ${presetMeta?.label ?? "balanced"}
**Tagline:** ${identity.tagline || "—"}

## Strategy
${presetMeta?.blurb ?? ""}

## Allowed protocols
${protocolList || "- (none yet)"}

## Risk policy
- Per-protocol notional caps as listed above.
- All actions are routed through Beethoven CPI.
- Treasury is held in bUSD on Solana devnet.
`;
}
