#![no_std]

// Re-export core traits
pub use beethoven_core::{Deposit, DepositInit, Perps, Swap};
#[cfg(feature = "drift-deposit")]
pub use beethoven_deposit_drift as drift;
#[cfg(feature = "jupiter-deposit")]
pub use beethoven_deposit_jupiter as jupiter;
#[cfg(feature = "drift-perps")]
pub use beethoven_perps_drift as drift_perps;
#[cfg(feature = "mango-perps")]
pub use beethoven_perps_mango as mango;
#[cfg(feature = "zeta-perps")]
pub use beethoven_perps_zeta as zeta;
// Re-export protocol crates under feature flags
#[cfg(feature = "drift-vaults-deposit")]
pub use beethoven_deposit_drift_vaults as drift_vaults;
#[cfg(feature = "kamino-deposit")]
pub use beethoven_deposit_kamino as kamino;
#[cfg(feature = "marginfi-deposit")]
pub use beethoven_deposit_marginfi as marginfi;
#[cfg(feature = "marinade-deposit")]
pub use beethoven_deposit_marinade as marinade;
#[cfg(feature = "meteora-vaults-deposit")]
pub use beethoven_deposit_meteora_vaults as meteora_vaults;
#[cfg(feature = "solend-deposit")]
pub use beethoven_deposit_solend as solend;
#[cfg(feature = "spl-stake-pool-deposit")]
pub use beethoven_deposit_spl_stake_pool as spl_stake_pool;
#[cfg(feature = "aldrin-swap")]
pub use beethoven_swap_aldrin as aldrin;
#[cfg(feature = "aldrin_v2-swap")]
pub use beethoven_swap_aldrin_v2 as aldrin_v2;
#[cfg(feature = "futarchy-swap")]
pub use beethoven_swap_futarchy as futarchy;
#[cfg(feature = "gamma-swap")]
pub use beethoven_swap_gamma as gamma;
#[cfg(feature = "hadron-swap")]
pub use beethoven_swap_hadron as hadron;
#[cfg(feature = "heaven-swap")]
pub use beethoven_swap_heaven as heaven;
#[cfg(feature = "manifest-swap")]
pub use beethoven_swap_manifest as manifest;
#[cfg(feature = "meteora-damm-v2-swap")]
pub use beethoven_swap_meteora_damm_v2 as meteora_damm_v2;
#[cfg(feature = "meteora-dlmm-swap")]
pub use beethoven_swap_meteora_dlmm as meteora_dlmm;
#[cfg(feature = "omnipair-swap")]
pub use beethoven_swap_omnipair as omnipair;
#[cfg(feature = "openbook-v2-swap")]
pub use beethoven_swap_openbook_v2 as openbook_v2;
#[cfg(feature = "orca-whirlpools-swap")]
pub use beethoven_swap_orca_whirlpools as orca_whirlpools;
#[cfg(feature = "perena-swap")]
pub use beethoven_swap_perena as perena;
#[cfg(feature = "phoenix-swap")]
pub use beethoven_swap_phoenix as phoenix;
#[cfg(feature = "raydium-amm-v4-swap")]
pub use beethoven_swap_raydium_amm_v4 as raydium_amm_v4;
#[cfg(feature = "raydium-clmm-swap")]
pub use beethoven_swap_raydium_clmm as raydium_clmm;
#[cfg(feature = "raydium-cpmm-swap")]
pub use beethoven_swap_raydium_cpmm as raydium_cpmm;
#[cfg(feature = "raydium-cpmm-devnet-swap")]
pub use beethoven_swap_raydium_cpmm_devnet as raydium_cpmm_devnet;
#[cfg(feature = "scale_amm-swap")]
pub use beethoven_swap_scale_amm as scale_amm;
#[cfg(feature = "scale_vmm-swap")]
pub use beethoven_swap_scale_vmm as scale_vmm;
#[cfg(feature = "solfi-swap")]
pub use beethoven_swap_solfi as solfi;
#[cfg(feature = "solfi_v2-swap")]
pub use beethoven_swap_solfi_v2 as solfi_v2;

// Context enums and convenience functions
mod context;
pub use context::*;
