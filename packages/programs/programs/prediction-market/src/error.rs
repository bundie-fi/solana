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
    #[msg("Strategy creator cannot take positions on their own strategy's market")]
    CreatorCannotPredictOnOwnStrategy,
    #[msg("Strategy account has invalid discriminator or is too small")]
    InvalidStrategyAccount,
    #[msg("Strategy account does not match the market's strategy")]
    WrongStrategyForMarket,
    #[msg("Unknown market kind discriminator")]
    InvalidKind,
    #[msg("Per-kind payload failed validation (zero/oversized/missing field)")]
    InvalidPayload,
    #[msg("This market kind is not yet implemented (Drawdown awaits NavOracle history extension)")]
    ResolveDeferredKind,
    #[msg("Agent cannot create a kind=6 market on its own strategy (insider-trading forbidden)")]
    InsiderMarketForbidden,
    #[msg("resolve_market_v2 data_a does not match the target_agent encoded in market payload")]
    WrongTargetAgent,
    #[msg("Vault NAV epoch must increment monotonically")]
    StaleNavEpoch,
    #[msg("Caller is not the vault authority")]
    UnauthorizedVaultCommit,
    #[msg("Required target vault account not provided")]
    MissingTargetVault,
}
