//! resolve_event — settle a parametric event market via the registered
//! off-chain resolver.
//!
//! `resolve_market_v2` is the legacy agent-NAV path retained for
//! zerion-agent compatibility; new product surfaces use `resolve_event`.
//!
//! Event resolution is signature-gated: the transaction must be signed
//! by the pubkey recorded in the `ResolverAuthority` PDA bound to this
//! market at create-time. The resolver passes the outcome it observed
//! off-chain; on-chain logic only checks that:
//!
//!   1. The market is active and past its `resolution_slot`.
//!   2. The kind is in the event range (7-9, MARKET_KIND_EVENT_*).
//!   3. The signer matches the registered `ResolverAuthority.resolver`.
//!   4. The PDA's `.market` field matches the supplied market account
//!      (defence-in-depth against PDA substitution).
//!
//! The dispute layer (post-launch) replaces this single-signer flow with
//! a 2-of-3 LLM committee + bond-based challenge window for non-
//! deterministic event classes.

use crate::error::MarketError;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(outcome: Outcome, event_id_hash: [u8; 32])]
pub struct ResolveEvent<'info> {
    /// Must match `resolver_authority.resolver` — checked via constraint.
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
        constraint = Clock::get()?.slot >= market.resolution_slot @ MarketError::ResolutionNotReached,
        constraint = (MARKET_KIND_EVENT_THRESHOLD..=MARKET_KIND_EVENT_MAX).contains(&market.kind)
            @ MarketError::InvalidKind,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        seeds = [RESOLVER_AUTH_SEED, market.key().as_ref()],
        bump = resolver_authority.bump,
        constraint = resolver_authority.market == market.key()
            @ MarketError::WrongResolverMarket,
        constraint = resolver_authority.resolver == resolver.key()
            @ MarketError::ResolverMismatch,
    )]
    pub resolver_authority: Box<Account<'info, ResolverAuthority>>,

    /// CPI-readable price feed. `init_if_needed` so a market that
    /// resolves before `update_event_price` has ever been called still
    /// produces a terminal feed account for consumers to read.
    /// Keyed on `event_id_hash` to match the public PDA derivation.
    #[account(
        init_if_needed,
        payer = resolver,
        space = EventPrice::ACCOUNT_SIZE,
        seeds = [EVENT_PRICE_SEED, event_id_hash.as_ref()],
        bump,
    )]
    pub event_price: Box<Account<'info, EventPrice>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ResolveEvent>,
    outcome: Outcome,
    event_id_hash: [u8; 32],
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let market_key = ctx.accounts.market.key();
    let market = &mut ctx.accounts.market;

    market.outcome = Some(outcome);
    market.status = MarketStatus::Resolved;
    market.resolved_at = Some(now);

    // Freeze the CPI-readable price feed at the terminal outcome.
    // YES → PRICE_SCALE (1.0), NO → 0. Consumers polling the feed see
    // a settled status + terminal price; no further `update_event_price`
    // calls will be accepted.
    let event_price = &mut ctx.accounts.event_price;
    event_price.event_id_hash = event_id_hash;
    event_price.market = market_key;
    event_price.exponent = EVENT_PRICE_EXPONENT;
    event_price.bump = ctx.bumps.event_price;
    event_price.price = match outcome {
        Outcome::Yes => PRICE_SCALE,
        Outcome::No => 0,
    };
    event_price.confidence = 0; // terminal — zero uncertainty
    event_price.status = STATUS_RESOLVED;
    event_price.updated_at_slot = clock.slot;
    event_price.updated_at_ts = now;
    // depth_usd_u64 + _reserved retained from the last live tick (or
    // left zero if no `update_event_price` ever fired).

    msg!(
        "resolve_event: kind={} market={} outcome_yes={} price_feed_frozen=1",
        market.kind,
        market_key,
        outcome == Outcome::Yes
    );

    Ok(())
}
