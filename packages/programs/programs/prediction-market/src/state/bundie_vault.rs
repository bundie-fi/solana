use anchor_lang::prelude::*;

pub const BUNDIE_VAULT_SEED: &[u8] = b"bundie_vault";

#[account]
pub struct BundieVault {
    pub authority: Pubkey,
    pub nav_lamports: u64,
    pub nav_epoch: u64,
    pub nav_slot: u64,
    pub commit_digest: [u8; 32],
    pub bump: u8,
}

impl BundieVault {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 32 + 1;
}
