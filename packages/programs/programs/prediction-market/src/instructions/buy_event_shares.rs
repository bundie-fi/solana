//! buy_event_shares — buy YES/NO shares in an event market.
//!
//! Mirrors `buy_shares.rs` but:
//!   - Uses the `event_market` PDA seed (not `market`) for signer derivation
//!   - Drops the strategy-creator self-exclusion (event markets have no
//!     strategy concept — anyone can trade)
//!   - Takes `event_id_hash` as instruction data to re-derive the market
//!     PDA in the seeds constraint
//!
//! The buyer pays USDC into the market vault; YES/NO mint authority is the
//! market PDA, so we sign with the event-market seeds.

use crate::error::MarketError;
use crate::math::lmsr;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer},
};

#[derive(Accounts)]
#[instruction(event_id_hash: [u8; 32], outcome: Outcome, amount: u64)]
pub struct BuyEventShares<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"event_market".as_ref(), event_id_hash.as_ref(), market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
        constraint = (MARKET_KIND_EVENT_THRESHOLD..=MARKET_KIND_EVENT_MAX).contains(&market.kind)
            @ MarketError::InvalidKind,
    )]
    pub market: Box<Account<'info, Market>>,

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

    /// Buyer's USDC ATA — must hold enough to pay cost + fee.
    #[account(
        mut,
        constraint = buyer_collateral.owner == buyer.key(),
        constraint = buyer_collateral.mint == market.collateral_mint,
    )]
    pub buyer_collateral: Box<Account<'info, TokenAccount>>,

    /// Buyer's YES ATA — created on first buy if missing.
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = yes_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_yes_ata: Box<Account<'info, TokenAccount>>,

    /// Buyer's NO ATA — created on first buy if missing.
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

pub fn handler(
    ctx: Context<BuyEventShares>,
    event_id_hash: [u8; 32],
    outcome: Outcome,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, MarketError::InsufficientShares);

    // 1. LS-LMSR cost + fee. Extract market fields up front so the
    //    mutable borrow at write-time doesn't conflict with reads.
    let (cost, fee, total_cost, market_id_bytes, market_bump) = {
        let market = &ctx.accounts.market;
        let cost = lmsr::calculate_cost(
            market.yes_shares,
            market.no_shares,
            market.liquidity_param,
            outcome == Outcome::Yes,
            amount,
        )
        .ok_or(MarketError::MathOverflow)?;
        let fee = (cost as u128)
            .checked_mul(market.fee_bps as u128)
            .ok_or(MarketError::MathOverflow)?
            / 10_000;
        let total_cost = cost.checked_add(fee as u64).ok_or(MarketError::MathOverflow)?;
        require!(
            ctx.accounts.buyer_collateral.amount >= total_cost,
            MarketError::InsufficientShares
        );
        (
            cost,
            fee,
            total_cost,
            market.market_id.to_le_bytes(),
            market.bump,
        )
    };

    // 2. Pull USDC from buyer into vault.
    token::transfer(
        CpiContext::new(
            token::ID,
            Transfer {
                from: ctx.accounts.buyer_collateral.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        total_cost,
    )?;

    // 3. Mint YES or NO to buyer. Market PDA signs with event-market seeds.
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"event_market",
        event_id_hash.as_ref(),
        market_id_bytes.as_ref(),
        &[market_bump],
    ]];

    match outcome {
        Outcome::Yes => {
            token::mint_to(
                CpiContext::new_with_signer(
                    token::ID,
                    MintTo {
                        mint: ctx.accounts.yes_mint.to_account_info(),
                        to: ctx.accounts.buyer_yes_ata.to_account_info(),
                        authority: ctx.accounts.market.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
            )?;
            let market = &mut ctx.accounts.market;
            market.yes_shares = market
                .yes_shares
                .checked_add(amount)
                .ok_or(MarketError::MathOverflow)?;
            market.total_yes_cost = market
                .total_yes_cost
                .checked_add(total_cost)
                .ok_or(MarketError::MathOverflow)?;
            market.total_volume = market
                .total_volume
                .checked_add(total_cost)
                .ok_or(MarketError::MathOverflow)?;
        }
        Outcome::No => {
            token::mint_to(
                CpiContext::new_with_signer(
                    token::ID,
                    MintTo {
                        mint: ctx.accounts.no_mint.to_account_info(),
                        to: ctx.accounts.buyer_no_ata.to_account_info(),
                        authority: ctx.accounts.market.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
            )?;
            let market = &mut ctx.accounts.market;
            market.no_shares = market
                .no_shares
                .checked_add(amount)
                .ok_or(MarketError::MathOverflow)?;
            market.total_no_cost = market
                .total_no_cost
                .checked_add(total_cost)
                .ok_or(MarketError::MathOverflow)?;
            market.total_volume = market
                .total_volume
                .checked_add(total_cost)
                .ok_or(MarketError::MathOverflow)?;
        }
    }

    msg!(
        "buy_event_shares: outcome_yes={} amount={} cost={} fee={}",
        outcome == Outcome::Yes,
        amount,
        cost,
        fee
    );
    Ok(())
}
