use crate::error::MarketError;
use crate::state::{BundieVault, BUNDIE_VAULT_SEED};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct DepositToVault<'info> {
    pub depositor: Signer<'info>,

    #[account(mut)]
    pub depositor_ata: Account<'info, TokenAccount>,

    #[account(
        seeds = [BUNDIE_VAULT_SEED, vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, BundieVault>,

    #[account(mut, address = vault.treasury_ata)]
    pub treasury_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Move `amount` of the treasury mint from the depositor's ATA into
/// the vault's treasury ATA. Anyone may seed an agent — the only
/// constraint is that the supplied `treasury_ata` matches the one the
/// vault was initialised with.
pub fn handler(ctx: Context<DepositToVault>, amount: u64) -> Result<()> {
    require!(amount > 0, MarketError::InvalidPayload);
    token::transfer(
        CpiContext::new(
            token::ID,
            Transfer {
                from: ctx.accounts.depositor_ata.to_account_info(),
                to: ctx.accounts.treasury_ata.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
    )?;
    Ok(())
}
