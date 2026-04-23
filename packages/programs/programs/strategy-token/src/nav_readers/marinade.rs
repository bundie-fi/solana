//! Marinade mSOL state reader — values an mSOL holding in SOL lamports.
//!
//! Layout source: marinade-finance/liquid-staking-program,
//! programs/marinade-finance/src/state/mod.rs (`State` account).
//!
//! The actual byte-walk + Q32.32 conversion lives in
//! `beethoven::marinade::read_msol_value` (offset 512, verified against
//! the devnet Marinade State PDA — see that crate's header comment).
//! This module only owns the dispatch glue and the program-id owner-check.
//!
//! ⚠ Unit note: this reader returns SOL **lamports**, not the strategy's
//! quote-token base units. Strategies that quote in USDC need a Pyth
//! SOL/USDC step on top of this — not yet wired in `update_nav`. As
//! long as a strategy's quote token *is* SOL (or wSOL), the value
//! returned here can be summed directly with the wallet ATA balance.

use pinocchio::{account::AccountView, error::ProgramError};

use super::PositionReader;

/// Marinade Finance program ID — same on devnet and mainnet
/// (`MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD`).
pub const MARINADE_PROGRAM_ID: pinocchio::address::Address =
    pinocchio::address::Address::new_from_array([
        5, 69, 227, 101, 190, 242, 113, 173, 117, 53, 3, 103, 86, 93, 164, 13, 163, 54, 220, 28,
        135, 155, 177, 84, 138, 122, 252, 197, 90, 169, 57, 30,
    ]);

pub struct MarinadeStateReader;

impl PositionReader for MarinadeStateReader {
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
        // Defer to the per-protocol reader. The function currently panics
        // with a TODO until the `msol_price` byte offset is verified
        // against a live State PDA on devnet.
        let data = position_account.try_borrow()?;
        beethoven::marinade::read_msol_value(&data, holding_amount)
    }
}
