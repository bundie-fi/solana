use anchor_lang::prelude::*;

pub const BUNDIE_VAULT_SEED: &[u8] = b"bundie_vault";

#[account]
#[derive(InitSpace)]
pub struct BundieVault {
    pub authority: Pubkey,
    /// Wallet that funded / owns the agent. Authorized to call
    /// `close_vault` and reclaim treasury balance.
    pub owner_wallet: Pubkey,
    /// SPL mint of the treasury asset (e.g. bUSD).
    pub treasury_mint: Pubkey,
    /// Associated token account owned by this vault PDA that holds
    /// `treasury_mint` balance. Created during `init_vault`.
    pub treasury_ata: Pubkey,
    pub nav_lamports: u64,
    pub nav_epoch: u64,
    pub nav_slot: u64,
    /// Opaque off-chain audit commitment (e.g. hash of the agent's
    /// computation log for this epoch). The program does not verify or
    /// interpret this value; it is recorded verbatim for off-chain audit.
    pub commit_digest: [u8; 32],
    pub bump: u8,
}
