//! marginfi lending-account reader — values a `MarginfiAccount` in
//! underlying tokens.
//!
//! Layout source: mrgnlabs/marginfi-v2,
//! programs/marginfi/src/state/marginfi_account.rs (`MarginfiAccount`,
//! 2304 bytes incl. discriminator).
//!
//! See `packages/beethoven/crates/deposit/marginfi/src/lib.rs` for the
//! per-protocol reader; this module only holds the dispatch glue and the
//! marginfi program-id (used for the defensive owner-check). The reader
//! currently panics — see TODO(NAV-MARGINFI) — because marginfi requires
//! reading both the MarginfiAccount AND each referenced Bank for
//! `asset_share_value`, which the simple `(position, exchange_rate)`
//! pair wire format does not yet express.

use pinocchio::{account::AccountView, error::ProgramError};

use super::PositionReader;

/// marginfi v2 program ID (`MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`).
pub const MARGINFI_PROGRAM_ID: pinocchio::address::Address =
    pinocchio::address::Address::new_from_array([
        5, 48, 122, 214, 69, 75, 188, 94, 30, 78, 146, 5, 146, 83, 161, 139, 184, 200, 134, 140,
        88, 166, 49, 46, 200, 106, 57, 230, 34, 78, 55, 59,
    ]);

pub struct MarginfiAccountReader;

impl PositionReader for MarginfiAccountReader {
    fn value_in_quote(
        position_account: &AccountView,
        _holding_amount: u64,
    ) -> Result<u64, ProgramError> {
        if !position_account.owned_by(&MARGINFI_PROGRAM_ID) {
            return Err(ProgramError::IllegalOwner);
        }
        let data = position_account.try_borrow()?;
        beethoven::marginfi::read_marginfi_value(&data)
    }
}
