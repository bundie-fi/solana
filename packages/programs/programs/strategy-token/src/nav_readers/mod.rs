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
//!
//! ## Multi-account positions (v2 wire format)
//!
//! Some protocols (Drift, marginfi) need MORE than one state account per
//! position: a primary "user" account holding the position list, plus
//! per-asset accounts (SpotMarket, Bank) that carry the share-value /
//! cumulative-interest used to convert shares → underlying tokens.
//!
//! `PositionReader::value_in_quote_multi` is the multi-account variant.
//! It receives a slice `state_accs: &[AccountView]` where:
//!   - `state_accs[0]` is the primary state account (e.g. Drift `User`,
//!     marginfi `MarginfiAccount`) — used for the defensive owner-check
//!     and to enumerate active positions.
//!   - `state_accs[1..]` are auxiliary accounts (SpotMarket / Bank /
//!     oracle) referenced by the active positions, in caller-supplied
//!     order. The reader matches them up by mint or by `bank_pk`.
//!
//! The default impl of `value_in_quote_multi` forwards to the existing
//! single-account `value_in_quote(state_accs[0], holding_amount)`, so
//! single-account readers (Kamino, Marinade) only need to keep
//! implementing `value_in_quote` and the dispatcher can call
//! `value_in_quote_multi` uniformly.

pub mod drift;
pub mod kamino;
pub mod marginfi;
pub mod marinade;

use pinocchio::{account::AccountView, error::ProgramError};

/// USDC mint (mainnet & devnet share the same mint for our purposes here:
/// strategies on devnet currently use Circle's devnet USDC, which has the
/// same address as mainnet for clients that route through the
/// Circle-issued mint. If a future strategy uses a different USDC mint we
/// should make this configurable per-strategy.)
///
/// Encoded base58: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
pub const USDC_MINT: pinocchio::address::Address = pinocchio::address::Address::new_from_array([
    198, 250, 122, 243, 190, 219, 173, 58, 61, 101, 243, 106, 171, 201, 116, 49, 177, 187, 228,
    194, 210, 246, 224, 228, 124, 166, 2, 3, 69, 47, 93, 97,
]);

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

    /// Multi-account variant for protocols that need >1 state account per
    /// position (Drift, marginfi).
    ///
    /// `state_accs[0]` is the primary state account (Drift `User`,
    /// marginfi `MarginfiAccount`). `state_accs[1..]` are auxiliary
    /// accounts (SpotMarket, Bank) referenced by active positions, in
    /// caller-supplied order — the reader matches them up internally
    /// (e.g. by mint or by `bank_pk`).
    ///
    /// Default impl forwards to the single-account `value_in_quote`,
    /// which lets readers like Kamino and Marinade keep working with no
    /// changes. Multi-account readers override this directly.
    fn value_in_quote_multi(
        state_accs: &[AccountView],
        holding_amount: u64,
    ) -> Result<u64, ProgramError> {
        if state_accs.is_empty() {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        Self::value_in_quote(&state_accs[0], holding_amount)
    }
}

// ─── Wire-format protocol tags ────────────────────────────────────────────
//
// These tags are part of the on-chain instruction-data ABI for `update_nav`.
// Adding a new protocol = append a new tag, never reuse / renumber.

pub const PROTOCOL_TAG_KAMINO: u8 = 0;
pub const PROTOCOL_TAG_MARINADE: u8 = 1;
pub const PROTOCOL_TAG_DRIFT: u8 = 2;
pub const PROTOCOL_TAG_MARGINFI: u8 = 3;
