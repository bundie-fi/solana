use anchor_lang::prelude::*;

pub const BUNDIE_VAULT_SEED: &[u8] = b"bundie_vault";

#[account]
#[derive(InitSpace)]
pub struct BundieVault {
    pub authority: Pubkey,
    pub nav_lamports: u64,
    pub nav_epoch: u64,
    pub nav_slot: u64,
    /// Opaque off-chain audit commitment (e.g. hash of the agent's
    /// computation log for this epoch). The program does not verify or
    /// interpret this value; it is recorded verbatim for off-chain audit.
    pub commit_digest: [u8; 32],
    pub bump: u8,
}
