//! Rate reader dispatch — maps the `u64` selector in a market's payload to an
//! on-chain data source for APY / rate retrieval.
//!
//! Readers are trait-objects not for runtime polymorphism but so the kind=5
//! and kind=6 resolvers share a single shape: both call
//! `reader.read_apy_bps(&account_data)`.

use anchor_lang::prelude::*;

pub mod kamino_usdc;
pub mod marinade_msol;
pub mod marginfi_usdc;
pub mod spl_stake_pool;
pub mod zeta_perp;

/// Selector constants — match the table documented in `state/market.rs`.
pub const SELECTOR_KAMINO_USDC_SUPPLY: u64 = 1;
pub const SELECTOR_MARINADE_MSOL_STAKE: u64 = 2;
pub const SELECTOR_MARGINFI_USDC: u64 = 3;
pub const SELECTOR_SPL_STAKE_POOL: u64 = 4;
pub const SELECTOR_ZETA_SOL_PERP: u64 = 5;

pub trait RateReader {
    /// Human-readable identifier — used in tests, telemetry, and error messages.
    fn name(&self) -> &'static str;

    /// Read APY-in-bps from the raw account bytes. Returns 0 on benign
    /// malformation so the resolver can fall back to a NO outcome rather
    /// than panicking. Returns `Err` only when the account is so corrupt
    /// the whole resolve ix should abort.
    fn read_apy_bps(&self, account_data: &[u8]) -> Result<u64>;
}

pub fn rate_reader_for_selector(selector: u64) -> Option<Box<dyn RateReader>> {
    match selector {
        SELECTOR_KAMINO_USDC_SUPPLY  => Some(Box::new(kamino_usdc::KaminoUsdcSupplyReader)),
        SELECTOR_MARINADE_MSOL_STAKE => Some(Box::new(marinade_msol::MarinadeMsolStakeReader)),
        SELECTOR_MARGINFI_USDC       => Some(Box::new(marginfi_usdc::MarginfiUsdcReader)),
        SELECTOR_SPL_STAKE_POOL      => Some(Box::new(spl_stake_pool::SplStakePoolReader)),
        SELECTOR_ZETA_SOL_PERP       => Some(Box::new(zeta_perp::ZetaPerpFundingReader)),
        _ => None,
    }
}
