use anchor_lang::prelude::*;

/// NAV snapshot for TWAP calculation
/// Used by prediction markets for oracle-free resolution
#[account]
#[derive(InitSpace)]
pub struct NavOracle {
    /// Strategy this oracle tracks
    pub strategy: Pubkey,
    /// Current NAV per share (scaled by 1e9)
    pub nav_per_share: u64,
    /// TWAP value (scaled by 1e9)
    pub twap_value: u64,
    /// Number of snapshots in TWAP
    pub snapshot_count: u64,
    /// Last snapshot slot
    pub last_snapshot_slot: u64,
    /// Minimum slots between snapshots to prevent manipulation
    pub min_snapshot_interval: u64,
    /// Number of slots for TWAP calculation window
    pub twap_window: u64,
    /// Bump seed
    pub bump: u8,
}
