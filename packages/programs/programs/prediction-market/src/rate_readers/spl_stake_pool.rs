//! SPL Stake Pool exchange-rate reader — selector 4.
//!
//! Covers Jito, BlazeStake, and any other SPL-compatible stake pool.
//! Returns the pool's exchange rate premium above 1.0 SOL/token in bps.
//!
//! Layout: solana-labs/solana-program-library stake-pool/state.rs (StakePool).
//! total_lamports at offset 258, pool_token_supply at offset 266.
//!
//! Note: this is the SPL stake-pool layout, NOT an Anchor account.
//! There is no 8-byte discriminator prefix.

use super::RateReader;
use anchor_lang::prelude::*;

const OFF_TOTAL_LAMPORTS: usize = 258;
const OFF_POOL_TOKEN_SUPPLY: usize = 266;
const POOL_MIN_LEN: usize = OFF_POOL_TOKEN_SUPPLY + 8;
const LAMPORTS_PER_SOL: u128 = 1_000_000_000;

pub struct SplStakePoolReader;

impl RateReader for SplStakePoolReader {
    fn name(&self) -> &'static str {
        "spl-stake-pool-rate"
    }

    fn read_apy_bps(&self, data: &[u8]) -> Result<u64> {
        if data.len() < POOL_MIN_LEN {
            return Ok(0);
        }
        let total_lamports = u64::from_le_bytes(
            data[OFF_TOTAL_LAMPORTS..OFF_TOTAL_LAMPORTS + 8]
                .try_into()
                .unwrap(),
        ) as u128;
        let token_supply = u64::from_le_bytes(
            data[OFF_POOL_TOKEN_SUPPLY..OFF_POOL_TOKEN_SUPPLY + 8]
                .try_into()
                .unwrap(),
        ) as u128;
        if token_supply == 0 {
            return Ok(0);
        }
        // lamports per pool token (9-decimal)
        let lamper_token = total_lamports * LAMPORTS_PER_SOL / token_supply;
        if lamper_token <= LAMPORTS_PER_SOL {
            return Ok(0);
        }
        let bps = ((lamper_token - LAMPORTS_PER_SOL) * 10_000 / LAMPORTS_PER_SOL) as u64;
        Ok(bps.min(5_000))
    }
}
