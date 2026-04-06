use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Active,
    Resolved,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    /// Strategy this market predicts on
    pub strategy: Pubkey,
    /// Market creator
    pub authority: Pubkey,
    /// Question text (max 128 bytes)
    #[max_len(128)]
    pub question: String,
    /// APY threshold in basis points for resolution
    pub threshold_bps: u64,
    /// Slot at which market can be resolved
    pub resolution_slot: u64,
    /// YES shares outstanding
    pub yes_shares: u64,
    /// NO shares outstanding
    pub no_shares: u64,
    /// LS-LMSR liquidity parameter (alpha)
    pub liquidity_param: u64,
    /// Total volume traded
    pub total_volume: u64,
    /// Market vault for collateral
    pub vault: Pubkey,
    /// Winning outcome (set after resolution)
    pub outcome: Option<Outcome>,
    /// Market status
    pub status: MarketStatus,
    /// Creation timestamp
    pub created_at: i64,
    /// Resolution timestamp (if resolved)
    pub resolved_at: Option<i64>,
    /// Bump seed
    pub bump: u8,
}
