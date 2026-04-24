//! Reads Marinade mSOL stake APY.
//! Full offset-read logic lands in Task 2.5.

use super::RateReader;
use anchor_lang::prelude::*;

pub struct MarinadeMsolStakeReader;

impl RateReader for MarinadeMsolStakeReader {
    fn name(&self) -> &'static str { "marinade-msol-stake" }
    fn read_apy_bps(&self, _account_data: &[u8]) -> Result<u64> { Ok(0) }
}
