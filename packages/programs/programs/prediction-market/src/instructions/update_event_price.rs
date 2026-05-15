//! update_event_price — tick the CPI-readable price feed for an event
//! market.
//!
//! Mirrors `resolve_event`'s auth model:
//!   - Signer must equal `resolver_authority.resolver`.
//!   - The resolver's `config_hash` is checked against a caller-supplied
//!     value so a re-pointed resolver cannot silently update a feed.
//!   - The `ResolverAuthority` PDA's `.market` field must match the
//!     supplied market account (defence-in-depth).
//!
//! Semantics:
//!   - `init_if_needed`: the first tick after `create_event` creates
//!     the EventPrice PDA; subsequent ticks just bump fields.
//!   - `price`, `confidence`, and `depth_usd_u64` are written verbatim
//!     from the resolver. The resolver is trusted to compute these
//!     correctly (same trust model as `resolve_event`).
//!   - `updated_at_slot` / `updated_at_ts` are stamped from the
//!     `Clock` sysvar.
//!   - `price` is bounded to `[0, PRICE_SCALE]`. A resolver that
//!     supplies an out-of-range value is rejected; this prevents a
//!     compromised resolver from poisoning consumers with nonsense
//!     probabilities.
//!   - Once `status == STATUS_RESOLVED`, further updates are refused.
//!     The terminal price set by `resolve_event` is frozen.

use crate::error::MarketError;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(event_id_hash: [u8; 32], config_hash: [u8; 32])]
pub struct UpdateEventPrice<'info> {
    /// Must match `resolver_authority.resolver` — checked via constraint.
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
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
        constraint = resolver_authority.config_hash == config_hash
            @ MarketError::ResolverMismatch,
    )]
    pub resolver_authority: Box<Account<'info, ResolverAuthority>>,

    /// CPI-readable price feed. Created on first call, mutated on
    /// subsequent ticks. Keyed on `event_id_hash` (not market.key()) so
    /// foreign programs can derive the PDA from just the event slug.
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
    ctx: Context<UpdateEventPrice>,
    event_id_hash: [u8; 32],
    _config_hash: [u8; 32], // consumed by constraint
    price: u64,
    confidence: u64,
    depth_usd: u64,
) -> Result<()> {
    require!(price <= PRICE_SCALE, MarketError::InvalidPayload);
    require!(confidence <= PRICE_SCALE, MarketError::InvalidPayload);

    let clock = Clock::get()?;
    let event_price = &mut ctx.accounts.event_price;

    // Refuse to overwrite a frozen, resolved price feed. resolve_event
    // is the only path that may flip status to STATUS_RESOLVED.
    require!(
        event_price.status != STATUS_RESOLVED,
        MarketError::AlreadyResolved
    );

    // Detect first-tick init: a freshly-created account has zeroed
    // fields. We can't condition on `event_price.event_id_hash` being
    // default because resolver could (in principle) re-init after a
    // hypothetical close — but we ALWAYS overwrite these immutable
    // pins, so it's safe to write unconditionally.
    event_price.event_id_hash = event_id_hash;
    event_price.market = ctx.accounts.market.key();
    event_price.exponent = EVENT_PRICE_EXPONENT;
    event_price.bump = ctx.bumps.event_price;
    event_price.status = STATUS_ACTIVE;

    // Per-tick fields.
    event_price.price = price;
    event_price.confidence = confidence;
    event_price.depth_usd_u64 = depth_usd;
    event_price.updated_at_slot = clock.slot;
    event_price.updated_at_ts = clock.unix_timestamp;

    msg!(
        "update_event_price: market={} price_q9={} conf_q9={} depth_usd_u64={} slot={}",
        ctx.accounts.market.key(),
        price,
        confidence,
        depth_usd,
        clock.slot
    );

    Ok(())
}
