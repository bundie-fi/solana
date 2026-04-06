use anchor_lang::prelude::*;
use crate::state::*;
use super::Allocation;

#[derive(Accounts)]
pub struct Rebalance<'info> {
    #[account(mut, has_one = authority)]
    pub strategy: Account<'info, Strategy>,

    pub authority: Signer<'info>,

    // TODO: Add Beethoven CPI accounts for withdraw + deposit

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Rebalance>, allocations: Vec<Allocation>) -> Result<()> {
    // TODO: Validate allocations sum to 10000 bps
    // TODO: Withdraw from current protocols via Beethoven
    // TODO: Deposit into new protocols via Beethoven
    msg!("rebalance: {} allocations", allocations.len());
    Ok(())
}
