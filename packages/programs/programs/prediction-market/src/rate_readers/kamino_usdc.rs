//! Kamino klend Reserve supply-APY reader.
//!
//! Offsets sourced from `packages/programs/programs/strategy-token/src/nav_readers/kamino.rs`
//! (pre-deletion — see git commit 1ba7ac1^) and cross-checked against
//! `nav_reader_offsets.md` memory. These are stable in klend v1.x.
//!
//! APY derivation: until we lock in the live `current_supply_apy` offset
//! from Kamino's `last_update_rates` struct, the reader returns utilization
//! in bps. Utilization is a monotone-in-APY proxy (both rise when demand
//! outpaces supply) so rate-barrier markets resolve directionally correct,
//! and Phase 7 replaces this with a true rate read before mainnet.

use super::RateReader;
use anchor_lang::prelude::*;

const OFF_AVAILABLE: usize = 224;
const OFF_BORROWED_SF: usize = 232;
const OFF_COLLATERAL_TOTAL: usize = 1376;
const RESERVE_MIN_LEN: usize = OFF_COLLATERAL_TOTAL + 8; // 1384
const SF_SHIFT: u32 = 60;

pub struct KaminoUsdcSupplyReader;

impl RateReader for KaminoUsdcSupplyReader {
    fn name(&self) -> &'static str {
        "kamino-usdc-supply"
    }

    fn read_apy_bps(&self, data: &[u8]) -> Result<u64> {
        if data.len() < RESERVE_MIN_LEN {
            return Ok(0);
        }
        let available =
            u64::from_le_bytes(data[OFF_AVAILABLE..OFF_AVAILABLE + 8].try_into().unwrap());
        let borrowed_sf = u128::from_le_bytes(
            data[OFF_BORROWED_SF..OFF_BORROWED_SF + 16]
                .try_into()
                .unwrap(),
        );
        let borrowed = (borrowed_sf >> SF_SHIFT) as u64;
        let total = available.saturating_add(borrowed);
        if total == 0 {
            return Ok(0);
        }
        let util_bps = (borrowed as u128 * 10_000 / total as u128) as u64;
        Ok(util_bps.min(10_000))
    }
}
