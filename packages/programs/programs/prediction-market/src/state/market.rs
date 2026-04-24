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

/// RateBarrier (5) — "will protocol/pool rate X stay above/below a
/// threshold over a slot window?" The rate is read from an on-chain rate
/// source (Kamino reserve, Marinade stake pool, Orca whirlpool, etc.)
/// selected by `rate_reader_selector`. Market resolves Absolute.
///
///   payload[0..8]   = threshold_bps            (u64 LE) — APY threshold in bps
///   payload[8..16]  = window_start_slot        (u64 LE)
///   payload[16..24] = window_end_slot          (u64 LE)
///   payload[24..32] = rate_reader_selector     (u64 LE)
///                       1 = Kamino USDC supply APY
///                       2 = Marinade mSOL stake APY
///                       3 = Kamino USDC borrow APR
///                       4 = Orca SOL-USDC Whirlpool fee APY
///                       5 = Jupiter Perps SOL-PERP funding rate
///                       6 = Jupiter JLP NAV growth
///   payload[32..64] = reserved (zero)
///
/// `strategy_b` is unused (set to `None`).
pub const MARKET_KIND_RATE_BARRIER: u8 = 5;

/// AgentVsBenchmark (6) — "will agent X's vault NAV growth exceed a
/// benchmark rate by at least `spread_bps` over a slot window?" The
/// agent's vault pubkey is stored in `market.created_by` (the signer of
/// create_market_v2); no additional account field is needed. The
/// benchmark rate is read via the same selector table as RateBarrier.
/// Market resolves Absolute.
///
///   payload[0..8]   = spread_bps                (u64 LE) — required annualised excess in bps
///   payload[8..16]  = window_start_slot         (u64 LE)
///   payload[16..24] = window_end_slot           (u64 LE)
///   payload[24..32] = benchmark_reader_selector (u64 LE, same selector table as RateBarrier)
///                       1 = Kamino USDC supply APY
///                       2 = Marinade mSOL stake APY
///                       3 = Kamino USDC borrow APR
///                       4 = Orca SOL-USDC Whirlpool fee APY
///                       5 = Jupiter Perps SOL-PERP funding rate
///                       6 = Jupiter JLP NAV growth
///   payload[32..40] = initial_agent_nav         (u64 LE) — agent vault NAV at create time
///   payload[40..64] = reserved (zero)
///
/// `strategy_b` is unused (set to `None`).
pub const MARKET_KIND_AGENT_VS_BENCHMARK: u8 = 6;

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
