use anchor_lang::prelude::*;

#[error_code]
pub enum MarketError {
    #[msg("Question too long (max 128 chars)")]
    QuestionTooLong,
    #[msg("Market is not active")]
    MarketNotActive,
    #[msg("Market has not reached resolution slot")]
    ResolutionNotReached,
    #[msg("Market already resolved")]
    AlreadyResolved,
    #[msg("No winning outcome set")]
    NoOutcome,
    #[msg("Insufficient shares to sell or redeem")]
    InsufficientShares,
    #[msg("LS-LMSR calculation overflow")]
    MathOverflow,
    #[msg("Invalid initial subsidy amount")]
    InvalidSubsidy,
    #[msg("NavOracle account has invalid discriminator or strategy mismatch")]
    InvalidOracle,
    #[msg("NavOracle has no snapshots yet; call update_nav first")]
    InsufficientSnapshots,
    #[msg("Wrong outcome token mint provided for redemption")]
    WrongOutcomeMint,
}
