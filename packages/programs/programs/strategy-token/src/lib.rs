use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("STRTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

#[program]
pub mod strategy_token {
    use super::*;

    /// Initialize a new investment strategy with a token mint
    pub fn create_strategy(
        ctx: Context<CreateStrategy>,
        name: String,
        fee_bps: u16,
    ) -> Result<()> {
        instructions::create_strategy::handler(ctx, name, fee_bps)
    }

    /// Buy strategy shares by depositing capital
    pub fn buy_shares(ctx: Context<BuyShares>, amount: u64) -> Result<()> {
        instructions::buy_shares::handler(ctx, amount)
    }

    /// Redeem strategy shares for underlying capital
    pub fn redeem_shares(ctx: Context<RedeemShares>, shares: u64) -> Result<()> {
        instructions::redeem_shares::handler(ctx, shares)
    }

    /// Rebalance strategy allocations (creator only)
    pub fn rebalance(ctx: Context<Rebalance>, allocations: Vec<Allocation>) -> Result<()> {
        instructions::rebalance::handler(ctx, allocations)
    }

    /// Snapshot current NAV into TWAP accumulator
    pub fn update_nav(ctx: Context<UpdateNav>) -> Result<()> {
        instructions::update_nav::handler(ctx)
    }
}
