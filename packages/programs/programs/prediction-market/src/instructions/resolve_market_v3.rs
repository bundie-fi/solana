//! resolve_market_v3 — settle a v3 event market via the registered
//! off-chain resolver.
//!
//! Unlike `resolve_market_v2` (which reads BundieVault NAV on-chain),
//! v3 event resolution is signature-gated: the transaction must be
//! signed by the pubkey recorded in the `ResolverAuthority` PDA bound
//! to this market at create-time. The resolver passes the outcome it
//! observed off-chain; on-chain logic only checks that:
//!
//!   1. The market is active and past its `resolution_slot`.
//!   2. The kind is in the v3 range (7/8/9).
//!   3. The signer matches the registered `ResolverAuthority.resolver`.
//!   4. The PDA's `.market` field matches the supplied market account
//!      (defence-in-depth against PDA substitution).
//!
//! The dispute layer (v2 of the dispute work, post-launch) replaces this
//! single-signer flow with a 2-of-3 LLM committee + bond-based challenge
//! window for non-deterministic event classes.

use crate::error::MarketError;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ResolveMarketV3<'info> {
    /// Must match `resolver_authority.resolver` — checked via constraint.
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
        constraint = Clock::get()?.slot >= market.resolution_slot @ MarketError::ResolutionNotReached,
        constraint = (MARKET_KIND_EVENT_THRESHOLD..=MARKET_KIND_V3_MAX).contains(&market.kind)
            @ MarketError::InvalidKind,
    )]
    pub market: Account<'info, Market>,

    #[account(
        seeds = [RESOLVER_AUTH_SEED, market.key().as_ref()],
        bump = resolver_authority.bump,
        constraint = resolver_authority.market == market.key()
            @ MarketError::WrongResolverMarket,
        constraint = resolver_authority.resolver == resolver.key()
            @ MarketError::ResolverMismatch,
    )]
    pub resolver_authority: Account<'info, ResolverAuthority>,
}

pub fn handler(ctx: Context<ResolveMarketV3>, outcome: Outcome) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let market = &mut ctx.accounts.market;

    market.outcome = Some(outcome);
    market.status = MarketStatus::Resolved;
    market.resolved_at = Some(now);

    msg!(
        "resolve_v3: kind={} market={} outcome_yes={}",
        market.kind,
        market.key(),
        outcome == Outcome::Yes
    );

    Ok(())
}
