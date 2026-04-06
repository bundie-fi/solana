use anchor_lang::prelude::*;

#[error_code]
pub enum StrategyError {
    #[msg("Strategy name too long (max 32 chars)")]
    NameTooLong,
    #[msg("Fee basis points exceeds maximum (10000)")]
    FeeTooHigh,
    #[msg("Insufficient shares for redemption")]
    InsufficientShares,
    #[msg("NAV calculation overflow")]
    NavOverflow,
    #[msg("Allocations must sum to 10000 bps")]
    InvalidAllocations,
    #[msg("Minimum redemption cooldown not met")]
    CooldownNotMet,
}
