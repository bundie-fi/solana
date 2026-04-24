//! Zeta Markets SOL-PERP funding rate reader — selector 5.
//!
//! Reads the annualised funding rate from the Zeta SOL-PERP market.
//! Positive bps = longs pay shorts (perp premium) → basis trade is profitable.
//! Negative bps = shorts pay longs (perp discount).
//!
//! Zeta program: BG3oRikW8d16YjUEmX3ZxHm9SiJzrGtMhsSR8aCw1Cd7
//!
//! NOTE: The exact byte offset for the funding rate within the Zeta
//! perp market account requires probe:zeta verification. This reader
//! returns 0 until that probe runs. Selector 5 markets created before
//! the offset is confirmed will resolve to NO (rate == 0 < any threshold).

use super::RateReader;
use anchor_lang::prelude::*;

pub struct ZetaPerpFundingReader;

impl RateReader for ZetaPerpFundingReader {
    fn name(&self) -> &'static str {
        "zeta-sol-perp-funding"
    }

    fn read_apy_bps(&self, _data: &[u8]) -> Result<u64> {
        // TODO(probe:zeta): verify Zeta PerpMarket layout and funding rate offset.
        // Once verified, implement: read i64 at offset N, convert to annualised bps.
        Ok(0)
    }
}
