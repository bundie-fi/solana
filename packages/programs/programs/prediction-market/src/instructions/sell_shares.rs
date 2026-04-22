use crate::error::MarketError;
use crate::math::lmsr;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct SellMarketShares<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
    )]
    pub market: Account<'info, Market>,

    /// The outcome mint being sold (YES or NO).
    /// Key verified against PDA in handler.
    #[account(mut)]
    pub outcome_mint: Account<'info, Mint>,

    /// Seller's token account holding the shares to sell (burned here)
    #[account(
        mut,
        constraint = seller_shares.owner == seller.key(),
        constraint = seller_shares.mint == outcome_mint.key() @ MarketError::WrongOutcomeMint,
    )]
    pub seller_shares: Account<'info, TokenAccount>,

    /// Seller's collateral token account (receives payout)
    #[account(
        mut,
        constraint = seller_collateral.owner == seller.key(),
        constraint = seller_collateral.mint == market.collateral_mint,
    )]
    pub seller_collateral: Account<'info, TokenAccount>,

    /// Market vault — source of payout; authority is the market PDA
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SellMarketShares>, outcome: Outcome, shares: u64) -> Result<()> {
    require!(shares > 0, MarketError::InsufficientShares);

    // Extract fields before mutable borrow of market
    let market_key = ctx.accounts.market.key();
    let market_strategy = ctx.accounts.market.strategy;
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let market_bump = ctx.accounts.market.bump;
    let yes_mint_bump = ctx.accounts.market.yes_mint_bump;
    let no_mint_bump = ctx.accounts.market.no_mint_bump;

    // --- 1. Verify outcome_mint is the correct PDA ---
    let (outcome_prefix, outcome_bump): (&[u8], u8) = match outcome {
        Outcome::Yes => (b"yes_mint", yes_mint_bump),
        Outcome::No => (b"no_mint", no_mint_bump),
    };
    let expected_mint = Pubkey::create_program_address(
        &[outcome_prefix, market_key.as_ref(), &[outcome_bump]],
        ctx.program_id,
    )
    .map_err(|_| error!(MarketError::WrongOutcomeMint))?;
    require!(
        ctx.accounts.outcome_mint.key() == expected_mint,
        MarketError::WrongOutcomeMint
    );

    // --- 2. Validate share counts ---
    let (yes_shares, no_shares, liquidity_param, fee_bps) = {
        let m = &ctx.accounts.market;
        (m.yes_shares, m.no_shares, m.liquidity_param, m.fee_bps)
    };

    match outcome {
        Outcome::Yes => require!(yes_shares >= shares, MarketError::InsufficientShares),
        Outcome::No => require!(no_shares >= shares, MarketError::InsufficientShares),
    }

    // --- 3. Calculate LS-LMSR payout ---
    // Selling `shares` of outcome X from state (yes, no):
    //   payout = C(yes, no) - C(yes - shares, no)   [for YES]
    //          = calculate_cost(yes - shares, no, b, true, shares)
    // This is the same formula as buying `shares` from the post-sell state.
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

    // Deduct protocol fee
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

    // --- 4. Burn seller's outcome shares ---
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

    // --- 5. Transfer payout from vault to seller (market PDA signs) ---
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        market_strategy.as_ref(),
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

    // --- 6. Update market state ---
    let market = &mut ctx.accounts.market;
    match outcome {
        Outcome::Yes => {
            market.yes_shares = market
                .yes_shares
                .checked_sub(shares)
                .ok_or(MarketError::MathOverflow)?;
            market.total_yes_cost = market.total_yes_cost.saturating_sub(gross_payout);
        }
        Outcome::No => {
            market.no_shares = market
                .no_shares
                .checked_sub(shares)
                .ok_or(MarketError::MathOverflow)?;
            market.total_no_cost = market.total_no_cost.saturating_sub(gross_payout);
        }
    }
    market.total_volume = market
        .total_volume
        .checked_add(gross_payout)
        .ok_or(MarketError::MathOverflow)?;

    msg!(
        "sell_shares: outcome={}, shares={}, gross={}, fee={}, net={}",
        outcome == Outcome::Yes,
        shares,
        gross_payout,
        fee,
        net_payout,
    );

    Ok(())
}
