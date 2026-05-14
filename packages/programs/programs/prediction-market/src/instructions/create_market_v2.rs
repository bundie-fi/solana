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
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

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
    pub market: Box<Account<'info, Market>>,

    /// CHECK: Caller validates. Matches v1 — this is just an address store.
    pub strategy: UncheckedAccount<'info>,

    /// CHECK: Optional second strategy. Pass SystemProgram pubkey for kinds
    /// that do not need it (ApyThreshold, NavTarget, Drawdown, BackerCount).
    pub strategy_b: UncheckedAccount<'info>,

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
    /// from this account into the market `vault` at create time so the
    /// market is born with real backing liquidity (not just an LMSR
    /// liquidity_param). Mint must match `collateral_mint`; balance must
    /// cover `initial_subsidy`.
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

    /// Optional BundieVault for strategy A. Required for kinds 1/2/3
    /// (NavTarget, Relative, Drawdown) so create_market_v2 can snapshot
    /// the live NAV baseline. Pass `None` for legacy kinds (5/6) that
    /// do not yet flow through BundieVault.
    pub target_vault_a: Option<Box<Account<'info, crate::state::BundieVault>>>,

    /// Optional BundieVault for strategy B. Required only for kind=2
    /// (RELATIVE / head-to-head). Pass `None` otherwise.
    pub target_vault_b: Option<Box<Account<'info, crate::state::BundieVault>>>,
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
    // create_market_v2 is the legacy agent-NAV path. Only kinds 1
    // (NavTarget), 2 (Relative), and 3 (Drawdown) are reachable. The
    // earlier ApyThreshold (0), BackerCount (4), RateBarrier (5), and
    // AgentVsBenchmark (6) kinds were retired during the event-market
    // migration — clients use `create_event` for new markets.
    require!(
        matches!(kind, 1 | 2 | 3),
        crate::error::MarketError::DeprecatedMarketKind
    );

    // Per-kind invariants. Catch obviously-broken configs at create time
    // so resolve never has to inspect a malformed payload. Only kinds
    // 1/2/3 are reachable (require! above rejects the rest).
    let strategy_b_key = ctx.accounts.strategy_b.key();
    let market_type = match kind {
        MARKET_KIND_NAV_TARGET => {
            require!(payload_u64(&payload, 0) > 0, MarketError::InvalidPayload);
            // On-chain insider guard — creator MUST NOT be the authority of
            // the vault whose NAV is being predicted on.
            let v = ctx
                .accounts
                .target_vault_a
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            require!(
                v.authority != ctx.accounts.creator.key(),
                MarketError::InsiderMarketForbidden
            );
            MarketType::Absolute
        }
        MARKET_KIND_RELATIVE => {
            // strategy_b must be a real strategy address, not the system program
            require!(strategy_b_key != System::id(), MarketError::InvalidPayload);
            require!(
                initial_nav_a > 0 && initial_nav_b > 0,
                MarketError::InvalidPayload
            );
            // Insider guard — creator may not author either side.
            let a = ctx
                .accounts
                .target_vault_a
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            let b = ctx
                .accounts
                .target_vault_b
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            require!(
                a.authority != ctx.accounts.creator.key()
                    && b.authority != ctx.accounts.creator.key(),
                MarketError::InsiderMarketForbidden
            );
            MarketType::Relative
        }
        MARKET_KIND_DRAWDOWN => {
            require!(
                payload_u64(&payload, 0) > 0 && payload_u64(&payload, 0) <= 10_000,
                MarketError::InvalidPayload
            );
            let v = ctx
                .accounts
                .target_vault_a
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            require!(
                v.authority != ctx.accounts.creator.key(),
                MarketError::InsiderMarketForbidden
            );
            MarketType::Absolute
        }
        _ => unreachable!(),
    };

    let strategy_b = if matches!(market_type, MarketType::Relative) {
        Some(strategy_b_key)
    } else {
        None
    };

    // Snapshot BundieVault NAVs for kinds 1/2/3 AND pin the vault
    // authorities into the Market record. Pinning the authorities lets
    // resolve_market_v2 re-derive the canonical PDA and reject any
    // attacker-substituted vault. Legacy kinds (5/6) preserve the
    // caller-supplied `initial_nav_a` / `initial_nav_b` parameters so
    // existing flows keep working until Phase C strips them.
    let (snap_a, snap_b, auth_a, auth_b) = match kind {
        MARKET_KIND_NAV_TARGET | MARKET_KIND_DRAWDOWN => {
            let v = ctx
                .accounts
                .target_vault_a
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            (v.nav_lamports, 0u64, Some(v.authority), None)
        }
        MARKET_KIND_RELATIVE => {
            let a = ctx
                .accounts
                .target_vault_a
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            let b = ctx
                .accounts
                .target_vault_b
                .as_ref()
                .ok_or(MarketError::MissingTargetVault)?;
            (
                a.nav_lamports,
                b.nav_lamports,
                Some(a.authority),
                Some(b.authority),
            )
        }
        _ => (initial_nav_a, initial_nav_b, None, None),
    };

    let market = &mut ctx.accounts.market;
    market.strategy = ctx.accounts.strategy.key();
    market.strategy_b = strategy_b;
    market.authority = ctx.accounts.creator.key();
    // Record the v2 signer as `created_by` — the Zerion-managed agent vault
    // for kinds 1/2/3.
    market.created_by = ctx.accounts.creator.key();
    market.subsidy_provider = ctx.accounts.creator.key();
    market.question = question;
    market.market_type = market_type;
    market.market_id = market_id;
    // threshold_bps is unused for the reachable kinds (1/2/3); zeroed.
    market.threshold_bps = 0;
    market.resolution_slot = resolution_slot;
    market.yes_shares = 0;
    market.no_shares = 0;
    market.total_yes_cost = 0;
    market.total_no_cost = 0;
    market.liquidity_param = initial_subsidy;
    // The agent's seed is real collateral now (transferred below) so the UI
    // can surface "X bUSD seeded by agent" as visible volume. yes_shares /
    // no_shares stay zero — those track human-held positions, which only
    // grow as people call buy_shares.
    market.total_volume = initial_subsidy;
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
    // Phase B: snapshot BundieVault NAV for kinds 1/2/3. For other kinds
    // these mirror the legacy `initial_nav_*` parameters so consumers can
    // read the same field uniformly.
    market.initial_nav_a = snap_a;
    market.initial_nav_b = snap_b;
    market.yes_mint_bump = ctx.bumps.yes_mint;
    market.no_mint_bump = ctx.bumps.no_mint;
    market.vault_bump = ctx.bumps.vault;
    market.kind = kind;
    market.payload = payload;
    // Pin the BundieVault authorities so the resolver can re-derive PDAs
    // (`["bundie_vault", target_authority_*]`) and reject substituted
    // vaults. `None` for kinds that don't snapshot a BundieVault.
    market.target_authority_a = auth_a;
    market.target_authority_b = auth_b;

    // Transfer the agent's bUSD seed from `subsidy_source` into the market
    // `vault`. This is what makes the market "real" — without this transfer
    // the LMSR has no backing collateral to pay out to winners and humans
    // calling buy_shares would mint outcome tokens that the market couldn't
    // honor at resolution. Done last so all field assignments are in place
    // before the CPI in case the transfer triggers a logger that reads
    // market state.
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
        "create_market_v2: kind={}, market_id={}, resolution_slot={}, seeded={}",
        kind,
        market_id,
        resolution_slot,
        initial_subsidy,
    );

    Ok(())
}
