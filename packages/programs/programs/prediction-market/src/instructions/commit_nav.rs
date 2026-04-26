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

/// Commit a new NAV snapshot for this vault.
///
/// The strict `new_epoch == prev_epoch + 1` policy is intentional: it makes
/// the digest chain meaningful and structurally prevents replay or
/// out-of-order commits. If an agent misses an epoch, it must commit a no-op
/// for the missing epoch (`new_nav = prev_nav`, with a digest that records
/// the gap reason) before catching up. There is no on-chain "skip"
/// instruction by design — recovery is an off-chain audit concern.
pub fn handler(
    ctx: Context<CommitNav>,
    new_nav: u64,
    new_epoch: u64,
    commit_digest: [u8; 32],
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let next = vault
        .nav_epoch
        .checked_add(1)
        .ok_or(MarketError::MathOverflow)?;
    require!(new_epoch == next, MarketError::StaleNavEpoch);
    vault.nav_lamports = new_nav;
    vault.nav_epoch = new_epoch;
    vault.nav_slot = Clock::get()?.slot;
    vault.commit_digest = commit_digest;
    Ok(())
}
