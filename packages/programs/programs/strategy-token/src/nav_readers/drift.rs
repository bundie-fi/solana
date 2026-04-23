//! Drift user-account reader — values a Drift sub-account in USDC.
//!
//! Layout source: drift-labs/protocol-v2,
//! programs/drift/src/state/user.rs (`User` account, ~4376 bytes).
//!
//! See `packages/beethoven/crates/deposit/drift/src/lib.rs` for the
//! per-protocol reader; this module only holds the dispatch glue and the
//! Drift program-id (used for the defensive owner-check). The reader
//! currently panics — see TODO(NAV-DRIFT) — because Drift requires
//! reading both the User account AND each referenced SpotMarket for
//! cumulative-interest scaling, which the simple `(position, exchange_rate)`
//! pair wire format does not yet express.

use pinocchio::{account::AccountView, error::ProgramError};

use super::PositionReader;

/// Drift v2 program ID (`dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`).
pub const DRIFT_PROGRAM_ID: pinocchio::address::Address =
    pinocchio::address::Address::new_from_array([
        9, 84, 219, 190, 158, 201, 96, 201, 138, 122, 41, 63, 226, 19, 54, 150, 111, 225, 128, 209,
        81, 174, 75, 129, 121, 86, 31, 137, 133, 74, 83, 246,
    ]);

pub struct DriftUserReader;

impl PositionReader for DriftUserReader {
    fn value_in_quote(
        position_account: &AccountView,
        _holding_amount: u64,
    ) -> Result<u64, ProgramError> {
        if !position_account.owned_by(&DRIFT_PROGRAM_ID) {
            return Err(ProgramError::IllegalOwner);
        }
        let data = position_account.try_borrow()?;
        beethoven::drift::read_user_value(&data)
    }
}
