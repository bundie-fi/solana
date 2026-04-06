use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(question: String)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", strategy.key().as_ref(), question.as_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: The strategy account this market predicts on
    pub strategy: UncheckedAccount<'info>,

    // TODO: Add vault token account for collateral

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateMarket>,
    question: String,
    threshold_bps: u64,
    resolution_slot: u64,
    initial_subsidy: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.strategy = ctx.accounts.strategy.key();
    market.authority = ctx.accounts.creator.key();
    market.question = question;
    market.threshold_bps = threshold_bps;
    market.resolution_slot = resolution_slot;
    market.yes_shares = 0;
    market.no_shares = 0;
    market.liquidity_param = initial_subsidy;
    market.total_volume = 0;
    market.status = MarketStatus::Active;
    market.outcome = None;
    market.created_at = Clock::get()?.unix_timestamp;
    market.resolved_at = None;
    market.bump = ctx.bumps.market;
    Ok(())
}
