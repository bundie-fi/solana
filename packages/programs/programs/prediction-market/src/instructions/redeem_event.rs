//! redeem_event — burn winning YES (or NO) shares for a pro-rata claim on
//! the vault after an event market has resolved.

use crate::error::MarketError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
#[instruction(event_id_hash: [u8; 32])]
pub struct RedeemEvent<'info> {
    #[account(mut)]
    pub redeemer: Signer<'info>,

    #[account(
        seeds = [b"event_market".as_ref(), event_id_hash.as_ref(), market.market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.status == MarketStatus::Resolved @ MarketError::MarketNotActive,
        constraint = market.outcome.is_some() @ MarketError::NoOutcome,
        constraint = (MARKET_KIND_EVENT_THRESHOLD..=MARKET_KIND_EVENT_MAX).contains(&market.kind)
            @ MarketError::InvalidKind,
    )]
    pub market: Account<'info, Market>,

    /// The winning mint (caller passes the side that won).
    #[account(mut)]
    pub winner_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = redeemer_shares.owner == redeemer.key(),
        constraint = redeemer_shares.mint == winner_mint.key() @ MarketError::WrongOutcomeMint,
    )]
    pub redeemer_shares: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = redeemer_collateral.owner == redeemer.key(),
        constraint = redeemer_collateral.mint == market.collateral_mint,
    )]
    pub redeemer_collateral: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RedeemEvent>, event_id_hash: [u8; 32]) -> Result<()> {
    let outcome = ctx.accounts.market.outcome.unwrap();
    let market_key = ctx.accounts.market.key();
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let market_bump = ctx.accounts.market.bump;
    let yes_mint_bump = ctx.accounts.market.yes_mint_bump;
    let no_mint_bump = ctx.accounts.market.no_mint_bump;

    // Verify winner_mint is the canonical winning-outcome PDA.
    let (prefix, winner_bump): (&[u8], u8) = match outcome {
        Outcome::Yes => (b"yes_mint", yes_mint_bump),
        Outcome::No => (b"no_mint", no_mint_bump),
    };
    let expected = Pubkey::create_program_address(
        &[prefix, market_key.as_ref(), &[winner_bump]],
        ctx.program_id,
    )
    .map_err(|_| error!(MarketError::WrongOutcomeMint))?;
    require!(
        ctx.accounts.winner_mint.key() == expected,
        MarketError::WrongOutcomeMint
    );

    let redeemer_shares = ctx.accounts.redeemer_shares.amount;
    require!(redeemer_shares > 0, MarketError::InsufficientShares);
    let winning_supply = ctx.accounts.winner_mint.supply;
    require!(winning_supply > 0, MarketError::InsufficientShares);

    let vault_balance = ctx.accounts.vault.amount;
    let payout = (redeemer_shares as u128)
        .checked_mul(vault_balance as u128)
        .ok_or(MarketError::MathOverflow)?
        .checked_div(winning_supply as u128)
        .ok_or(MarketError::MathOverflow)? as u64;

    // Burn the redeemer's winning shares.
    token::burn(
        CpiContext::new(
            token::ID,
            Burn {
                mint: ctx.accounts.winner_mint.to_account_info(),
                from: ctx.accounts.redeemer_shares.to_account_info(),
                authority: ctx.accounts.redeemer.to_account_info(),
            },
        ),
        redeemer_shares,
    )?;

    // Vault → redeemer payout. Market PDA signs with event-market seeds.
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
                to: ctx.accounts.redeemer_collateral.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        payout,
    )?;

    msg!(
        "redeem_event: shares={} payout={} outcome_yes={}",
        redeemer_shares,
        payout,
        outcome == Outcome::Yes
    );
    Ok(())
}
