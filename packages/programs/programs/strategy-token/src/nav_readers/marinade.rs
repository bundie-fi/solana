//! Marinade mSOL state reader — values an mSOL holding in SOL lamports
//! (single-account path) **or** USDC base units (multi-account path with
//! Pyth SOL/USD).
//!
//! Layout source: marinade-finance/liquid-staking-program,
//! programs/marinade-finance/src/state/mod.rs (`State` account).
//!
//! The actual byte-walk + Q32.32 conversion lives in
//! `beethoven::marinade::read_msol_value` (offset 512, verified against
//! the devnet Marinade State PDA — see that crate's header comment).
//! This module owns:
//!   - the dispatch glue and program-id owner-check
//!   - the optional Pyth SOL/USD conversion → USDC base units
//!
//! ## Two callable shapes
//!
//! 1. `value_in_quote(state_acc, holding)` (legacy, single account):
//!    returns SOL **lamports**. Strategies whose quote token is SOL/wSOL
//!    can sum this directly with the wallet ATA.
//!
//! 2. `value_in_quote_multi(&[state_acc, pyth_oracle], holding)`
//!    (preferred for USDC strategies): returns USDC **base units**
//!    (6 decimals) by reading a Pyth Pull SOL/USD price update and
//!    multiplying. See `super::pyth` for layout + defensive checks.
//!
//! ## Wire-format dispatch
//!
//! `update_nav.rs` already hands a `state_accs: &[AccountView]` slice
//! into `value_in_quote_multi`. A v2-emitting keeper passes
//! `(tag=PROTOCOL_TAG_MARINADE, num_state_accs=2)` and supplies
//! `[State, PythPriceUpdateV2]` as the per-position state accounts —
//! no dispatcher change needed.
//!
//! v1-emitting keepers (single state acc) still hit the default
//! `value_in_quote_multi` → `value_in_quote` forwarding and get SOL
//! lamports back, preserving backwards compat.

use pinocchio::{
    account::AccountView,
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
};

use super::{
    pyth::{read_price_validated, sol_lamports_to_usdc_base_units, SOL_USD_FEED_ID},
    PositionReader,
};

/// Marinade Finance program ID — same on devnet and mainnet
/// (`MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD`).
pub const MARINADE_PROGRAM_ID: pinocchio::address::Address =
    pinocchio::address::Address::new_from_array([
        5, 69, 227, 101, 190, 242, 113, 173, 117, 53, 3, 103, 86, 93, 164, 13, 163, 54, 220, 28,
        135, 155, 177, 84, 138, 122, 252, 197, 90, 169, 57, 30,
    ]);

pub struct MarinadeStateReader;

impl PositionReader for MarinadeStateReader {
    /// SOL-lamports valuation (single-account path). Backwards-compat for
    /// SOL-quoted strategies and for v1-wire-format keepers.
    fn value_in_quote(
        position_account: &AccountView,
        holding_amount: u64,
    ) -> Result<u64, ProgramError> {
        if !position_account.owned_by(&MARINADE_PROGRAM_ID) {
            return Err(ProgramError::IllegalOwner);
        }
        if holding_amount == 0 {
            return Ok(0);
        }
        let data = position_account.try_borrow()?;
        beethoven::marinade::read_msol_value(&data, holding_amount)
    }

    /// Multi-account valuation:
    ///   - `state_accs.len() == 1`  → forwards to `value_in_quote` and
    ///     returns SOL lamports (legacy / SOL-quoted strategies).
    ///   - `state_accs.len() == 2`  → `[Marinade State, Pyth SOL/USD
    ///     PriceUpdateV2]`, returns **USDC base units** (6 decimals).
    ///
    /// Anything else is an error — refusing to silently mis-interpret an
    /// unexpected account count.
    fn value_in_quote_multi(
        state_accs: &[AccountView],
        holding_amount: u64,
    ) -> Result<u64, ProgramError> {
        match state_accs.len() {
            0 => Err(ProgramError::NotEnoughAccountKeys),
            1 => Self::value_in_quote(&state_accs[0], holding_amount),
            2 => {
                let state_acc = &state_accs[0];
                let pyth_acc = &state_accs[1];

                // Step 1: SOL lamports from Marinade State (defers to the
                // existing single-account reader for the owner-check +
                // Q32.32 math).
                let sol_lamports = Self::value_in_quote(state_acc, holding_amount)?;
                if sol_lamports == 0 {
                    return Ok(0);
                }

                // Step 2: validated Pyth SOL/USD price.
                let clock = Clock::get()?;
                let price = read_price_validated(pyth_acc, &SOL_USD_FEED_ID, clock.unix_timestamp)?;

                // Step 3: convert SOL lamports → USDC base units.
                sol_lamports_to_usdc_base_units(sol_lamports, price.price, price.exponent)
            }
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}
