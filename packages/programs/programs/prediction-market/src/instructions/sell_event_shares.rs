//! sell_event_shares — sell YES/NO shares back to an event market.
//!
//! Mirrors `sell_shares.rs` but uses the `event_market` PDA seed for the
//! market-authority signing during the vault → seller payout transfer.

use crate::error::MarketError;
use crate::math::lmsr;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
#[instruction(event_id_hash: [u8; 32], outcome: Outcome, shares: u64)]
pub struct SellEventShares<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"event_market".as_ref(), event_id_hash.as_ref(), market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
        constraint = (MARKET_KIND_EVENT_THRESHOLD..=MARKET_KIND_EVENT_MAX).contains(&market.kind)
            @ MarketError::InvalidKind,
    )]
    pub market: Box<Account<'info, Market>>,

    /// YES or NO mint (caller passes the side they're selling). Verified
    /// against the market's PDA seeds in the handler.
    #[account(mut)]
    pub outcome_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = seller_shares.owner == seller.key(),
        constraint = seller_shares.mint == outcome_mint.key() @ MarketError::WrongOutcomeMint,
    )]
    pub seller_shares: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = seller_collateral.owner == seller.key(),
        constraint = seller_collateral.mint == market.collateral_mint,
    )]
    pub seller_collateral: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<SellEventShares>,
    event_id_hash: [u8; 32],
    outcome: Outcome,
    shares: u64,
) -> Result<()> {
    require!(shares > 0, MarketError::InsufficientShares);

    let market_key = ctx.accounts.market.key();
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let market_bump = ctx.accounts.market.bump;
    let yes_mint_bump = ctx.accounts.market.yes_mint_bump;
    let no_mint_bump = ctx.accounts.market.no_mint_bump;

    // Verify outcome_mint is the canonical YES or NO PDA for this market.
    let (prefix, outcome_bump): (&[u8], u8) = match outcome {
        Outcome::Yes => (b"yes_mint", yes_mint_bump),
        Outcome::No => (b"no_mint", no_mint_bump),
    };
    let expected = Pubkey::create_program_address(
        &[prefix, market_key.as_ref(), &[outcome_bump]],
        ctx.program_id,
    )
    .map_err(|_| error!(MarketError::WrongOutcomeMint))?;
    require!(
        ctx.accounts.outcome_mint.key() == expected,
        MarketError::WrongOutcomeMint
    );

    let (yes_shares, no_shares, liquidity_param, fee_bps) = {
        let m = &ctx.accounts.market;
        (m.yes_shares, m.no_shares, m.liquidity_param, m.fee_bps)
    };
    match outcome {
        Outcome::Yes => require!(yes_shares >= shares, MarketError::InsufficientShares),
        Outcome::No => require!(no_shares >= shares, MarketError::InsufficientShares),
    }

    let (post_yes, post_no) = match outcome {
        Outcome::Yes => (yes_shares - shares, no_shares),
        Outcome::No => (yes_shares, no_shares - shares),
    };
    let gross_payout = lmsr::calculate_cost(
        post_yes,
        post_no,
        liquidity_param,
        outcome == Outcome::Yes,
        shares,
    )
    .ok_or(MarketError::MathOverflow)?;

    let fee = (gross_payout as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(MarketError::MathOverflow)?
        / 10_000;
    let net_payout = gross_payout
        .checked_sub(fee as u64)
        .ok_or(MarketError::MathOverflow)?;
    require!(
        ctx.accounts.vault.amount >= net_payout,
        MarketError::InsufficientShares
    );

    // Burn the seller's shares.
    token::burn(
        CpiContext::new(
            token::ID,
            Burn {
                mint: ctx.accounts.outcome_mint.to_account_info(),
                from: ctx.accounts.seller_shares.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        shares,
    )?;

    // Payout from vault to seller. Market PDA signs.
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"event_market",
        event_id_hash.as_ref(),
        market_id_bytes.as_ref(),
        &[market_bump],
    ]];
    token::transfer(
        CpiContext::new_with_signer(
            token::ID,
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.seller_collateral.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        net_payout,
    )?;

    let market = &mut ctx.accounts.market;
    match outcome {
        Outcome::Yes => {
            market.yes_shares = market.yes_shares.checked_sub(shares).ok_or(MarketError::MathOverflow)?;
            market.total_yes_cost = market.total_yes_cost.saturating_sub(gross_payout);
        }
        Outcome::No => {
            market.no_shares = market.no_shares.checked_sub(shares).ok_or(MarketError::MathOverflow)?;
            market.total_no_cost = market.total_no_cost.saturating_sub(gross_payout);
        }
    }
    market.total_volume = market
        .total_volume
        .checked_add(gross_payout)
        .ok_or(MarketError::MathOverflow)?;

    msg!(
        "sell_event_shares: outcome_yes={} shares={} gross={} fee={} net={}",
        outcome == Outcome::Yes,
        shares,
        gross_payout,
        fee,
        net_payout
    );
    Ok(())
}
