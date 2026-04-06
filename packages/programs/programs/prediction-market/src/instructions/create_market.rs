use anchor_lang::prelude::*;
use crate::state::*;

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

    /// CHECK: The strategy account this market predicts on
    pub strategy: UncheckedAccount<'info>,

    /// CHECK: Optional second strategy for Relative market type (can be SystemProgram for Absolute)
    pub strategy_b: UncheckedAccount<'info>,

    /// CHECK: Who provides initial liquidity subsidy
    pub subsidy_provider: Signer<'info>,

    // TODO: Add vault token account for collateral

    pub system_program: Program<'info, System>,
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
) -> Result<()> {
    let strategy_b_key = ctx.accounts.strategy_b.key();
    let strategy_b = if market_type == MarketType::Relative {
        Some(strategy_b_key)
    } else {
        None
    };

    let market = &mut ctx.accounts.market;
    market.strategy = ctx.accounts.strategy.key();
    market.strategy_b = strategy_b;
    market.authority = ctx.accounts.creator.key();
    market.subsidy_provider = ctx.accounts.subsidy_provider.key();
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
    market.status = MarketStatus::Active;
    market.outcome = None;
    market.created_at = Clock::get()?.unix_timestamp;
    market.resolved_at = None;
    market.bump = ctx.bumps.market;
    Ok(())
}
