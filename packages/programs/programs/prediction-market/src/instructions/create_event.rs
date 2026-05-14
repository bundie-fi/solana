//! create_event — open a parametric event market (kind 7/8/9) bound to
//! an off-chain resolver authority.
//!
//! This is the primary market-creation entrypoint for the Bundie event
//! venue. `create_market_v2` is the legacy agent-NAV path retained for
//! zerion-agent compatibility.
//!
//! Event markets resolve from off-chain data sources (Pyth feeds,
//! public status pages, on-chain TVL accounts) via a trusted resolver
//! signer recorded in the `ResolverAuthority` PDA.
//!
//! Wire layout (after the 8-byte Anchor discriminator):
//!   question:        String           (Borsh u32 len + utf-8, max 128)
//!   market_id:       u64
//!   event_id_hash:   [u8; 32]         (blake3 of the event_id slug from
//!                                      scripts/resolvers/sources.json)
//!   kind:            u8               (MARKET_KIND_EVENT_THRESHOLD..=EVENT_MAX)
//!   payload:         [u8; 64]         (per-kind layout — see state::market)
//!   resolution_slot: u64
//!   initial_subsidy: u64              (collateral units, e.g. USDC 6dp)
//!   fee_bps:         u16
//!   resolver:        Pubkey           (off-chain resolver signer)
//!   config_hash:     [u8; 32]         (blake3 of resolver config JSON entry)

use crate::error::MarketError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
#[instruction(question: String, market_id: u64, event_id_hash: [u8; 32])]
pub struct CreateEvent<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"event_market".as_ref(), event_id_hash.as_ref(), market_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = creator,
        space = 8 + ResolverAuthority::INIT_SPACE,
        seeds = [RESOLVER_AUTH_SEED, market.key().as_ref()],
        bump,
    )]
    pub resolver_authority: Box<Account<'info, ResolverAuthority>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = market,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = creator,
        seeds = [b"yes_mint", market.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = market,
    )]
    pub yes_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        seeds = [b"no_mint", market.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = market,
    )]
    pub no_mint: Box<Account<'info, Mint>>,

    /// Creator's collateral ATA. The full `initial_subsidy` is transferred
    /// into `vault` at create time so the market opens with real backing.
    #[account(
        mut,
        constraint = subsidy_source.mint == collateral_mint.key()
            @ MarketError::WrongOutcomeMint,
        constraint = subsidy_source.owner == creator.key()
            @ MarketError::InvalidSubsidy,
    )]
    pub subsidy_source: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<CreateEvent>,
    question: String,
    market_id: u64,
    _event_id_hash: [u8; 32], // consumed by seeds, no body use
    kind: u8,
    payload: [u8; MARKET_PAYLOAD_LEN],
    resolution_slot: u64,
    initial_subsidy: u64,
    fee_bps: u16,
    resolver: Pubkey,
    config_hash: [u8; 32],
) -> Result<()> {
    require!(question.len() <= 128, MarketError::QuestionTooLong);
    require!(initial_subsidy > 0, MarketError::InvalidSubsidy);
    require!(
        (MARKET_KIND_EVENT_THRESHOLD..=MARKET_KIND_EVENT_MAX).contains(&kind),
        MarketError::InvalidKind
    );
    require!(resolver != Pubkey::default(), MarketError::InvalidResolver);

    // Per-kind payload sanity checks. Each branch enforces the minimum
    // contract documented on `MarketKind` in state/market.rs — anything
    // looser is rejected at create-time so resolve_event never has to
    // re-validate a malformed payload.
    match kind {
        MARKET_KIND_EVENT_THRESHOLD => {
            // [0..8]   threshold > 0
            // [8..16]  comparator <= 4
            // [16..24] min_duration_seconds > 0
            // [24..32] window_end_unix_ts > 0
            // [32..64] price_feed_pubkey != default
            require!(payload_u64(&payload, 0) > 0, MarketError::InvalidPayload);
            require!(payload_u64(&payload, 8) <= 4, MarketError::InvalidPayload);
            require!(payload_u64(&payload, 16) > 0, MarketError::InvalidPayload);
            require!(payload_u64(&payload, 24) > 0, MarketError::InvalidPayload);
            let feed_bytes: [u8; 32] = payload[32..64].try_into().unwrap();
            require!(
                Pubkey::new_from_array(feed_bytes) != Pubkey::default(),
                MarketError::InvalidPayload
            );
        }
        MARKET_KIND_PROTOCOL_TVL_DROP => {
            // [0..8]   drop_threshold > 0
            // [8..16]  rolling_window_seconds > 0
            // [16..24] window_end_unix_ts > 0
            // [32..64] tvl_source_pubkey != default
            require!(payload_u64(&payload, 0) > 0, MarketError::InvalidPayload);
            require!(payload_u64(&payload, 8) > 0, MarketError::InvalidPayload);
            require!(payload_u64(&payload, 16) > 0, MarketError::InvalidPayload);
            let tvl_bytes: [u8; 32] = payload[32..64].try_into().unwrap();
            require!(
                Pubkey::new_from_array(tvl_bytes) != Pubkey::default(),
                MarketError::InvalidPayload
            );
        }
        MARKET_KIND_PUBLIC_STATUS_POLL => {
            // [0..8]   min_duration_seconds > 0
            // [16..24] window_end_unix_ts > 0
            // [24..32] resolver_class_id > 0
            require!(payload_u64(&payload, 0) > 0, MarketError::InvalidPayload);
            require!(payload_u64(&payload, 16) > 0, MarketError::InvalidPayload);
            require!(payload_u64(&payload, 24) > 0, MarketError::InvalidPayload);
        }
        _ => unreachable!(),
    }

    // Initialise the market.
    let market = &mut ctx.accounts.market;
    market.strategy = Pubkey::default(); // unused for event markets
    market.strategy_b = None;
    market.authority = ctx.accounts.creator.key();
    market.created_by = ctx.accounts.creator.key();
    market.subsidy_provider = ctx.accounts.creator.key();
    market.question = question;
    market.market_type = MarketType::Absolute; // all event markets are binary YES/NO
    market.market_id = market_id;
    market.threshold_bps = 0; // unused for event markets
    market.resolution_slot = resolution_slot;
    market.yes_shares = 0;
    market.no_shares = 0;
    market.total_yes_cost = 0;
    market.total_no_cost = 0;
    market.liquidity_param = initial_subsidy;
    market.total_volume = initial_subsidy;
    market.fee_bps = fee_bps;
    market.vault = ctx.accounts.vault.key();
    market.collateral_mint = ctx.accounts.collateral_mint.key();
    market.status = MarketStatus::Active;
    market.outcome = None;
    market.created_at = Clock::get()?.unix_timestamp;
    market.resolved_at = None;
    market.bump = ctx.bumps.market;
    market.initial_nav_per_share = 0;
    market.initial_nav_per_share_b = 0;
    market.initial_nav_a = 0;
    market.initial_nav_b = 0;
    market.yes_mint_bump = ctx.bumps.yes_mint;
    market.no_mint_bump = ctx.bumps.no_mint;
    market.vault_bump = ctx.bumps.vault;
    market.kind = kind;
    market.payload = payload;
    market.target_authority_a = None;
    market.target_authority_b = None;

    // Initialise the resolver authority PDA.
    let resolver_auth = &mut ctx.accounts.resolver_authority;
    resolver_auth.resolver = resolver;
    resolver_auth.config_hash = config_hash;
    resolver_auth.market = market.key();
    resolver_auth.bump = ctx.bumps.resolver_authority;

    // Transfer the initial subsidy into the market vault.
    token::transfer(
        CpiContext::new(
            token::ID,
            Transfer {
                from: ctx.accounts.subsidy_source.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        initial_subsidy,
    )?;

    msg!(
        "create_event: kind={} market_id={} resolution_slot={} resolver={} seeded={}",
        kind,
        market_id,
        resolution_slot,
        resolver,
        initial_subsidy,
    );

    Ok(())
}
