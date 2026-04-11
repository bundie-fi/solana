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

/// Absolute: "will strategy exceed X% APY?"
/// Relative: "will strategy A outperform strategy B?"
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketType {
    Absolute,
    Relative,
}

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
    /// NAV per share at market creation time, for oracle-free resolution
    pub initial_nav_per_share: u64,
    /// Bump seeds for PDA accounts owned by this market
    pub yes_mint_bump: u8,
    pub no_mint_bump: u8,
    pub vault_bump: u8,
}
