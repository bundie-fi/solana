use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer},
};
use crate::state::*;
use crate::math::lmsr;
use crate::error::MarketError;

#[derive(Accounts)]
pub struct BuyMarketShares<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ MarketError::MarketNotActive,
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

pub fn handler(ctx: Context<BuyMarketShares>, outcome: Outcome, amount: u64) -> Result<()> {
    require!(amount > 0, MarketError::InsufficientShares);

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
