use crate::error::MarketError;
use crate::state::{BundieVault, BUNDIE_VAULT_SEED};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut, address = vault.owner_wallet @ MarketError::UnauthorizedVaultClose)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [BUNDIE_VAULT_SEED, vault.authority.as_ref()],
        bump = vault.bump,
        close = owner,
    )]
    pub vault: Account<'info, BundieVault>,

    #[account(mut, address = vault.treasury_ata)]
    pub treasury_ata: Account<'info, TokenAccount>,

    #[account(mut, token::mint = vault.treasury_mint, token::authority = owner)]
    pub owner_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Drain the vault's treasury into the owner's ATA, close the treasury
/// ATA (rent → owner), then close the BundieVault account itself
/// (handled by Anchor's `close = owner` constraint). Only callable by
/// `vault.owner_wallet`.
pub fn handler(ctx: Context<CloseVault>) -> Result<()> {
    let amount = ctx.accounts.treasury_ata.amount;
    let auth = ctx.accounts.vault.authority;
    let bump = ctx.accounts.vault.bump;
    let seeds: &[&[u8]] = &[BUNDIE_VAULT_SEED, auth.as_ref(), &[bump]];

    if amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                token::ID,
                Transfer {
                    from: ctx.accounts.treasury_ata.to_account_info(),
                    to: ctx.accounts.owner_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
    }
    token::close_account(CpiContext::new_with_signer(
        token::ID,
        CloseAccount {
            account: ctx.accounts.treasury_ata.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
        &[seeds],
    ))?;
    Ok(())
}
