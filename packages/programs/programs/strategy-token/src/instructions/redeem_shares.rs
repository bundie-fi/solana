use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct RedeemShares<'info> {
    #[account(mut)]
    pub redeemer: Signer<'info>,

    #[account(mut)]
    pub strategy: Account<'info, Strategy>,

    // TODO: Add token accounts for share burning + withdrawal
    // TODO: Add Beethoven CPI accounts for protocol withdrawal

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RedeemShares>, shares: u64) -> Result<()> {
    // TODO: Calculate proportional NAV for shares
    // TODO: Withdraw from protocol via Beethoven CPI
    // TODO: Burn strategy shares
    // TODO: Transfer capital to redeemer
    // TODO: Deduct performance fee
    // amount = shares * current_nav / total_shares
    msg!("redeem_shares: shares={}", shares);
    Ok(())
}
