//! Kamino reserve reader — exchange-rate read of a `klend` Reserve account.
//!
//! Layout source: Kamino-Finance/klend, programs/klend/src/state/reserve.rs.
//! `Reserve` is `#[account(zero_copy)]` (Pod, repr(C)). Field offsets relative
//! to the account start (including the 8-byte Anchor discriminator):
//!
//!     0..8       Anchor discriminator
//!     8..16      version: u64
//!     16..32     last_update (slot:u64, stale:u8, price_status:u8, padding[6])
//!     32..64     lending_market: Pubkey
//!     64..96     farm_collateral: Pubkey
//!     96..128    farm_debt:       Pubkey
//!     128..      ReserveLiquidity {
//!                    mint_pubkey:        Pubkey   // 128..160
//!                    supply_vault:       Pubkey   // 160..192
//!                    fee_vault:          Pubkey   // 192..224
//!                    available_amount:   u64      // 224..232  (★ used)
//!                    borrowed_amount_sf: u128     // 232..248  (★ used)
//!                    market_price_sf:    u128     // 248..264
//!                    ...
//!                }
//!     1344..    ReserveCollateral starts at offset 1344 (liquidity = 1216 B):
//!                    mint_pubkey:        Pubkey   // 1344..1376
//!                    mint_total_supply:  u64      // 1376..1384  (★ used)
//!                    ...
//!
//! `borrowed_amount_sf` is klend's "Sf" (scaled-fraction, fixed-point shifted
//! by 2^60). To get underlying tokens we shift right by `SF_SCALE_BITS`.
//!
//! Liquidity exchange rate (cToken → underlying):
//!     value = ctoken_amount * (available + (borrowed_sf >> 60)) / collateral_supply
//!
//! These offsets are mirrored from `packages/beethoven/crates/deposit/kamino`
//! and were stable in klend v1.x at the time of writing. A defensive
//! length check guards against reading from a too-small account; a
//! wrong-but-large account would silently corrupt NAV — devnet
//! integration MUST validate against a live reserve before mainnet.

use pinocchio::{account::AccountView, error::ProgramError};

use super::PositionReader;

/// Kamino-Lending program ID (mainnet & devnet share the same ID).
/// Used by `update_nav` to identify "this remaining-account is a Kamino
/// reserve, dispatch to KaminoReserveReader".
///
/// Encoded base58: `KLend2g3cP87ber8p32LuJLuLPzCvXN4KcKr2S8MQek`.
pub const KAMINO_LEND_PROGRAM_ID: pinocchio::address::Address =
    pinocchio::address::Address::new_from_array([
        4, 178, 172, 177, 18, 88, 204, 227, 104, 44, 65, 139, 168, 114, 255, 61, 249, 17, 2, 113,
        47, 21, 175, 18, 182, 190, 105, 179, 67, 91, 0, 8,
    ]);

const RESERVE_OFFSET_LIQUIDITY_AVAILABLE: usize = 224;
const RESERVE_OFFSET_LIQUIDITY_BORROWED_SF: usize = 232;
const RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY: usize = 1376;
const RESERVE_MIN_LEN: usize = RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY + 8;
const SF_SCALE_BITS: u32 = 60;

pub struct KaminoReserveReader;

impl PositionReader for KaminoReserveReader {
    fn value_in_quote(
        position_account: &AccountView,
        holding_amount: u64,
    ) -> Result<u64, ProgramError> {
        // Owner check — guarantees the bytes we're about to slice into are
        // really a klend Reserve and not, say, a fake account stuffed with
        // attacker-chosen u64s.
        if !position_account.owned_by(&KAMINO_LEND_PROGRAM_ID) {
            return Err(ProgramError::IllegalOwner);
        }

        if holding_amount == 0 {
            return Ok(0);
        }

        let data = position_account.try_borrow()?;
        if data.len() < RESERVE_MIN_LEN {
            return Err(ProgramError::InvalidAccountData);
        }

        let available = u64::from_le_bytes(
            data[RESERVE_OFFSET_LIQUIDITY_AVAILABLE..RESERVE_OFFSET_LIQUIDITY_AVAILABLE + 8]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );
        let borrowed_sf = u128::from_le_bytes(
            data[RESERVE_OFFSET_LIQUIDITY_BORROWED_SF..RESERVE_OFFSET_LIQUIDITY_BORROWED_SF + 16]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );
        let collateral_supply = u64::from_le_bytes(
            data[RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY
                ..RESERVE_OFFSET_COLLATERAL_MINT_TOTAL_SUPPLY + 8]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        );

        if collateral_supply == 0 {
            return Ok(0);
        }

        let borrowed = borrowed_sf >> SF_SCALE_BITS;
        let total_liquidity = (available as u128).saturating_add(borrowed);

        let numerator = (holding_amount as u128)
            .checked_mul(total_liquidity)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        let value = numerator / (collateral_supply as u128);
        if value > u64::MAX as u128 {
            return Err(ProgramError::ArithmeticOverflow);
        }
        Ok(value as u64)
    }
}
