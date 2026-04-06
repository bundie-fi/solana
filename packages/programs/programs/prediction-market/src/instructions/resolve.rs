use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    /// Anyone can trigger resolution (permissionless)
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active,
        constraint = Clock::get()?.slot >= market.resolution_slot,
    )]
    pub market: Account<'info, Market>,

    // TODO: Add NavOracle account from strategy-token program (CPI read)
    // The NAV oracle provides the strategy's TWAP at resolution
    // This is the oracle-free resolution mechanism
}

pub fn handler(ctx: Context<ResolveMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    // TODO: Read strategy NAV from NavOracle account
    // TODO: Calculate APY from NAV snapshots
    // TODO: Compare APY against threshold_bps
    // TODO: Set outcome to Yes if APY >= threshold, No otherwise

    // Placeholder: resolve as Yes
    market.outcome = Some(Outcome::Yes);
    market.status = MarketStatus::Resolved;
    market.resolved_at = Some(Clock::get()?.unix_timestamp);

    msg!("Market resolved. Outcome: Yes");
    Ok(())
}
