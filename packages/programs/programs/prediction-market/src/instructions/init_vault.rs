use crate::error::MarketError;
use crate::state::{BundieVault, BUNDIE_VAULT_SEED};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

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
    /// Mint of the asset the treasury will hold (e.g. bUSD).
    pub treasury_mint: Account<'info, Mint>,
    /// Treasury ATA owned by the vault PDA itself. Created here so the
    /// vault can hold balance with no extra setup step.
    #[account(
        init,
        payer = authority,
        associated_token::mint = treasury_mint,
        associated_token::authority = vault,
    )]
    pub treasury_ata: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(
    ctx: Context<InitVault>,
    initial_nav: u64,
    owner_wallet: Pubkey,
    treasury_mint: Pubkey,
) -> Result<()> {
    require!(initial_nav > 0, MarketError::InvalidPayload);
    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.owner_wallet = owner_wallet;
    vault.treasury_mint = treasury_mint;
    vault.treasury_ata = ctx.accounts.treasury_ata.key();
    vault.nav_lamports = initial_nav;
    vault.nav_epoch = 0;
    vault.nav_slot = Clock::get()?.slot;
    vault.commit_digest = [0u8; 32];
    vault.bump = ctx.bumps.vault;
    Ok(())
}
