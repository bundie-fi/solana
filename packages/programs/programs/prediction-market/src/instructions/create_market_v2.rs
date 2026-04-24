//! create_market_v2 — open a prediction market of any of the five v2 kinds.
//!
//! Lives next to (not replacing) `create_market`. The v1 ix continues to
//! work and is implicitly equivalent to a kind=0 (ApyThreshold) v2 market
//! resolved via the v1 `resolve` ix. New clients should prefer v2.
//!
//! Wire layout (after the 8-byte Anchor discriminator):
//!   question:        String              (Borsh: u32 len + utf-8 bytes, max 128)
//!   market_id:       u64
//!   kind:            u8                  (MARKET_KIND_*)
//!   payload:         [u8; 64]            (per-kind, see state::market)
//!   resolution_slot: u64
//!   initial_subsidy: u64                 (collateral units, e.g. USDC 6dp)
//!   fee_bps:         u16
//!   initial_nav_a:   u64                 (live NAV of strategy A at create-time)
//!   initial_nav_b:   u64                 (live NAV of strategy B; pass 0 for non-Relative)
//!
//! Strategy B is supplied via the `strategy_b` account: pass SystemProgram
//! pubkey as a placeholder for non-Relative kinds.

use crate::error::MarketError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
#[instruction(question: String, market_id: u64)]
pub struct CreateMarketV2<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", strategy.key().as_ref(), &market_id.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: Caller validates. Matches v1 — this is just an address store.
    pub strategy: UncheckedAccount<'info>,

    /// CHECK: Optional second strategy. Pass SystemProgram pubkey for kinds
    /// that do not need it (ApyThreshold, NavTarget, Drawdown, BackerCount).
    pub strategy_b: UncheckedAccount<'info>,

    pub collateral_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        seeds = [b"yes_mint", market.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = market,
    )]
    pub yes_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        seeds = [b"no_mint", market.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = market,
    )]
    pub no_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
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
    require!(question.len() <= 128, MarketError::QuestionTooLong);
    require!(initial_subsidy > 0, MarketError::InvalidSubsidy);
    require!(kind <= MARKET_KIND_BACKER_COUNT, MarketError::InvalidKind);

    // Per-kind invariants. Catch obviously-broken configs at create time
    // so resolve never has to inspect a malformed payload.
    let strategy_b_key = ctx.accounts.strategy_b.key();
    let market_type = match kind {
        MARKET_KIND_APY_THRESHOLD => {
            // payload[0..8] = threshold_bps must be > 0 to be meaningful
            require!(payload_u64(&payload, 0) > 0, MarketError::InvalidPayload);
            MarketType::Absolute
        }
        MARKET_KIND_NAV_TARGET => {
            require!(payload_u64(&payload, 0) > 0, MarketError::InvalidPayload);
            MarketType::Absolute
        }
        MARKET_KIND_RELATIVE => {
            // strategy_b must be a real strategy address, not the system program
            require!(strategy_b_key != System::id(), MarketError::InvalidPayload);
            require!(
                initial_nav_a > 0 && initial_nav_b > 0,
                MarketError::InvalidPayload
            );
            MarketType::Relative
        }
        MARKET_KIND_DRAWDOWN => {
            require!(
                payload_u64(&payload, 0) > 0 && payload_u64(&payload, 0) <= 10_000,
                MarketError::InvalidPayload
            );
            MarketType::Absolute
        }
        MARKET_KIND_BACKER_COUNT => {
            require!(payload_u64(&payload, 0) > 0, MarketError::InvalidPayload);
            MarketType::Absolute
        }
        _ => unreachable!(),
    };

    let strategy_b = if matches!(market_type, MarketType::Relative) {
        Some(strategy_b_key)
    } else {
        None
    };

    let market = &mut ctx.accounts.market;
    market.strategy = ctx.accounts.strategy.key();
    market.strategy_b = strategy_b;
    market.authority = ctx.accounts.creator.key();
    // Record the v2 signer as `created_by`. For agent markets this is the
    // Zerion-managed agent vault; for `MARKET_KIND_AGENT_VS_BENCHMARK` it
    // is the vault whose NAV is compared against the benchmark (no extra
    // field — the agent identity rides on `created_by`).
    market.created_by = ctx.accounts.creator.key();
    market.subsidy_provider = ctx.accounts.creator.key();
    market.question = question;
    market.market_type = market_type;
    market.market_id = market_id;
    // For ApyThreshold, mirror payload[0..8] into threshold_bps so v1
    // tooling that introspects the field still sees a useful value. For
    // other kinds it is unused and zeroed.
    market.threshold_bps = if kind == MARKET_KIND_APY_THRESHOLD {
        payload_u64(&payload, 0)
    } else {
        0
    };
    market.resolution_slot = resolution_slot;
    market.yes_shares = 0;
    market.no_shares = 0;
    market.total_yes_cost = 0;
    market.total_no_cost = 0;
    market.liquidity_param = initial_subsidy;
    market.total_volume = 0;
    market.fee_bps = fee_bps;
    market.vault = ctx.accounts.vault.key();
    market.collateral_mint = ctx.accounts.collateral_mint.key();
    market.status = MarketStatus::Active;
    market.outcome = None;
    market.created_at = Clock::get()?.unix_timestamp;
    market.resolved_at = None;
    market.bump = ctx.bumps.market;
    market.initial_nav_per_share = initial_nav_a;
    market.initial_nav_per_share_b = initial_nav_b;
    market.yes_mint_bump = ctx.bumps.yes_mint;
    market.no_mint_bump = ctx.bumps.no_mint;
    market.vault_bump = ctx.bumps.vault;
    market.kind = kind;
    market.payload = payload;

    msg!(
        "create_market_v2: kind={}, market_id={}, resolution_slot={}",
        kind,
        market_id,
        resolution_slot,
    );

    Ok(())
}
