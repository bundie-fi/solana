//! Position readers — value protocol-deployed positions in quote-token units.
//!
//! Each per-protocol reader owns the deserialization logic for a single
//! protocol's position account (Kamino reserve, Marinade state, Drift
//! sub-account, etc.) and returns the value of the strategy's holdings in
//! the same units as the quote-token wallet ATA, so `update_nav` can sum
//! `wallet_ata_balance + Σ reader.value_in_quote(...)` into a single
//! portfolio_value.
//!
//! Wire-format dispatch in `update_nav` uses an explicit per-position
//! protocol tag in the instruction data (see `update_nav.rs` doc comment
//! for the exact byte layout). This is more explicit than relying on the
//! account owner alone — it survives proxy/wrapper accounts and lets the
//! keeper express intent.
//!
//! Each reader keeps a defensive owner-check inside `value_in_quote` as a
//! second line of defense against a mis-tagged account.

pub mod drift;
pub mod kamino;
pub mod marginfi;
pub mod marinade;

use pinocchio::{account::AccountView, error::ProgramError};

/// Value a strategy's deployed position in quote-token units.
///
/// `position_account` is the protocol-owned account whose layout the impl
/// understands (e.g. a Kamino `Reserve`). The strategy-side balance — for
/// Kamino, the cToken balance held in the wallet ATA — is supplied via
/// `holding_amount` so the trait stays protocol-agnostic and the caller
/// doesn't need to know the per-protocol unit.
pub trait PositionReader {
    /// Returns the underlying quote-token value of `holding_amount` units of
    /// the protocol-specific share/cToken/lp-token, computed from
    /// `position_account`'s state. Borrows the account readonly.
    fn value_in_quote(
        position_account: &AccountView,
        holding_amount: u64,
    ) -> Result<u64, ProgramError>;
}

// ─── Wire-format protocol tags ────────────────────────────────────────────
//
// These tags are part of the on-chain instruction-data ABI for `update_nav`.
// Adding a new protocol = append a new tag, never reuse / renumber.

pub const PROTOCOL_TAG_KAMINO: u8 = 0;
pub const PROTOCOL_TAG_MARINADE: u8 = 1;
pub const PROTOCOL_TAG_DRIFT: u8 = 2;
pub const PROTOCOL_TAG_MARGINFI: u8 = 3;
