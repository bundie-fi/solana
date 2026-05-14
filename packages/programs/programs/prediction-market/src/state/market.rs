use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Outcome {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketStatus {
    Active,
    Resolved,
}

/// V1 market type. Kept for back-compat with existing markets created via
/// the original `create_market` ix.
///   - Absolute: "will strategy exceed X% APY?"
///   - Relative: "will strategy A outperform strategy B?"
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketType {
    Absolute,
    Relative,
}

/// V2 market kind. Stored as a `u8` (`market.kind`) to avoid Borsh-enum
/// serialisation + retain a stable wire format. Numeric values MUST stay
/// stable — they are part of the on-chain ABI.
///
/// The 64-byte `payload` array on Market is interpreted differently per kind:
///
///   ApyThreshold (0):
///     payload[0..8]   = threshold_bps          (u64 LE) — APY threshold
///     payload[8..16]  = duration_secs          (u64 LE) — annualisation window
///     payload[16..24] = reserved (zero)
///     ...
///
///   NavTarget (1):
///     payload[0..8]   = target_nav             (u64 LE) — strategy NAV per share target
///     payload[8..16]  = reserved (zero)
///     ...
///
///   Relative (2):
///     payload[0..8]   = initial_nav_a          (u64 LE)
///     payload[8..16]  = initial_nav_b          (u64 LE)
///     payload[16..24] = reserved (zero)
///     ...
///     (strategy_b is taken from `market.strategy_b` field)
///
///   Drawdown (3):
///     payload[0..8]   = max_drawdown_bps       (u64 LE)
///     payload[8..16]  = reserved (zero)
///     ...
///     (currently DEFERRED — resolve_market_v2 returns ResolveDeferredKind)
///
///   BackerCount (4):
///     payload[0..8]   = target_backer_count    (u64 LE) — threshold N
///     payload[8..16]  = reserved (zero)
///     ...
///     (Strategy::backer_count is read from `market.strategy`)
///
/// Repr matches the wire byte; #[repr(u8)] guarantees the discriminant.
pub const MARKET_KIND_APY_THRESHOLD: u8 = 0;
pub const MARKET_KIND_NAV_TARGET: u8 = 1;
pub const MARKET_KIND_RELATIVE: u8 = 2;
pub const MARKET_KIND_DRAWDOWN: u8 = 3;
pub const MARKET_KIND_BACKER_COUNT: u8 = 4;

/// DEPRECATED — kept as ABI marker only. See Phase C migration.
pub const MARKET_KIND_RATE_BARRIER: u8 = 5;

/// DEPRECATED — kept as ABI marker only. See Phase C migration.
pub const MARKET_KIND_AGENT_VS_BENCHMARK: u8 = 6;

// ───────────────────────────────────────────────────────────────────────
// v3 event classes (Bundie v2 framing, locked 2026-05-14).
//
// The v1/v2 kinds above all measure agent / strategy NAV. v3 generalizes
// the market primitive to ANY measurable event — DeFi-native and beyond.
// All v3 kinds share the same 64-byte payload buffer; only the layout
// differs per kind. The resolver-side dispatch lives in resolve_market_v3
// (TODO: ship in the next commit).
//
// Numeric values are part of the on-chain ABI — MUST stay stable once a
// market is deployed on mainnet.

/// (v3, kind=7) EventThreshold — a Pyth (or other signed price feed)
/// value crosses a threshold and stays past it for a minimum duration.
///
///   payload[0..8]   = threshold (u64 LE, price in 1e-8 units)
///   payload[8..16]  = comparator (u64 LE; 0=lt, 1=lte, 2=gt, 3=gte, 4=eq)
///   payload[16..24] = min_duration_seconds (u64 LE)
///   payload[24..32] = window_end_unix_ts (u64 LE) — UNIX seconds
///   payload[32..64] = price_feed_pubkey (32-byte Pubkey) — the feed
///                     account the resolver reads each tick.
///
/// Outcome YES iff: feed value satisfies (comparator, threshold) for at
/// least `min_duration_seconds` continuous seconds anywhere in the window
/// from market open to `window_end_unix_ts`. Otherwise NO.
///
/// Example: USDC depeg <$0.99 for >30 min in next 30 days.
pub const MARKET_KIND_EVENT_THRESHOLD: u8 = 7;

/// (v3, kind=8) ProtocolTvlDrop — a protocol's on-chain TVL falls by
/// more than `drop_threshold` in any rolling `rolling_window_seconds`
/// window.
///
///   payload[0..8]   = drop_threshold (u64 LE, 1e-6 USD — i.e. micro-dollars)
///   payload[8..16]  = rolling_window_seconds (u64 LE)
///   payload[16..24] = window_end_unix_ts (u64 LE) — UNIX seconds
///   payload[24..32] = reserved (zero)
///   payload[32..64] = tvl_source_pubkey (32-byte Pubkey) — the account
///                     the resolver reads. Resolver class is responsible
///                     for valuing the account in USD (e.g. Kamino main
///                     lending pool balance × USDC price).
///
/// Outcome YES iff: there exists any rolling window of length
/// `rolling_window_seconds` within the outcome window where the TVL
/// dropped by more than `drop_threshold` micro-dollars. Otherwise NO.
///
/// Example: Kamino TVL drops >$50M in any 24h window over next 90 days.
pub const MARKET_KIND_PROTOCOL_TVL_DROP: u8 = 8;

/// (v3, kind=9) PublicStatusPoll — a public status page or health API
/// reports an incident exceeding `min_duration_seconds` within the
/// outcome window. The resolver class encodes which feed to poll; the
/// signed resolution attests the incident occurred.
///
///   payload[0..8]   = min_duration_seconds (u64 LE)
///   payload[8..16]  = rolling_window_seconds (u64 LE)
///                     (0 means: check entire outcome window as a flat range)
///   payload[16..24] = window_end_unix_ts (u64 LE) — UNIX seconds
///   payload[24..32] = resolver_class_id (u64 LE) — selects which status
///                     poller is responsible (statuspage_v2, aws_health,
///                     etc.); off-chain registry maps id -> implementation
///   payload[32..64] = resolver_config_hash (32 bytes) — blake3 of the
///                     resolver's config JSON entry; pins which event the
///                     market is bound to so the resolver can't be
///                     repointed silently.
///
/// Outcome YES iff: the registered resolver reports a qualifying incident
/// within the outcome window. The resolver itself is in resolver_registry
/// (or a v3-specific extension) and signs the resolution.
///
/// Example: Anthropic API downtime >5 min in any rolling 7-day window;
///          AWS us-east-1 incident >30 min in next 30 days.
pub const MARKET_KIND_PUBLIC_STATUS_POLL: u8 = 9;

/// Highest v3 kind discriminant currently defined. Update when adding
/// new v3 kinds; resolve_market_v3 uses this to bound its dispatch.
pub const MARKET_KIND_V3_MAX: u8 = MARKET_KIND_PUBLIC_STATUS_POLL;

/// Length of the per-kind payload, in bytes. Fixed-size array so we never
/// need to Borsh-decode a variable enum payload — keeps deserialisation
/// straight and the Market account size stable.
pub const MARKET_PAYLOAD_LEN: usize = 64;

#[account]
#[derive(InitSpace)]
pub struct Market {
    /// Strategy this market predicts on
    pub strategy: Pubkey,
    /// Second strategy for Relative market type matchups (None for Absolute)
    pub strategy_b: Option<Pubkey>,
    /// Market creator
    pub authority: Pubkey,
    /// Who provided initial liquidity subsidy
    pub subsidy_provider: Pubkey,
    /// Question text (max 128 bytes)
    #[max_len(128)]
    pub question: String,
    /// Market type (Absolute or Relative)
    pub market_type: MarketType,
    /// Sequential market ID (used in PDA seeds)
    pub market_id: u64,
    /// APY threshold in basis points for resolution
    pub threshold_bps: u64,
    /// Slot at which market can be resolved
    pub resolution_slot: u64,
    /// YES shares outstanding
    pub yes_shares: u64,
    /// NO shares outstanding
    pub no_shares: u64,
    /// Total cost basis paid for YES shares
    pub total_yes_cost: u64,
    /// Total cost basis paid for NO shares
    pub total_no_cost: u64,
    /// LS-LMSR liquidity parameter (alpha)
    pub liquidity_param: u64,
    /// Total volume traded
    pub total_volume: u64,
    /// Market fee in basis points (e.g., 100 = 1%)
    pub fee_bps: u16,
    /// Market vault for collateral
    pub vault: Pubkey,
    /// Collateral token mint (e.g. USDC)
    pub collateral_mint: Pubkey,
    /// Winning outcome (set after resolution)
    pub outcome: Option<Outcome>,
    /// Market status
    pub status: MarketStatus,
    /// Creation timestamp
    pub created_at: i64,
    /// Resolution timestamp (if resolved)
    pub resolved_at: Option<i64>,
    /// Bump seed for this market PDA
    pub bump: u8,
    /// NAV per share at market creation time for strategy A (oracle-free resolution)
    pub initial_nav_per_share: u64,
    /// NAV per share at market creation time for strategy B (Relative markets only; 0 for Absolute)
    pub initial_nav_per_share_b: u64,
    /// BundieVault NAV (lamports) snapshotted at create_market_v2 for vault A.
    /// Phase B uses this as the baseline for kinds 1/2/3 (NavTarget/Relative/Drawdown)
    /// when resolving against `BundieVault.nav_lamports`. Zero for kinds that
    /// do not snapshot a vault baseline.
    pub initial_nav_a: u64,
    /// BundieVault NAV (lamports) snapshotted at create_market_v2 for vault B.
    /// Only populated for kind=2 (RELATIVE / head-to-head). Zero otherwise.
    pub initial_nav_b: u64,
    /// Bump seeds for PDA accounts owned by this market
    pub yes_mint_bump: u8,
    pub no_mint_bump: u8,
    pub vault_bump: u8,
    /// V2 market kind discriminator. See `MARKET_KIND_*` constants.
    /// V1 markets created via `create_market` are written with kind=0
    /// (ApyThreshold) for compatibility, but their resolution still flows
    /// through the original `resolve` ix (which only branches on
    /// `market_type`). v2 markets created via `create_market_v2` set this
    /// field explicitly and resolve via `resolve_market_v2`.
    pub kind: u8,
    /// Per-kind config payload. Layout documented on `MarketKind`. Fixed
    /// size so the Market account never grows; v1 markets carry zeroes.
    pub payload: [u8; MARKET_PAYLOAD_LEN],
    /// Identity that signed `create_market_v2` — for Bundie agent markets
    /// this is the Zerion-managed agent vault pubkey (the `creator` signer
    /// in the v2 ix context). For `MARKET_KIND_AGENT_VS_BENCHMARK` this
    /// pubkey IS the agent's vault under measurement (no extra field).
    ///
    /// For v1 markets created via `create_market`, this mirrors `authority`
    /// so every Market account has a populated `created_by` — clients can
    /// read it uniformly without branching on kind.
    pub created_by: Pubkey,
    /// Authority of the BundieVault snapshotted as `target_vault_a` at
    /// create-time. Pinned here so resolve_market_v2 can re-derive the same
    /// PDA (`["bundie_vault", target_authority_a]`) and reject any
    /// caller-substituted vault. `None` for kinds that do not snapshot
    /// vault A.
    pub target_authority_a: Option<Pubkey>,
    /// Authority of the BundieVault snapshotted as `target_vault_b` at
    /// create-time. Only populated for kind=2 (RELATIVE / head-to-head).
    /// `None` otherwise.
    pub target_authority_b: Option<Pubkey>,
}

// ─── Payload helpers ────────────────────────────────────────────────────────
//
// These read/write u64-LE fields at fixed offsets inside the 64-byte payload.
// All callers (create + resolve handlers and tests) go through these so the
// layout documented above is enforced in one place.

/// Read a u64-LE word at `byte_offset` from a 64-byte market payload.
/// Saturates to 0 if the offset would overflow the array — defence in depth
/// since callers always pass static offsets.
#[inline]
pub fn payload_u64(payload: &[u8; MARKET_PAYLOAD_LEN], byte_offset: usize) -> u64 {
    if byte_offset + 8 > MARKET_PAYLOAD_LEN {
        return 0;
    }
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&payload[byte_offset..byte_offset + 8]);
    u64::from_le_bytes(buf)
}

/// Write a u64-LE word at `byte_offset` into a 64-byte market payload.
#[inline]
pub fn set_payload_u64(payload: &mut [u8; MARKET_PAYLOAD_LEN], byte_offset: usize, v: u64) {
    if byte_offset + 8 > MARKET_PAYLOAD_LEN {
        return;
    }
    payload[byte_offset..byte_offset + 8].copy_from_slice(&v.to_le_bytes());
}
