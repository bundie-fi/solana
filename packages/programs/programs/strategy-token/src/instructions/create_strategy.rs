use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use crate::state::*;

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreateStrategy<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Strategy::INIT_SPACE,
        seeds = [b"strategy", creator.key().as_ref(), name.as_bytes()],
        bump,
    )]
    pub strategy: Account<'info, Strategy>,

    #[account(
        init,
        payer = creator,
        mint::decimals = 9,
        mint::authority = strategy,
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA wallet for strategy funds
    #[account(
        seeds = [b"wallet", strategy.key().as_ref()],
        bump,
    )]
    pub wallet: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + NavOracle::INIT_SPACE,
        seeds = [b"nav", strategy.key().as_ref()],
        bump,
    )]
    pub nav_oracle: Account<'info, NavOracle>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<CreateStrategy>, name: String, fee_bps: u16) -> Result<()> {
    let strategy = &mut ctx.accounts.strategy;
    strategy.authority = ctx.accounts.creator.key();
    strategy.mint = ctx.accounts.mint.key();
    strategy.wallet = ctx.accounts.wallet.key();
    strategy.name = name;
    strategy.fee_bps = fee_bps;
    strategy.total_deposits = 0;
    strategy.current_nav = 0;
    strategy.total_shares = 0;
    strategy.last_nav_slot = Clock::get()?.slot;
    strategy.nav_twap_accumulator = 0;
    strategy.twap_last_slot = Clock::get()?.slot;
    strategy.created_at = Clock::get()?.unix_timestamp;
    strategy.bump = ctx.bumps.strategy;
    strategy.wallet_bump = ctx.bumps.wallet;

    let nav_oracle = &mut ctx.accounts.nav_oracle;
    nav_oracle.strategy = strategy.key();
    nav_oracle.nav_per_share = 0;
    nav_oracle.twap_value = 0;
    nav_oracle.snapshot_count = 0;
    nav_oracle.last_snapshot_slot = Clock::get()?.slot;
    nav_oracle.bump = ctx.bumps.nav_oracle;

    Ok(())
}
