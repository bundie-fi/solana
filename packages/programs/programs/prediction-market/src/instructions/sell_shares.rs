use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct SellMarketShares<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(mut, constraint = market.status == MarketStatus::Active)]
    pub market: Account<'info, Market>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SellMarketShares>, outcome: Outcome, shares: u64) -> Result<()> {
    // TODO: Calculate payout via LS-LMSR
    // TODO: Burn outcome shares from seller
    // TODO: Transfer payout from market vault to seller
    msg!("sell_shares: outcome={:?}, shares={}", outcome as u8, shares);
    Ok(())
}
