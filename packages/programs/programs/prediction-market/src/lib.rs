use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;
pub mod math;

use instructions::*;
use state::*;

declare_id!("Y13kynHKA6nfgDtYReVTuPZEVki6NmY9dYDihQT8j7i");

#[program]
pub mod prediction_market {
    use super::*;

    /// Create a new prediction market on a strategy's performance
    pub fn create_market(
        ctx: Context<CreateMarket>,
        question: String,
        market_id: u64,
        market_type: MarketType,
        threshold_bps: u64,
        resolution_slot: u64,
        initial_subsidy: u64,
        fee_bps: u16,
    ) -> Result<()> {
        instructions::create_market::handler(ctx, question, market_id, market_type, threshold_bps, resolution_slot, initial_subsidy, fee_bps)
    }

    /// Buy YES or NO shares using LS-LMSR pricing
    pub fn buy_shares(
        ctx: Context<BuyMarketShares>,
        outcome: Outcome,
        amount: u64,
    ) -> Result<()> {
        instructions::buy_shares::handler(ctx, outcome, amount)
    }

    /// Sell YES or NO shares back to the market
    pub fn sell_shares(
        ctx: Context<SellMarketShares>,
        outcome: Outcome,
        shares: u64,
    ) -> Result<()> {
        instructions::sell_shares::handler(ctx, outcome, shares)
    }

    /// Resolve market using strategy's on-chain NAV (oracle-free)
    pub fn resolve(ctx: Context<ResolveMarket>) -> Result<()> {
        instructions::resolve::handler(ctx)
    }

    /// Redeem winning shares for payout
    pub fn redeem(ctx: Context<RedeemWinnings>) -> Result<()> {
        instructions::redeem::handler(ctx)
    }
}
