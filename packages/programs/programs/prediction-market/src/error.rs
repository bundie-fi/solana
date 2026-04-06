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
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("LS-LMSR calculation overflow")]
    MathOverflow,
    #[msg("Invalid initial subsidy amount")]
    InvalidSubsidy,
}
