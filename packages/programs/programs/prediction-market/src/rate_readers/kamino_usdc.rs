//! Reads Kamino USDC reserve's supply APY.
//! Full offset-read logic lands in Task 2.5.

use super::RateReader;
use anchor_lang::prelude::*;

pub struct KaminoUsdcSupplyReader;

impl RateReader for KaminoUsdcSupplyReader {
    fn name(&self) -> &'static str { "kamino-usdc-supply" }
    fn read_apy_bps(&self, _account_data: &[u8]) -> Result<u64> { Ok(0) }
}
