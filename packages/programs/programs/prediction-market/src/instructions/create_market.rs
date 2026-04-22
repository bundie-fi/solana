use crate::error::MarketError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
#[instruction(question: String, market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", strategy.key().as_ref(), &market_id.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: The strategy account this market predicts on. Caller validates.
    pub strategy: UncheckedAccount<'info>,

    /// CHECK: Optional second strategy for Relative markets. Pass SystemProgram pubkey for Absolute.
    pub strategy_b: UncheckedAccount<'info>,

    /// USDC (or any SPL token) used as collateral
    pub collateral_mint: Account<'info, Mint>,

    /// Market vault — holds all collateral; authority is the market PDA
    #[account(
        init,
        payer = creator,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// YES outcome mint — market PDA is mint authority
    #[account(
        init,
        payer = creator,
        seeds = [b"yes_mint", market.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = market,
    )]
    pub yes_mint: Account<'info, Mint>,

    /// NO outcome mint — market PDA is mint authority
    #[account(
        init,
        payer = creator,
        seeds = [b"no_mint", market.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = market,
    )]
    pub no_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateMarket>,
    question: String,
    market_id: u64,
    market_type: MarketType,
    threshold_bps: u64,
    resolution_slot: u64,
    initial_subsidy: u64,
    fee_bps: u16,
    initial_nav_per_share: u64,
    // NAV per share of strategy B at creation time. Pass 0 for Absolute markets.
    initial_nav_per_share_b: u64,
) -> Result<()> {
    require!(question.len() <= 128, MarketError::QuestionTooLong);
    require!(initial_subsidy > 0, MarketError::InvalidSubsidy);

    let strategy_b_key = ctx.accounts.strategy_b.key();
    let strategy_b = if market_type == MarketType::Relative {
        require!(
            initial_nav_per_share_b > 0,
            MarketError::InvalidSubsidy // reusing — means "missing required param"
        );
        Some(strategy_b_key)
    } else {
        None
    };

    let market = &mut ctx.accounts.market;
    market.strategy = ctx.accounts.strategy.key();
    market.strategy_b = strategy_b;
    market.authority = ctx.accounts.creator.key();
    market.subsidy_provider = ctx.accounts.creator.key();
    market.question = question;
    market.market_type = market_type;
    market.market_id = market_id;
    market.threshold_bps = threshold_bps;
    market.resolution_slot = resolution_slot;
    market.yes_shares = 0;
    market.no_shares = 0;
    market.total_yes_cost = 0;
    market.total_no_cost = 0;
    market.liquidity_param = initial_subsidy;
    market.total_volume = 0;
    market.fee_bps = fee_bps;
    market.vault = ctx.accounts.vault.key();
    market.collateral_mint = ctx.accounts.collateral_mint.key();
    market.status = MarketStatus::Active;
    market.outcome = None;
    market.created_at = Clock::get()?.unix_timestamp;
    market.resolved_at = None;
    market.bump = ctx.bumps.market;
    market.initial_nav_per_share = initial_nav_per_share;
    market.initial_nav_per_share_b = initial_nav_per_share_b;
    market.yes_mint_bump = ctx.bumps.yes_mint;
    market.no_mint_bump = ctx.bumps.no_mint;
    market.vault_bump = ctx.bumps.vault;

    Ok(())
}
