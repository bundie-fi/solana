use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct BuyShares<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut)]
    pub strategy: Account<'info, Strategy>,

    // TODO: Add token accounts for deposit + share minting
    // TODO: Add Beethoven CPI accounts for protocol routing

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<BuyShares>, amount: u64) -> Result<()> {
    // TODO: Calculate shares based on current NAV
    // TODO: Transfer deposit to strategy wallet
    // TODO: Route via Beethoven CPI to target protocol (Kamino)
    // TODO: Mint strategy shares to buyer
    // shares = amount * total_shares / current_nav
    msg!("buy_shares: amount={}", amount);
    Ok(())
}
