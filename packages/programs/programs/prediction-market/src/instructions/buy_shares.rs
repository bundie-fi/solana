use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer},
};
use crate::state::*;
use crate::math::lmsr;
use crate::error::MarketError;

/// Strategy discriminator — must match strategy-token/src/state/strategy.rs
const STRATEGY_DISCRIMINATOR: [u8; 8] = [0xd0, 0x82, 0x35, 0xce, 0x9a, 0x7f, 0x5b, 0x11];

/// Byte offset of `authority` (Pubkey, 32 bytes) within the Strategy account.
const OFF_STRATEGY_AUTHORITY: usize = 8;

/// Minimum bytes needed to read the authority field (disc + 32).
const STRATEGY_AUTH_MIN_LEN: usize = 40;

#[derive(Accounts)]
pub struct BuyMarketShares<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
    )]
    pub market: Box<Account<'info, Market>>,

    /// The Strategy account this market predicts on. Pinocchio-owned, so
    /// we validate manually: discriminator + address equality to market.strategy,
    /// then check the authority field against the buyer.
    /// CHECK: Manual validation in handler (see check_not_strategy_creator).
    #[account(
        constraint = strategy.key() == market.strategy @ MarketError::WrongStrategyForMarket,
    )]
    pub strategy: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"yes_mint", market.key().as_ref()],
        bump = market.yes_mint_bump,
    )]
    pub yes_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"no_mint", market.key().as_ref()],
        bump = market.no_mint_bump,
    )]
    pub no_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// Buyer's collateral (USDC) token account
    #[account(
        mut,
        constraint = buyer_collateral.owner == buyer.key(),
        constraint = buyer_collateral.mint == market.collateral_mint,
    )]
    pub buyer_collateral: Box<Account<'info, TokenAccount>>,

    /// Buyer's YES ATA — created if needed
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = yes_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_yes_ata: Box<Account<'info, TokenAccount>>,

    /// Buyer's NO ATA — created if needed
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = no_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_no_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Reject the tx if the buyer is the creator (`authority`) of the underlying
/// Strategy account. Address-equality check against the pinocchio Strategy
/// account's stored authority field — a creator with a second wallet can still
/// bypass this, which is a known limitation documented in the v5 spec.
fn check_not_strategy_creator(
    strategy: &UncheckedAccount,
    buyer: &Pubkey,
) -> Result<()> {
    let data = strategy.try_borrow_data()?;

    require!(
        data.len() >= STRATEGY_AUTH_MIN_LEN
            && data[0..8] == STRATEGY_DISCRIMINATOR,
        MarketError::InvalidStrategyAccount
    );

    let creator: [u8; 32] = data[OFF_STRATEGY_AUTHORITY..OFF_STRATEGY_AUTHORITY + 32]
        .try_into()
        .unwrap();

    require!(
        creator != buyer.to_bytes(),
        MarketError::CreatorCannotPredictOnOwnStrategy
    );

    Ok(())
}

pub fn handler(ctx: Context<BuyMarketShares>, outcome: Outcome, amount: u64) -> Result<()> {
    require!(amount > 0, MarketError::InsufficientShares);

    // 0. Creator self-exclusion: strategy's on-chain creator cannot take
    //    prediction-market positions against their own strategy.
    check_not_strategy_creator(&ctx.accounts.strategy, &ctx.accounts.buyer.key())?;

    // 1. Calculate LS-LMSR cost — extract values first to avoid borrow conflicts later
    let (cost, fee, total_cost, market_strategy, market_id_bytes, market_bump) = {
        let market = &ctx.accounts.market;

        let cost = lmsr::calculate_cost(
            market.yes_shares,
            market.no_shares,
            market.liquidity_param,
            outcome == Outcome::Yes,
            amount,
        ).ok_or(MarketError::MathOverflow)?;

        // 2. Apply protocol fee
        let fee = (cost as u128)
            .checked_mul(market.fee_bps as u128)
            .ok_or(MarketError::MathOverflow)?
            / 10_000;
        let total_cost = cost.checked_add(fee as u64).ok_or(MarketError::MathOverflow)?;

        require!(
            ctx.accounts.buyer_collateral.amount >= total_cost,
            MarketError::InsufficientShares
        );

        (cost, fee, total_cost, market.strategy, market.market_id.to_le_bytes(), market.bump)
    };

    // 3. Transfer collateral from buyer to vault
    let transfer_ctx = CpiContext::new(
        token::ID,
        Transfer {
            from: ctx.accounts.buyer_collateral.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, total_cost)?;

    // 4. Mint outcome tokens to buyer — market PDA signs
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        market_strategy.as_ref(),
        market_id_bytes.as_ref(),
        &[market_bump],
    ]];

    match outcome {
        Outcome::Yes => {
            let mint_ctx = CpiContext::new_with_signer(
                token::ID,
                MintTo {
                    mint: ctx.accounts.yes_mint.to_account_info(),
                    to: ctx.accounts.buyer_yes_ata.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            );
            token::mint_to(mint_ctx, amount)?;
            let market = &mut ctx.accounts.market;
            market.yes_shares = market.yes_shares.checked_add(amount).ok_or(MarketError::MathOverflow)?;
            market.total_yes_cost = market.total_yes_cost.checked_add(total_cost).ok_or(MarketError::MathOverflow)?;
            market.total_volume = market.total_volume.checked_add(total_cost).ok_or(MarketError::MathOverflow)?;
        }
        Outcome::No => {
            let mint_ctx = CpiContext::new_with_signer(
                token::ID,
                MintTo {
                    mint: ctx.accounts.no_mint.to_account_info(),
                    to: ctx.accounts.buyer_no_ata.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            );
            token::mint_to(mint_ctx, amount)?;
            let market = &mut ctx.accounts.market;
            market.no_shares = market.no_shares.checked_add(amount).ok_or(MarketError::MathOverflow)?;
            market.total_no_cost = market.total_no_cost.checked_add(total_cost).ok_or(MarketError::MathOverflow)?;
            market.total_volume = market.total_volume.checked_add(total_cost).ok_or(MarketError::MathOverflow)?;
        }
    }

    msg!(
        "buy_shares: outcome={}, amount={}, cost={}, fee={}",
        outcome == Outcome::Yes,
        amount,
        cost,
        fee
    );
    Ok(())
}
