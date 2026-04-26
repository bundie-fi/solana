use crate::error::MarketError;
use crate::state::{BundieVault, BUNDIE_VAULT_SEED};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + BundieVault::INIT_SPACE,
        seeds = [BUNDIE_VAULT_SEED, authority.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, BundieVault>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitVault>, initial_nav: u64) -> Result<()> {
    require!(initial_nav > 0, MarketError::InvalidPayload);
    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.nav_lamports = initial_nav;
    vault.nav_epoch = 0;
    vault.nav_slot = Clock::get()?.slot;
    vault.commit_digest = [0u8; 32];
    vault.bump = ctx.bumps.vault;
    Ok(())
}
