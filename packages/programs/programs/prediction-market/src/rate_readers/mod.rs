//! Rate reader dispatch — maps the `u64` selector in a market's payload to an
//! on-chain data source for APY / rate retrieval.
//!
//! Readers are trait-objects not for runtime polymorphism but so the kind=5
//! and kind=6 resolvers share a single shape: both call
//! `reader.read_apy_bps(&account_data)`.

use anchor_lang::prelude::*;

pub mod kamino_usdc;
pub mod marinade_msol;

/// Selector constants — match the 6-entry table documented in
/// `state/market.rs` on the MARKET_KIND_RATE_BARRIER doc comment.
pub const SELECTOR_KAMINO_USDC_SUPPLY: u64 = 1;
pub const SELECTOR_MARINADE_MSOL_STAKE: u64 = 2;
// 3..=6 ship in the rest-of-week Phase 7 expansion.

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
        SELECTOR_KAMINO_USDC_SUPPLY => Some(Box::new(kamino_usdc::KaminoUsdcSupplyReader)),
        SELECTOR_MARINADE_MSOL_STAKE => Some(Box::new(marinade_msol::MarinadeMsolStakeReader)),
        _ => None,
    }
}
