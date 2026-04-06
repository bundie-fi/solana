use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Strategy {
    /// Authority (creator) of this strategy
    pub authority: Pubkey,
    /// Strategy token mint
    pub mint: Pubkey,
    /// Strategy portfolio wallet (PDA)
    pub wallet: Pubkey,
    /// Strategy name (max 32 bytes)
    #[max_len(32)]
    pub name: String,
    /// Performance fee in basis points (e.g., 1000 = 10%)
    pub fee_bps: u16,
    /// Total deposits in lamports/token base units
    pub total_deposits: u64,
    /// Current NAV (net asset value) in base units
    pub current_nav: u64,
    /// Total shares outstanding
    pub total_shares: u64,
    /// Last NAV update slot
    pub last_nav_slot: u64,
    /// TWAP accumulator for NAV
    pub nav_twap_accumulator: u128,
    /// TWAP last update slot
    pub twap_last_slot: u64,
    /// Creation timestamp
    pub created_at: i64,
    /// Bump seed for PDA
    pub bump: u8,
    /// Wallet bump seed
    pub wallet_bump: u8,
}
