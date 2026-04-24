//! Marinade State `msol_price` reader.
//!
//! Offset 512 is a Q32.32 ratio of SOL to mSOL. A fresh mSOL token trades
//! at 1.0 and price drifts upward as staking rewards accrue. The bps delta
//! above parity is a first-order proxy for annualised stake APY (it
//! compounds, so the delta grows roughly linearly on the timescales we
//! care about for these markets).

use super::RateReader;
use anchor_lang::prelude::*;

const OFF_MSOL_PRICE: usize = 512;
const STATE_MIN_LEN: usize = OFF_MSOL_PRICE + 8;
const Q32_ONE: u64 = 1 << 32; // 2^32 = 1.0 in Q32.32

pub struct MarinadeMsolStakeReader;

impl RateReader for MarinadeMsolStakeReader {
    fn name(&self) -> &'static str { "marinade-msol-stake" }

    fn read_apy_bps(&self, data: &[u8]) -> Result<u64> {
        if data.len() < STATE_MIN_LEN { return Ok(0); }
        let raw = u64::from_le_bytes(
            data[OFF_MSOL_PRICE..OFF_MSOL_PRICE + 8].try_into().unwrap(),
        );
        if raw <= Q32_ONE { return Ok(0); }
        let spread = (raw - Q32_ONE) as u128;
        // bps = spread / Q32_ONE * 10_000
        Ok((spread * 10_000 / Q32_ONE as u128) as u64)
    }
}
