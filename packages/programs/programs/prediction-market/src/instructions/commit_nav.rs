use crate::error::MarketError;
use crate::state::{BundieVault, BUNDIE_VAULT_SEED};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CommitNav<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [BUNDIE_VAULT_SEED, authority.key().as_ref()],
        bump = vault.bump,
        has_one = authority @ MarketError::UnauthorizedVaultCommit,
    )]
    pub vault: Account<'info, BundieVault>,
}

pub fn handler(
    ctx: Context<CommitNav>,
    new_nav: u64,
    new_epoch: u64,
    commit_digest: [u8; 32],
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(
        new_epoch == vault.nav_epoch + 1,
        MarketError::StaleNavEpoch
    );
    vault.nav_lamports = new_nav;
    vault.nav_epoch = new_epoch;
    vault.nav_slot = Clock::get()?.slot;
    vault.commit_digest = commit_digest;
    Ok(())
}
