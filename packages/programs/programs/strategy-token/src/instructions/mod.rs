pub mod create_strategy;
pub mod buy_shares;
pub mod redeem_shares;
pub mod rebalance;
pub mod update_nav;

pub use create_strategy::*;
pub use buy_shares::*;
pub use redeem_shares::*;
pub use rebalance::*;
pub use update_nav::*;

/// Allocation target for rebalancing
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Allocation {
    /// Protocol identifier
    pub protocol: Pubkey,
    /// Allocation percentage in basis points (e.g., 5000 = 50%)
    pub weight_bps: u16,
}
