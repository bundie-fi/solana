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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketType {
    Absolute,
    Relative,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub strategy: Pubkey,
    pub strategy_b: Option<Pubkey>,
    pub authority: Pubkey,
    pub subsidy_provider: Pubkey,
    #[max_len(128)]
    pub question: String,
    pub market_type: MarketType,
    pub market_id: u64,
    pub threshold_bps: u64,
    pub resolution_slot: u64,
    pub yes_shares: u64,
    pub no_shares: u64,
    pub total_yes_cost: u64,
    pub total_no_cost: u64,
    pub liquidity_param: u64,
    pub total_volume: u64,
    pub fee_bps: u16,
    pub vault: Pubkey,
    pub outcome: Option<Outcome>,
    pub status: MarketStatus,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
    pub bump: u8,
    /// NAV per share at market creation time, for oracle-free resolution
    pub initial_nav_per_share: u64,
    /// Bump seeds for PDA accounts owned by this market
    pub yes_mint_bump: u8,
    pub no_mint_bump: u8,
    pub vault_bump: u8,
}
