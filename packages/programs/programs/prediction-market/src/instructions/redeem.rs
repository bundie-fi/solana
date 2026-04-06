use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct RedeemWinnings<'info> {
    #[account(mut)]
    pub redeemer: Signer<'info>,

    #[account(
        constraint = market.status == MarketStatus::Resolved,
        constraint = market.outcome.is_some(),
    )]
    pub market: Account<'info, Market>,

    // TODO: Add redeemer's outcome token account
    // TODO: Add market vault token account

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RedeemWinnings>) -> Result<()> {
    // TODO: Verify redeemer holds winning outcome shares
    // TODO: Calculate payout (shares * $1.00 per winning share)
    // TODO: Burn winning shares
    // TODO: Transfer payout from vault to redeemer
    msg!("redeem: processing payout");
    Ok(())
}
