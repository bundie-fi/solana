use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct UpdateNav<'info> {
    #[account(mut)]
    pub strategy: Account<'info, Strategy>,

    #[account(
        mut,
        has_one = strategy,
    )]
    pub nav_oracle: Account<'info, NavOracle>,

    // TODO: Add protocol position accounts to read current value
}

pub fn handler(ctx: Context<UpdateNav>) -> Result<()> {
    // TODO: Read current portfolio value from protocol accounts
    // TODO: Calculate NAV per share
    // TODO: Update TWAP accumulator
    // nav_per_share = portfolio_value / total_shares
    // twap_accumulator += nav_per_share * slots_elapsed
    let clock = Clock::get()?;
    let nav_oracle = &mut ctx.accounts.nav_oracle;
    nav_oracle.last_snapshot_slot = clock.slot;
    nav_oracle.snapshot_count += 1;
    msg!("update_nav: snapshot #{}", nav_oracle.snapshot_count);
    Ok(())
}
