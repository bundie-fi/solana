//! MarginFi USDC bank utilization reader — selector 3.
//!
//! Reads total_liability_shares / total_asset_shares from a MarginFi Bank
//! account (WrappedI80F48 = two u64s representing a 128-bit fixed-point value).
//!
//! Byte offsets match packages/programs/scripts/chaos-sim/src/lib/rate-surfaces.ts.
//! Run `probe:marginfi` to verify before relying on these for resolution.
//!
//! MarginFi program: MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA (mainnet)
//! USDC bank (mainnet main-pool): 2s37akK2eyBbp8DZgCm7RtsaEz8eqqZyhu81pttYiEy3

use super::RateReader;
use anchor_lang::prelude::*;

const OFF_LIABILITY_SHARES: usize = 600;
const OFF_ASSET_SHARES: usize = 616;
const BANK_MIN_LEN: usize = OFF_ASSET_SHARES + 16; // both WrappedI80F48 (16 bytes each)

pub struct MarginfiUsdcReader;

impl RateReader for MarginfiUsdcReader {
    fn name(&self) -> &'static str {
        "marginfi-usdc-utilization"
    }

    fn read_apy_bps(&self, data: &[u8]) -> Result<u64> {
        if data.len() < BANK_MIN_LEN {
            return Ok(0);
        }
        // WrappedI80F48: treat as u128 (two LE u64s) for ratio computation.
        let liab = u128::from_le_bytes(
            data[OFF_LIABILITY_SHARES..OFF_LIABILITY_SHARES + 16]
                .try_into()
                .unwrap(),
        );
        let asset = u128::from_le_bytes(
            data[OFF_ASSET_SHARES..OFF_ASSET_SHARES + 16]
                .try_into()
                .unwrap(),
        );
        if asset == 0 {
            return Ok(0);
        }
        let util_bps = (liab * 10_000 / asset) as u64;
        Ok(util_bps.min(10_000))
    }
}
