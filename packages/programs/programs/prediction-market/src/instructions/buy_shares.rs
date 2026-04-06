use anchor_lang::prelude::*;
use crate::state::*;
use crate::math::lmsr;

#[derive(Accounts)]
pub struct BuyMarketShares<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut, constraint = market.status == MarketStatus::Active)]
    pub market: Account<'info, Market>,

    // TODO: Add buyer token account, market vault token account

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<BuyMarketShares>, outcome: Outcome, amount: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;

    // TODO: Calculate cost via LS-LMSR
    let _cost = lmsr::calculate_cost(
        market.yes_shares,
        market.no_shares,
        market.liquidity_param,
        outcome == Outcome::Yes,
        amount,
    );

    // TODO: Transfer cost from buyer to market vault
    // TODO: Mint outcome shares to buyer

    match outcome {
        Outcome::Yes => market.yes_shares += amount,
        Outcome::No => market.no_shares += amount,
    }
    market.total_volume += amount;

    Ok(())
}
