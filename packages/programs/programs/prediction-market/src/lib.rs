use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod math;
pub mod rate_readers;
pub mod state;

use instructions::*;
use state::*;

declare_id!("Bun4h9qr4NnQNa5qPePK48cP63R59hHSQDt8ipge4fT4");

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
        initial_nav_per_share: u64,
        initial_nav_per_share_b: u64,
    ) -> Result<()> {
        instructions::create_market::handler(
            ctx,
            question,
            market_id,
            market_type,
            threshold_bps,
            resolution_slot,
            initial_subsidy,
            fee_bps,
            initial_nav_per_share,
            initial_nav_per_share_b,
        )
    }

    /// Buy YES or NO shares using LS-LMSR pricing
    pub fn buy_shares(ctx: Context<BuyMarketShares>, outcome: Outcome, amount: u64) -> Result<()> {
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

    /// V2 — open a market of any of the five `MarketKind` variants. v1
    /// `create_market` continues to work and produces ApyThreshold-equivalent
    /// markets that resolve via the v1 `resolve` ix.
    #[allow(clippy::too_many_arguments)]
    pub fn create_market_v2(
        ctx: Context<CreateMarketV2>,
        question: String,
        market_id: u64,
        kind: u8,
        payload: [u8; MARKET_PAYLOAD_LEN],
        resolution_slot: u64,
        initial_subsidy: u64,
        fee_bps: u16,
        initial_nav_a: u64,
        initial_nav_b: u64,
    ) -> Result<()> {
        instructions::create_market_v2::handler(
            ctx,
            question,
            market_id,
            kind,
            payload,
            resolution_slot,
            initial_subsidy,
            fee_bps,
            initial_nav_a,
            initial_nav_b,
        )
    }

    /// V2 — branch on `market.kind` and read the relevant on-chain quantity
    /// (NavOracle TWAP, Strategy.backer_count, ...) to set the outcome.
    pub fn resolve_market_v2(ctx: Context<ResolveMarketV2>) -> Result<()> {
        instructions::resolve_market_v2::handler(ctx)
    }
}
